// packages/core/src/routes/requirements.mts
// 需求路由 —— 璇玑 V4 API 层
// 提供需求的 CRUD 接口 + 执行触发

import { Router } from 'express';
import { join, dirname } from 'path';
import { mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { requirementStore } from '../storage/requirement-store.mjs';
import { executionStore } from '../storage/execution-store.mjs';
import { graphRunner } from '../graph/graph-runner.mjs';
import { db } from '../db.mjs';

// 获取当前文件目录（ESM 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// skills 目录路径（编译后从 dist/routes 到 skills）
const SKILLS_DIR = join(__dirname, '../../skills');

export const requirementsRouter: Router = Router();

// =============================================================================
// Skill 复制工具函数
// =============================================================================

/**
 * 复制系统预置 skill 到工作目录
 * @param targetRepoPath 目标项目路径
 */
async function copySkillsToWorkdir(targetRepoPath: string): Promise<void> {
  const skillsDir = join(targetRepoPath, '.claude', 'skills');
  await mkdir(skillsDir, { recursive: true });

  // 复制若依相关 skill
  const skills = ['ruoyi-plus-ai-coding', 'frontend-crud-coding'];
  for (const skillId of skills) {
    const src = join(SKILLS_DIR, 'presets', skillId);
    if (existsSync(src)) {
      const dest = join(skillsDir, skillId);
      await cp(src, dest, { recursive: true });
      console.log(`[requirements] 已复制 skill: ${skillId}`);
    } else {
      console.warn(`[requirements] skill 不存在: ${skillId}`);
    }
  }
}

// =============================================================================
// 字段映射：Prisma (camelCase) <-> Dashboard (snake_case)
// =============================================================================

/**
 * 将 Prisma Requirement 对象映射为 Dashboard 期望的列表格式
 */
function toListItem(r: any) {
  return {
    id: r.id,
    input_text: r.title,
    spec_content: r.description ?? null,
    status: r.status,
    workflow_id: r.workflowId ?? null,
    execution_id: null,       // 由下方 attachExecution 补充
    created_at: r.createdAt?.toISOString?.() ?? r.createdAt,
    execution_status: null,
    execution_thread_id: null,
  };
}

/**
 * 将 Prisma Requirement 对象映射为 Dashboard 期望的详情格式
 */
function toDetail(r: any): any {
  return {
    id: r.id,
    input_text: r.title,
    spec_content: r.description ?? null,
    status: r.status,
    workflow_id: r.workflowId ?? null,
    execution_id: null,
    created_at: r.createdAt?.toISOString?.() ?? r.createdAt,
    execution: null,
    session_refs: [] as any[],
  };
}

/**
 * 查询关联的执行实例并附加到列表项/详情上
 */
async function attachExecution(item: any, requirementId: string) {
  try {
    // 只查询 requirement 级执行（需求管理页面只显示需求级执行 ID）
    const exec = await db.task_executions.findFirst({
      where: {
        subject_type: 'requirement',
        subject_id: requirementId,
      },
      orderBy: { created_at: 'desc' },
    });
    if (exec) {
      item.execution_id = exec.execution_id;
      item.execution_status = exec.status;
      item.execution_thread_id = exec.session_id;
      if (item.execution !== undefined) {
        item.execution = {
          id: exec.execution_id,
          status: exec.status,
          provider: exec.provider,
          session_id: exec.session_id,
          created_at: exec.created_at,
          started_at: exec.started_at,
          completed_at: exec.completed_at,
        };
      }
    }
  } catch {
    // 关联执行查询失败不影响主逻辑
  }
  return item;
}

// =============================================================================
// 路由
// =============================================================================

/**
 * GET /api/requirements
 * 需求列表（按创建时间降序）
 */
requirementsRouter.get('/', async (_req, res) => {
  try {
    const requirements = await requirementStore.list();
    const items = await Promise.all(
      requirements.map(async (r) => {
        const item = toListItem(r);
        await attachExecution(item, r.id);
        return item;
      }),
    );
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: '查询需求失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/requirements/:id
 * 需求详情
 */
requirementsRouter.get('/:id', async (req, res) => {
  try {
    const r = await requirementStore.getById(req.params.id);
    if (!r) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const detail = toDetail(r);
    await attachExecution(detail, r.id);

    // 查询关联 session（phaseInstances）
    try {
      const phases = await db.phase_instances.findMany({
        where: { requirement_id: r.id },
        orderBy: { created_at: 'desc' },
      });
      detail.session_refs = phases.map((p: any, idx: number) => ({
        id: p.id,
        node_id: p.phase_id,
        iteration: p.attempt,
        role: p.agent_used ?? 'unknown',
        omnigent_session_id: p.session_id ?? '',
        omnigent_status: p.status,
      }));
    } catch {
      // 忽略
    }

    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: '查询需求失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/requirements
 * 创建需求
 *
 * Dashboard 提交格式：{ id?, input_text, workflow_id? }
 * Prisma 需要格式：{ id, title, targetProjectId, targetRepoPath, workflowId }
 */
requirementsRouter.post('/', async (req, res) => {
  try {
    const body = req.body;

    // 兼容 Dashboard 和旧 API 两种格式
    const title = body.input_text || body.title || body.description || '未命名需求';
    const id = body.id || `req-${Date.now()}`;

    // targetProjectId / targetRepoPath：Dashboard 可能不传，使用默认值
    const targetProjectId = body.targetProjectId || body.target_project_id || 'default';
    // 支持 project_path 作为 targetRepoPath 的别名（E2E 测试用）
    const targetRepoPath = body.targetRepoPath || body.target_repo_path || body.project_path || process.cwd();

    // workflow_id：默认 'requirement-decomposition'
    const workflowId = body.workflow_id || body.workflowId || 'requirement-decomposition';

    const requirement = await db.requirements.create({
      data: {
        id,
        title,
        description: body.description || null,
        target_project_id: targetProjectId,
        target_repo_path: targetRepoPath,
        workflow_id: workflowId,
        status: 'pending',
      },
    });

    // 复制 skill 到工作目录
    if (targetRepoPath) {
      try {
        await copySkillsToWorkdir(targetRepoPath);
      } catch (e) {
        console.warn('[requirements] 复制 skill 失败:', e);
        // 不阻塞需求创建
      }
    }

    const item = toListItem(requirement);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: '创建需求失败', detail: (err as Error).message });
  }
});

/**
 * DELETE /api/requirements/:id
 * 删除需求
 */
requirementsRouter.delete('/:id', async (req, res) => {
  try {
    const requirementId = req.params.id;
    const existing = await requirementStore.getById(requirementId);
    if (!existing) {
      res.status(404).json({ error: '需求不存在' });
      return;
    }

    // 级联删除：按外键依赖顺序处理所有关联表
    // 先收集所有关联的 execution_id
    const executions = await db.task_executions.findMany({
      where: {
        OR: [
          { subject_type: 'requirement', subject_id: requirementId },
          { requirement_id: requirementId },
        ],
      },
      select: { execution_id: true },
    });
    const executionIds = executions.map(e => e.execution_id);

    // 清理 execution 级联引用（复用辅助函数）
    await cascadeDeleteExecutions(executionIds);

    const epics = await db.epics.findMany({
      where: { requirement_id: requirementId },
      select: { id: true },
    });
    const epicIds = epics.map(e => e.id);

    // 清理直接引用 requirement_id 的表
    await db.task_logs.deleteMany({ where: { requirement_id: requirementId } });

    // 删除 task_executions
    await db.task_executions.deleteMany({
      where: {
        OR: [
          { subject_type: 'requirement', subject_id: requirementId },
          { requirement_id: requirementId },
        ],
      },
    });

    // 10. 删除 tasks（通过 epic 层级联）
    await db.tasks.deleteMany({
      where: { epics: { requirement_id: requirementId } },
    });

    // 11. 删除 user_stories（外键 → epics.id, features.id）
    await db.user_stories.deleteMany({
      where: {
        OR: [
          { epic_id: { in: epicIds } },
          { features: { epics: { requirement_id: requirementId } } },
        ],
      },
    });

    // 12. 删除 features（外键 → epics.id）
    await db.features.deleteMany({
      where: { epics: { requirement_id: requirementId } },
    });

    // 13. 删除 epics（外键 → requirements.id）
    await db.epics.deleteMany({
      where: { requirement_id: requirementId },
    });

    // 14. 删除 requirements
    await db.requirements.delete({ where: { id: requirementId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除需求失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/requirements/:id/stop
 * 停止需求执行
 */
requirementsRouter.post('/:id/stop', async (req, res) => {
  try {
    const requirementId = req.params.id;

    // 找到关联的执行实例
    const exec = await db.task_executions.findFirst({
      where: {
        OR: [
          { subject_type: 'requirement', subject_id: requirementId },
          { requirement_id: requirementId },
        ],
        status: { in: ['pending', 'running'] },
      },
      orderBy: { created_at: 'desc' },
    });

    if (exec) {
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { status: 'cancelled', control_status: 'stop_requested' },
      });
    }

    await requirementStore.updateStatus(requirementId, 'cancelled');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '停止失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/requirements/:id/tree
 * 需求分解结构树
 */
requirementsRouter.get('/:id/tree', async (req, res) => {
  try {
    const requirementId = req.params.id;
    const requirement = await requirementStore.getById(requirementId);
    if (!requirement) {
      res.status(404).json({ error: '需求不存在' });
      return;
    }

    // 查询 epics
    const epics = await db.epics.findMany({
      where: { requirement_id: requirementId },
      include: {
        features: {
          include: {
            user_stories: {
              include: {
                tasks: true,
              },
            },
          },
        },
      },
    });

    // 查询孤立的 user stories（不属于任何 feature）
    const orphanUserStories = await db.user_stories.findMany({
      where: {
        epics: { requirement_id: requirementId },
        feature_id: null,
      },
      include: { tasks: true },
    });

    res.json({
      requirement: {
        id: requirement.id,
        input_text: requirement.title,
        status: requirement.status,
        execution_id: null,
      },
      epics: epics.map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        module: e.module,
        status: e.status,
        features: e.features.map((f: any) => ({
          id: f.id,
          title: f.title,
          description: f.description,
          status: f.status,
          user_stories: f.user_stories.map((us: any) => ({
            id: us.id,
            title: us.title,
            as_a: us.as_a,
            i_want: us.i_want,
            so_that: us.so_that,
            priority: us.priority,
            acceptance_text: us.acceptance_text,
            status: us.status,
            tasks: us.tasks.map((t: any) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              task_type: null,
              status: t.status,
              execution_id: null,
              estimated_hours: null,
            })),
          })),
        })),
        orphan_user_stories: orphanUserStories
          .filter((us: any) => us.epic_id === e.id)
          .map((us: any) => ({
            id: us.id,
            title: us.title,
            as_a: us.as_a,
            i_want: us.i_want,
            so_that: us.so_that,
            priority: us.priority,
            acceptance_text: us.acceptance_text,
            status: us.status,
            tasks: us.tasks.map((t: any) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              task_type: null,
              status: t.status,
              execution_id: null,
              estimated_hours: null,
            })),
          })),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: '查询需求树失败', detail: (err as Error).message });
  }
});

/**
   * POST /api/requirements/:id/confirm-all-tasks
   * 确认需求下所有任务（批量将 draft 改为 pending）
   */
  requirementsRouter.post('/:id/confirm-all-tasks', async (req, res) => {
    try {
      const requirementId = req.params.id;

      // 查找该需求下所有 draft 状态的 TaskExecution
      const result = await db.task_executions.updateMany({
        where: {
          requirement_id: requirementId,
          status: 'draft',
        },
        data: { status: 'pending' },
      });

      res.json({
        ok: true,
        confirmed_count: result.count,
        message: `已确认 ${result.count} 个任务`,
      });
    } catch (err) {
      res.status(500).json({ error: '批量确认失败', detail: (err as Error).message });
    }
  });

/**
 * POST /api/requirements/:id/execute
 * 触发需求执行
 *
 * 流程：CAS 抢占需求状态 → 创建执行实例（status='pending'）→ 异步调用 graphRunner
 * 执行 requirement-decomposition 工作流，由 onFlowComplete 落地拆分出的任务树。
 *
 * 为什么不经过调度器：需求拆解是整条流水线的入口（每个需求只发生一次），
 * 丢进调度器只会和下游任务抢并发槽位，拿不到并发收益。防重靠对
 * requirements.status 的 CAS 更新（条件与前端 canExecute 一致），
 * 原子性地挡住 Dashboard 连点造成的并发启动。
 *
 * 注意：执行实例必须建成 status='pending'——graphRunner.acquireLease 只抢占
 * pending/rate_limited 状态的执行，建成 draft 会连租约都拿不到。
 */
requirementsRouter.post('/:id/execute', async (req, res) => {
  try {
    const requirementId = req.params.id;
    const requirement = await requirementStore.getById(requirementId);

    if (!requirement) {
      res.status(404).json({ error: '需求不存在' });
      return;
    }

    // CAS 抢占：仅当需求处于可触发状态时置为 running
    // 条件与前端 canExecute 保持一致（draft/pending/failed/cancelled/stopped 可触发）
    const claimed = await db.requirements.updateMany({
      where: {
        id: requirementId,
        status: { in: ['draft', 'pending', 'failed', 'cancelled', 'stopped'] },
      },
      data: { status: 'running' },
    });
    if (claimed.count === 0) {
      res.json({ ok: true, message: '需求已在执行中', status: 'running' });
      return;
    }

    const workflowId = requirement.workflow_id || 'requirement-decomposition';

    // 创建执行实例（status='pending'，供 graphRunner.acquireLease 抢占）
    let execution;
    try {
      execution = await executionStore.create({
        subjectType: 'requirement',
        subjectId: requirementId,
        requirementId,
        targetProjectId: requirement.target_project_id,
        targetRepoPath: requirement.target_repo_path,
        status: 'pending',
      });
    } catch (err) {
      // 创建失败要把需求状态放回去，否则会永久卡在 running、再也触发不了
      await requirementStore.updateStatus(requirementId, 'pending');
      throw err;
    }

    const executionId = execution.execution_id;

    // 异步启动流程执行（不阻塞响应）
    setImmediate(async () => {
      try {
        await graphRunner.startExecution({
          executionId,
          flowId: workflowId,
          input: requirement.title,
          requirementId,
        });
      } catch (err) {
        // acquireLease 失败可能只是执行已被调度器抢先接管（它同样会捞 pending 执行），
        // 此时执行仍在正常推进，不能当失败处理、更不能误杀
        const cur = await executionStore.get(executionId);
        if (cur && cur.status !== 'pending') {
          console.warn(
            `[requirements] 执行 ${executionId} 已被接管（status=${cur.status}），跳过失败处理`,
          );
          return;
        }
        console.error(`[requirements] 执行需求 ${requirementId} 出错:`, err);
        await executionStore.fail(executionId, (err as Error).message);
        await requirementStore.updateStatus(requirementId, 'failed');
        return;
      }

      // startExecution 内部吞掉异常并落到执行状态上，所以按执行终态回写需求状态
      const finalExec = await executionStore.get(executionId);
      if (finalExec?.status === 'completed') {
        await requirementStore.updateStatus(requirementId, 'completed');
      } else if (finalExec?.status === 'failed') {
        await requirementStore.updateStatus(requirementId, 'failed');
      } else {
        // waiting（等人工回答）/ paused（gate 待审）等：保持 running，由恢复流程推进
        console.log(
          `[requirements] 需求 ${requirementId} 执行停在 ${finalExec?.status}，等待人工介入`,
        );
      }
    });

    res.json({ success: true, executionId, message: '执行已启动', status: 'running' });
  } catch (err) {
    res.status(500).json({ error: '触发执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/requirements/:id/pause
 * 暂停需求下所有 running 任务
 */
requirementsRouter.post('/:id/pause', async (req, res) => {
  try {
    const requirementId = req.params.id;

    // 找到该需求下所有 running 状态的任务执行
    const runningExecs = await db.task_executions.findMany({
      where: {
        requirement_id: requirementId,
        status: 'running',
      },
      select: { execution_id: true },
    });

    if (runningExecs.length === 0) {
      res.json({ ok: true, message: '无运行中的任务', paused_count: 0 });
      return;
    }

    // 批量设置 control_status + 直接触发 abort
    const { getAbortController } = await import('../graph/graph-runner.mjs');

    for (const exec of runningExecs) {
      // 1. 标记控制状态
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { control_status: 'pause_requested' },
      });

      // 2. 直接触发中断
      const abortController = getAbortController(exec.execution_id);
      if (abortController && !abortController.signal.aborted) {
        console.log(`[requirements] 暂停 API 直接触发 abort: ${exec.execution_id}`);
        abortController.abort();
      }
    }

    res.json({ ok: true, paused_count: runningExecs.length });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

// =============================================================================
// Epic 级操作 API
// =============================================================================

/**
 * POST /api/requirements/epics/:id/execute
 * 执行该 Epic 下所有 pending 任务
 */
requirementsRouter.post('/epics/:id/execute', async (req, res) => {
  try {
    const epicId = req.params.id;

    // 查找 draft 或 pending 状态的执行（draft 会自动确认后执行）
    const executions = await db.task_executions.findMany({
      where: {
        tasks: { epic_id: epicId },
        status: { in: ['draft', 'pending'] },
      },
      include: {
        tasks: { select: { id: true } },
      },
    });

    if (executions.length === 0) {
      res.json({ ok: true, message: '无待执行任务', started_count: 0 });
      return;
    }

    let startedCount = 0;
    for (const exec of executions) {
      try {
        // 如果是 draft，先确认
        if (exec.status === 'draft') {
          await db.task_executions.update({
            where: { execution_id: exec.execution_id },
            data: { status: 'pending' },
          });
        }

        await graphRunner.startExecution({
          executionId: exec.execution_id,
          flowId: 'ruoyi-dev-flow',
          input: '',
          task: exec.tasks ?? undefined,
        });
        startedCount++;
      } catch (err) {
        console.error(`[epics] 启动执行失败: ${exec.execution_id}`, err);
      }
    }

    res.json({ ok: true, started_count: startedCount });
  } catch (err) {
    res.status(500).json({ error: '执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/epics/:id/pause
 * 暂停该 Epic 下所有 running 任务
 */
requirementsRouter.post('/epics/:id/pause', async (req, res) => {
  try {
    const epicId = req.params.id;

    const runningExecs = await db.task_executions.findMany({
      where: {
        tasks: { epic_id: epicId },
        status: 'running',
      },
      select: { execution_id: true },
    });

    if (runningExecs.length === 0) {
      res.json({ ok: true, paused_count: 0 });
      return;
    }

    const { getAbortController } = await import('../graph/graph-runner.mjs');

    for (const exec of runningExecs) {
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { control_status: 'pause_requested' },
      });

      const abortController = getAbortController(exec.execution_id);
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
    }

    res.json({ ok: true, paused_count: runningExecs.length });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * 级联清理与 executionIds 关联的所有表（外键顺序删除）
 */
async function cascadeDeleteExecutions(executionIds: string[]) {
  if (executionIds.length === 0) return;

  // phase_outputs → phase_instances.id
  const phases = await db.phase_instances.findMany({
    where: { execution_id: { in: executionIds } },
    select: { id: true },
  });
  const phaseIds = phases.map(p => p.id);
  if (phaseIds.length > 0) {
    await db.phase_outputs.deleteMany({ where: { phase_instance_id: { in: phaseIds } } });
  }

  // conversation_events → task_executions.execution_id
  await db.conversation_events.deleteMany({ where: { execution_id: { in: executionIds } } });

  // inbox_questions → task_executions.execution_id
  await db.inbox_questions.deleteMany({ where: { execution_id: { in: executionIds } } });

  // execution_events → task_executions.execution_id
  await db.execution_events.deleteMany({ where: { execution_id: { in: executionIds } } });

  // interventions → task_executions.execution_id
  await db.interventions.deleteMany({ where: { execution_id: { in: executionIds } } });

  // decisions → task_executions.execution_id
  await db.decisions.deleteMany({ where: { execution_id: { in: executionIds } } });

  // task_logs → task_executions.execution_id
  await db.task_logs.deleteMany({ where: { execution_id: { in: executionIds } } });

  // phase_instances → task_executions.execution_id
  await db.phase_instances.deleteMany({ where: { execution_id: { in: executionIds } } });
}

/**
 * DELETE /api/epics/:id
 * 删除 Epic 及其子内容
 */
requirementsRouter.delete('/epics/:id', async (req, res) => {
  try {
    const epicId = req.params.id;

    // 级联删除：先清理外键引用
    const executions = await db.task_executions.findMany({
      where: { tasks: { epic_id: epicId } },
      select: { execution_id: true },
    });
    await cascadeDeleteExecutions(executions.map(e => e.execution_id));

    // 1. 删除 TaskExecutions
    await db.task_executions.deleteMany({
      where: { tasks: { epic_id: epicId } },
    });

    // 2. 删除 Tasks
    await db.tasks.deleteMany({
      where: { epic_id: epicId },
    });

    // 3. 删除 UserStories
    await db.user_stories.deleteMany({
      where: {
        OR: [
          { epic_id: epicId },
          { features: { epic_id: epicId } },
        ],
      },
    });

    // 4. 删除 Features
    await db.features.deleteMany({
      where: { epic_id: epicId },
    });

    // 5. 删除 Epic 本身
    await db.epics.delete({ where: { id: epicId } });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败', detail: (err as Error).message });
  }
});

// =============================================================================
// Feature 级操作 API
// =============================================================================

/**
 * POST /api/features/:id/execute
 * 执行该 Feature 下所有 pending 任务
 */
requirementsRouter.post('/features/:id/execute', async (req, res) => {
  try {
    const featureId = req.params.id;

    // Feature 通过 UserStory 关联任务：tasks.user_story_id → user_stories.feature_id
    // 查找 draft 或 pending 状态的执行（draft 会自动确认后执行）
    const executions = await db.task_executions.findMany({
      where: {
        tasks: {
          user_stories: { feature_id: featureId },
        },
        status: { in: ['draft', 'pending'] },
      },
      include: {
        tasks: { select: { id: true } },
      },
    });

    if (executions.length === 0) {
      res.json({ ok: true, started_count: 0 });
      return;
    }

    let startedCount = 0;
    for (const exec of executions) {
      try {
        // 如果是 draft，先确认
        if (exec.status === 'draft') {
          await db.task_executions.update({
            where: { execution_id: exec.execution_id },
            data: { status: 'pending' },
          });
        }

        await graphRunner.startExecution({
          executionId: exec.execution_id,
          flowId: 'ruoyi-dev-flow',
          input: '',
          task: exec.tasks ?? undefined,
        });
        startedCount++;
      } catch (err) {
        console.error(`[features] 启动执行失败: ${exec.execution_id}`, err);
      }
    }

    res.json({ ok: true, started_count: startedCount });
  } catch (err) {
    res.status(500).json({ error: '执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/features/:id/pause
 * 暂停该 Feature 下所有 running 任务
 */
requirementsRouter.post('/features/:id/pause', async (req, res) => {
  try {
    const featureId = req.params.id;

    const runningExecs = await db.task_executions.findMany({
      where: {
        tasks: {
          user_stories: { feature_id: featureId },
        },
        status: 'running',
      },
      select: { execution_id: true },
    });

    if (runningExecs.length === 0) {
      res.json({ ok: true, paused_count: 0 });
      return;
    }

    const { getAbortController } = await import('../graph/graph-runner.mjs');

    for (const exec of runningExecs) {
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { control_status: 'pause_requested' },
      });

      const abortController = getAbortController(exec.execution_id);
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
    }

    res.json({ ok: true, paused_count: runningExecs.length });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * DELETE /api/features/:id
 * 删除 Feature 及其子内容
 */
requirementsRouter.delete('/features/:id', async (req, res) => {
  try {
    const featureId = req.params.id;

    // 级联删除：先清理外键引用
    const executions = await db.task_executions.findMany({
      where: {
        tasks: {
          user_stories: { feature_id: featureId },
        },
      },
      select: { execution_id: true },
    });
    await cascadeDeleteExecutions(executions.map(e => e.execution_id));

    await db.task_executions.deleteMany({
      where: {
        tasks: {
          user_stories: { feature_id: featureId },
        },
      },
    });

    await db.tasks.deleteMany({
      where: {
        user_stories: { feature_id: featureId },
      },
    });

    await db.user_stories.deleteMany({
      where: { feature_id: featureId },
    });

    await db.features.delete({ where: { id: featureId } });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败', detail: (err as Error).message });
  }
});

// =============================================================================
// UserStory 级操作 API
// =============================================================================

/**
 * POST /api/user-stories/:id/execute
 * 执行该 UserStory 下所有 pending 任务
 */
requirementsRouter.post('/user-stories/:id/execute', async (req, res) => {
  try {
    const userStoryId = req.params.id;

    // 查找 draft 或 pending 状态的执行（draft 会自动确认后执行）
    const executions = await db.task_executions.findMany({
      where: {
        tasks: { user_story_id: userStoryId },
        status: { in: ['draft', 'pending'] },
      },
      include: {
        tasks: { select: { id: true } },
      },
    });

    if (executions.length === 0) {
      res.json({ ok: true, started_count: 0 });
      return;
    }

    let startedCount = 0;
    for (const exec of executions) {
      try {
        // 如果是 draft，先确认
        if (exec.status === 'draft') {
          await db.task_executions.update({
            where: { execution_id: exec.execution_id },
            data: { status: 'pending' },
          });
        }

        await graphRunner.startExecution({
          executionId: exec.execution_id,
          flowId: 'ruoyi-dev-flow',
          input: '',
          task: exec.tasks ?? undefined,
        });
        startedCount++;
      } catch (err) {
        console.error(`[user-stories] 启动执行失败: ${exec.execution_id}`, err);
      }
    }

    res.json({ ok: true, started_count: startedCount });
  } catch (err) {
    res.status(500).json({ error: '执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/user-stories/:id/pause
 * 暂停该 UserStory 下所有 running 任务
 */
requirementsRouter.post('/user-stories/:id/pause', async (req, res) => {
  try {
    const userStoryId = req.params.id;

    const runningExecs = await db.task_executions.findMany({
      where: {
        tasks: { user_story_id: userStoryId },
        status: 'running',
      },
      select: { execution_id: true },
    });

    if (runningExecs.length === 0) {
      res.json({ ok: true, paused_count: 0 });
      return;
    }

    const { getAbortController } = await import('../graph/graph-runner.mjs');

    for (const exec of runningExecs) {
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { control_status: 'pause_requested' },
      });

      const abortController = getAbortController(exec.execution_id);
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
    }

    res.json({ ok: true, paused_count: runningExecs.length });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * DELETE /api/user-stories/:id
 * 删除 UserStory 及其子内容
 */
requirementsRouter.delete('/user-stories/:id', async (req, res) => {
  try {
    const userStoryId = req.params.id;

    // 级联删除：先清理外键引用
    const executions = await db.task_executions.findMany({
      where: { tasks: { user_story_id: userStoryId } },
      select: { execution_id: true },
    });
    await cascadeDeleteExecutions(executions.map(e => e.execution_id));

    await db.task_executions.deleteMany({
      where: { tasks: { user_story_id: userStoryId } },
    });

    await db.tasks.deleteMany({
      where: { user_story_id: userStoryId },
    });

    await db.user_stories.delete({ where: { id: userStoryId } });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败', detail: (err as Error).message });
  }
});
