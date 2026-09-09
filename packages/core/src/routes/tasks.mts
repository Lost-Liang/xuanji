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
      taskId: { not: null },  // 只返回任务级执行，排除需求级执行
    };
    if (requirementId) {
      where.requirementId = requirementId as string;
    }

    // 查询 TaskExecution 记录（左连接 Task 获取 title）
    const executions = await db.taskExecution.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        task: {
          select: { id: true, title: true, description: true },
        },
      },
    });

    // 转换为前端期望的格式
    const items = executions.map((e: any) => ({
      id: e.executionId,
      title: e.task?.title ?? '(无标题)',
      task_id: e.taskId,
      status: e.status,
      thread_id: e.threadId,
      parent_execution_id: null,
      current_node_id: e.stage ?? null,
      started_at: e.startedAt?.toISOString?.() ?? null,
      finished_at: e.completedAt?.toISOString?.() ?? null,
      created_at: e.createdAt?.toISOString?.() ?? null,
      rate_limited_count: e.rateLimitCount ?? null,
      rate_limited_until: e.retryAt?.toISOString?.() ?? null,
      breakdown_content: e.task?.description ?? null,
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
    const execution = await db.taskExecution.findUnique({
      where: { executionId: req.params.id },
      include: {
        task: {
          select: { id: true, title: true, description: true },
        },
      },
    });

    if (!execution) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // 查询 phase_instances 获取 session_refs
    const phases = await db.phaseInstance.findMany({
      where: { executionId: execution.executionId },
      orderBy: { createdAt: 'asc' },
    });

    const item: any = {
      id: execution.executionId,
      title: execution.task?.title ?? '(无标题)',
      task_id: execution.taskId,
      status: execution.status,
      thread_id: execution.threadId,
      parent_execution_id: null,
      current_node_id: execution.stage ?? null,
      started_at: execution.startedAt?.toISOString?.() ?? null,
      finished_at: execution.completedAt?.toISOString?.() ?? null,
      created_at: execution.createdAt?.toISOString?.() ?? null,
      rate_limited_count: execution.rateLimitCount ?? null,
      rate_limited_until: execution.retryAt?.toISOString?.() ?? null,
      breakdown_content: execution.task?.description ?? null,
      requirement_id: execution.requirementId,
      token_in: null,
      token_out: null,
      cost: null,
      loop_counters: null,
      phase_outputs: [],
      session_refs: phases.map((p: any) => ({
        id: p.id,
        node_id: p.phaseId,
        iteration: p.attempt,
        role: p.agentUsed ?? 'unknown',
        omnigent_session_id: p.sessionId ?? '',
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
    const executionId = req.params.id;

    // 检查当前状态
    const execution = await db.taskExecution.findUnique({
      where: { executionId },
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
    await db.taskExecution.update({
      where: { executionId },
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
 * 手动触发任务执行（将 pending 任务交给 worker 执行）
 */
tasksRouter.post('/:id/execute', async (req, res) => {
  try {
    const executionId = req.params.id;

    // 检查当前状态
    const execution = await db.taskExecution.findUnique({
      where: { executionId },
      select: { status: true, taskId: true, graphDefinitionId: true },
    });

    if (!execution) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    if (execution.status !== 'pending') {
      res.status(400).json({ error: '只能执行 pending 状态的任务', current_status: execution.status });
      return;
    }

    // 获取完整的任务对象（参考 worker-graph.mts 的正确模式）
    const task = execution.taskId ? await taskStore.getById(execution.taskId) : null;
    if (!task) {
      res.status(400).json({ error: '任务数据不存在', taskId: execution.taskId });
      return;
    }

    // 异步启动任务执行
    setImmediate(async () => {
      try {
        const { graphRunner } = await import('../graph/graph-runner.mjs');
        await graphRunner.startExecution({
          executionId,
          flowId: 'default-dev-flow',
          input: '', // 任务上下文由 agent-node 从 task 对象读取
          task, // 传入完整的任务对象，而非 taskId 字符串
        });
      } catch (err) {
        console.error(`[tasks] 执行任务失败:`, err);
        await executionStore.fail(executionId, (err as Error).message);
      }
    });

    res.json({ ok: true, message: '执行已启动' });
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
    const executionId = req.params.id;

    // 检查是否正在执行
    const execution = await db.taskExecution.findUnique({
      where: { executionId },
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
    await db.taskExecution.delete({
      where: { executionId },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除任务失败', detail: (err as Error).message });
  }
});