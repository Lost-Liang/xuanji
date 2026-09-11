// packages/core/src/routes/tasks.mts
// 任务路由 —— 璇玑 V4 API 层
// 返回 TaskExecution 记录（带关联的 Task.title），支持按需求过滤

import { Router } from 'express';
import { taskStore } from '../storage/task-store.mjs';
import { executionStore } from '../storage/execution-store.mjs';
import { db } from '../db.mjs';

export const tasksRouter: Router = Router();

/**
 * GET /api/tasks
 * 任务列表（返回 TaskExecution 记录 + Task.title）
 * 支持按 requirementId 过滤
 */
tasksRouter.get('/', async (req, res) => {
  try {
    const { requirementId } = req.query;

    // 构建查询条件
    const where: any = {
      task_id: { not: null },  // 只返回任务级执行，排除需求级执行
    };
    if (requirementId) {
      where.requirement_id = requirementId as string;
    }

    // 查询 TaskExecution 记录（左连接 Task 获取 title）
    const executions = await db.task_executions.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: 100,
      include: {
        tasks: {
          select: { id: true, title: true, description: true },
        },
      },
    });

    // 转换为前端期望的格式
    const items = executions.map((e: any) => ({
      id: e.execution_id,
      title: e.tasks?.title ?? '(无标题)',
      task_id: e.task_id,
      status: e.status,
      thread_id: e.thread_id,
      parent_execution_id: null,
      current_node_id: e.stage ?? null,
      started_at: e.started_at?.toISOString?.() ?? null,
      finished_at: e.completed_at?.toISOString?.() ?? null,
      created_at: e.created_at?.toISOString?.() ?? null,
      rate_limited_count: e.rate_limit_count ?? null,
      rate_limited_until: e.retry_at?.toISOString?.() ?? null,
      breakdown_content: e.tasks?.description ?? null,
      session_ref_id: null, // TODO: 从 session_refs 表关联
    }));

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: '查询任务失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/tasks/:id
 * 任务详情（返回 TaskExecution + Task 信息）
 */
tasksRouter.get('/:id', async (req, res) => {
  try {
    const execution = await db.task_executions.findUnique({
      where: { execution_id: req.params.id },
      include: {
        tasks: {
          select: { id: true, title: true, description: true },
        },
      },
    });

    if (!execution) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // 查询 phase_instances 获取 session_refs
    const phases = await db.phase_instances.findMany({
      where: { execution_id: execution.execution_id },
      orderBy: { created_at: 'asc' },
    });

    const item: any = {
      id: execution.execution_id,
      title: execution.tasks?.title ?? '(无标题)',
      task_id: execution.task_id,
      status: execution.status,
      thread_id: execution.thread_id,
      parent_execution_id: null,
      current_node_id: execution.stage ?? null,
      started_at: execution.started_at?.toISOString?.() ?? null,
      finished_at: execution.completed_at?.toISOString?.() ?? null,
      created_at: execution.created_at?.toISOString?.() ?? null,
      rate_limited_count: execution.rate_limit_count ?? null,
      rate_limited_until: execution.retry_at?.toISOString?.() ?? null,
      breakdown_content: execution.tasks?.description ?? null,
      requirement_id: execution.requirement_id,
      graph_definition_id: execution.graph_definition_id ?? null,
      token_in: null,
      token_out: null,
      cost: null,
      loop_counters: null,
      phase_outputs: [],
      session_refs: phases.map((p: any) => ({
        id: p.id,
        node_id: p.phase_id,
        iteration: p.attempt,
        role: p.agent_used ?? 'unknown',
        omnigent_session_id: p.session_id ?? '',
        omnigent_status: p.status,
      })),
    };

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: '查询任务失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/tasks/:id/confirm
 * 确认任务执行（将 status 从 'draft' 改为 'pending'，调度器会自动拾取）
 */
tasksRouter.post('/:id/confirm', async (req, res) => {
  try {
    const execution_id = req.params.id;

    // 检查当前状态
    const execution = await db.task_executions.findUnique({
      where: { execution_id },
      select: { status: true },
    });

    if (!execution) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    if (execution.status !== 'draft') {
      res.status(400).json({ error: '只能确认 draft 状态的任务', current_status: execution.status });
      return;
    }

    // 更新状态为 pending
    await db.task_executions.update({
      where: { execution_id },
      data: { status: 'pending' },
    });

    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: '确认任务失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/tasks
 * 创建任务（手动创建时默认 status='pending'，可直接执行）
 */
tasksRouter.post('/', async (req, res) => {
  try {
    const task = await taskStore.create(req.body);
    // 为手动创建的任务生成执行实例（status='pending'，可直接执行）
    const execution = await executionStore.create({
      subjectType: 'task',
      subjectId: task.id,
      taskId: task.id,
      targetProjectId: req.body.targetProjectId || 'default',
      targetRepoPath: req.body.targetRepoPath || process.cwd(),
      status: 'pending', // 手动创建的任务可直接执行
    });
    res.json({ task, execution });
  } catch (err) {
    res.status(500).json({ error: '创建任务失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/tasks/:id/execute
 * 手动触发任务执行 —— 长期方案：路由层只做状态转换，由调度器统一执行
 *
 * 职责：
 * - draft → pending：允许调度器拾取
 * - pending：已加入调度队列，无需重复触发
 * - running/waiting：已在执行中
 *
 * 注意：路由层不直接调用 graphRunner.startExecution，避免绕过调度器的并发控制。
 */
tasksRouter.post('/:id/execute', async (req, res) => {
  try {
    const execution_id = req.params.id;

    // 检查当前状态
    const execution = await db.task_executions.findUnique({
      where: { execution_id },
      select: { status: true, task_id: true, graph_definition_id: true },
    });

    if (!execution) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    // 状态转换逻辑
    if (execution.status === 'draft') {
      // draft → pending：允许调度器拾取
      await db.task_executions.update({
        where: { execution_id },
        data: { status: 'pending' },
      });
      res.json({
        ok: true,
        message: '任务已加入调度队列，调度器将在下一轮轮询时拾取（最多 5 秒）',
        status: 'pending',
      });
      return;
    }

    if (execution.status === 'pending') {
      // 已加入调度队列
      res.json({
        ok: true,
        message: '任务已在调度队列中，等待调度器拾取',
        status: 'pending',
      });
      return;
    }

    if (execution.status === 'running' || execution.status === 'waiting') {
      // 已在执行中
      res.json({
        ok: true,
        message: '任务已在执行中',
        status: execution.status,
      });
      return;
    }

    // failed/completed/cancelled → 重置为 pending，允许重新执行
    // 同时清空旧的 phase_instances，避免画布显示旧的失败状态
    await db.phase_instances.deleteMany({
      where: { execution_id },
    });
    await db.task_executions.update({
      where: { execution_id },
      data: {
        status: 'pending',
        error_message: null,
        completed_at: null,
        stage: 'planning',
      },
    });
    res.json({
      ok: true,
      message: '任务已重置并加入调度队列',
      status: 'pending',
    });
  } catch (err) {
    res.status(500).json({ error: '触发执行失败', detail: (err as Error).message });
  }
});

/**
 * DELETE /api/tasks/:id
 * 删除任务执行实例
 */
tasksRouter.delete('/:id', async (req, res) => {
  try {
    const execution_id = req.params.id;

    // 检查是否正在执行
    const execution = await db.task_executions.findUnique({
      where: { execution_id },
      select: { status: true },
    });

    if (!execution) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    if (execution.status === 'running') {
      res.status(400).json({ error: '任务正在执行中，请先取消' });
      return;
    }

    // 删除执行实例
    await db.task_executions.delete({
      where: { execution_id },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除任务失败', detail: (err as Error).message });
  }
});