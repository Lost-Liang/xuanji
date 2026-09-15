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
        session_id: p.session_id ?? '',  // V4: Claude Code CLI 会话 ID
        status: p.status,
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

    // 查询该需求下所有任务的执行实例，取每个 task 最新的一条
    const executions = await db.task_executions.findMany({
      where: { requirement_id: requirementId, task_id: { not: null } },
      orderBy: { created_at: 'desc' },
    });
    const latestByTask = new Map<string, any>();
    for (const exec of executions) {
      if (exec.task_id && !latestByTask.has(exec.task_id)) {
        latestByTask.set(exec.task_id, exec);
      }
    }

    // 将 task 映射为带真实执行状态的节点
    const mapTask = (t: any) => {
      const exec = latestByTask.get(t.id);
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        task_type: null,
        status: exec ? exec.status : t.status,
        control_status: exec ? exec.control_status : null,
        execution_id: exec ? exec.execution_id : null,
        estimated_hours: null,
      };
    };

    // 汇总子任务状态为父级状态
    const rollup = (taskNodes: any[]): string => {
      if (taskNodes.length === 0) return 'pending';
      const ss = taskNodes.map((t: any) => t.status);
      if (ss.some((s: string) => s === 'running' || s === 'rate_limited')) return 'running';
      if (ss.some((s: string) => s === 'waiting')) return 'waiting';
      if (ss.some((s: string) => s === 'paused')) return 'paused';
      if (ss.some((s: string) => s === 'failed')) return 'failed';
      if (ss.every((s: string) => s === 'completed')) return 'completed';
      if (ss.every((s: string) => s === 'draft')) return 'draft';
      return 'pending';
    };

    // 判断父级下是否有可执行/可暂停/可恢复的任务
    // 可执行：仅 draft/pending（后端 execute 接口只接受这两种，failed 等需走 resume）
    const hasExecutable = (taskNodes: any[]) =>
      taskNodes.some((t: any) => t.status === 'pending' || t.status === 'draft');
    const hasRunning = (taskNodes: any[]) =>
      taskNodes.some((t: any) => t.status === 'running' || t.status === 'rate_limited');
    // 可恢复：与 resumeExecutions 接受的状态集保持一致
    const hasPaused = (taskNodes: any[]) =>
      taskNodes.some((t: any) => t.status === 'paused' || t.status === 'failed'
        || t.status === 'stopped' || t.status === 'cancelled');

    const mapStory = (us: any) => {
      const taskNodes = us.tasks.map(mapTask);
      return {
        id: us.id,
        title: us.title,
        as_a: us.as_a,
        i_want: us.i_want,
        so_that: us.so_that,
        priority: us.priority,
        acceptance_text: us.acceptance_text,
        status: rollup(taskNodes),
        can_execute: hasExecutable(taskNodes),
        can_pause: hasRunning(taskNodes),
        can_resume: hasPaused(taskNodes),
        tasks: taskNodes,
      };
    };

    // 需求级汇总：把该需求下所有任务（含孤立故事）拉平后 rollup
    const reqTaskNodes = epics.flatMap((e: any) => [
      ...e.features.flatMap((f: any) =>
        f.user_stories.flatMap((us: any) => us.tasks.map(mapTask))),
      ...orphanUserStories
        .filter((us: any) => us.epic_id === e.id)
        .flatMap((us: any) => us.tasks.map(mapTask)),
    ]);

    res.json({
      requirement: {
        id: requirement.id,
        input_text: requirement.title,
        status: requirement.status,
        rollup_status: reqTaskNodes.length > 0 ? rollup(reqTaskNodes) : null,
        can_execute: hasExecutable(reqTaskNodes),
        can_pause: hasRunning(reqTaskNodes),
        can_resume: hasPaused(reqTaskNodes),
        execution_id: null,
      },
      epics: epics.map((e: any) => {
        const orphanNodes = orphanUserStories.filter((us: any) => us.epic_id === e.id);
        const allStories = [
          ...e.features.flatMap((f: any) => f.user_stories),
          ...orphanNodes,
        ];
        const allTasks = allStories.flatMap((us: any) => us.tasks.map(mapTask));
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          module: e.module,
          status: rollup(allTasks),
          can_execute: hasExecutable(allTasks),
          can_pause: hasRunning(allTasks),
          can_resume: hasPaused(allTasks),
          features: e.features.map((f: any) => {
            const fTasks = f.user_stories.flatMap((us: any) => us.tasks.map(mapTask));
            return {
              id: f.id,
              title: f.title,
              description: f.description,
              status: rollup(fTasks),
              can_execute: hasExecutable(fTasks),
              can_pause: hasRunning(fTasks),
              can_resume: hasPaused(fTasks),
              user_stories: f.user_stories.map(mapStory),
            };
          }),
          orphan_user_stories: orphanNodes.map(mapStory),
        };
      }),
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
 * 不再直接调用 graphRunner，而是更新执行状态为 pending，
 * 由调度器自动拾取，确保并发控制（MAX_CONCURRENT）生效。
 * 前端通过 SSE 监听执行进度（已有机制）。
 */
requirementsRouter.post('/:id/execute', async (req, res) => {
  try {
    const requirementId = req.params.id;
    const requirement = await requirementStore.getById(requirementId);
    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    // 查找或创建执行实例
    let execution = await db.task_executions.findFirst({
      where: {
        subject_type: 'requirement',
        subject_id: requirementId,
      },
      orderBy: { created_at: 'desc' },
    });

    if (!execution) {
      // 首次执行：创建执行实例，调度器会自动拾取
      execution = await executionStore.create({
        subjectType: 'requirement',
        subjectId: requirementId,
        requirementId: requirement.id,
        targetProjectId: requirement.target_project_id,
        targetRepoPath: requirement.target_repo_path,
        status: 'pending',
      });
    } else {
      // 检查当前状态
      if (execution.status === 'running') {
        return res.status(409).json({
          error: '需求正在执行中',
          executionId: execution.execution_id,
        });
      }

      // 更新状态为 pending，调度器会自动拾取
      await db.task_executions.update({
        where: { execution_id: execution.execution_id },
        data: {
          status: 'pending',
          // 清理旧租约（如果有）
          worker_id: null,
          lease_token: null,
          lease_expires_at: null,
          // 重置错误信息
          error_message: null,
        },
      });
    }

    // 返回成功，前端通过 SSE 监听执行进度
    res.json({
      success: true,
      executionId: execution.execution_id,
      message: '需求已加入执行队列，调度器将自动处理',
    });
  } catch (err) {
    console.error('[requirements] 执行出错:', err);
    res.status(500).json({ error: '执行失败' });
  }
});

/**
 * POST /api/requirements/:id/pause
 * 暂停需求下所有 running + pending 任务
 *
 * 之前的 bug：只处理 running，pending 任务留在调度队列被捡起，导致"暂停后又继续"。
 */
requirementsRouter.post('/:id/pause', async (req, res) => {
  try {
    const count = await pauseExecutions({ requirement_id: req.params.id });
    res.json({ ok: true, paused_count: count });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/requirements/:id/resume
 * 恢复需求下所有已暂停/失败/停止的任务
 */
requirementsRouter.post('/:id/resume', async (req, res) => {
  try {
    const count = await resumeExecutions({ requirement_id: req.params.id });
    res.json({ ok: true, resumed_count: count });
  } catch (err) {
    res.status(500).json({ error: '恢复失败', detail: (err as Error).message });
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

    // 仅做状态转换（draft/pending → pending），实际启动交给调度器，
    // 避免绕过 MAX_CONCURRENT 并发控制
    const count = await enqueueExecutions({ tasks: { epic_id: epicId } });

    res.json({
      ok: true,
      started_count: count,
      message: count === 0 ? '无待执行任务' : `已将 ${count} 个任务加入调度队列`,
    });
  } catch (err) {
    res.status(500).json({ error: '执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/epics/:id/pause
 * 暂停该 Epic 下所有 running + pending 任务
 */
requirementsRouter.post('/epics/:id/pause', async (req, res) => {
  try {
    const count = await pauseExecutions({ tasks: { epic_id: req.params.id } });
    res.json({ ok: true, paused_count: count });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/epics/:id/resume
 * 恢复该 Epic 下所有已暂停/失败/停止的任务
 */
requirementsRouter.post('/epics/:id/resume', async (req, res) => {
  try {
    const count = await resumeExecutions({ tasks: { epic_id: req.params.id } });
    res.json({ ok: true, resumed_count: count });
  } catch (err) {
    res.status(500).json({ error: '恢复失败', detail: (err as Error).message });
  }
});

/**
 * 批量暂停执行：匹配 where 的执行按状态分类处理
 * - running → 标记 pause_requested + 触发 abort（由 graph-runner 最终落 status=paused）
 * - pending → 直接改 status='paused'，避免调度器继续拾取
 *
 * 之前的 bug：只处理 running，pending 任务留在队列里被调度器捡起，导致"暂停后又继续"。
 * 返回成功处理的总任务数。
 */
async function pauseExecutions(where: Record<string, any>): Promise<number> {
  const active = await db.task_executions.findMany({
    where: {
      ...where,
      status: { in: ['running', 'pending'] },
    },
    select: { execution_id: true, status: true },
  });

  if (active.length === 0) return 0;

  const { getAbortController } = await import('../graph/graph-runner.mjs');

  for (const exec of active) {
    if (exec.status === 'running') {
      // running：标记 pause_requested，graph-runner 的 catch 块会据此把 status 落为 paused
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { control_status: 'pause_requested' },
      });
      const abortController = getAbortController(exec.execution_id);
      if (abortController && !abortController.signal.aborted) {
        console.log(`[requirements] 暂停 API 直接触发 abort: ${exec.execution_id}`);
        abortController.abort();
      }
    } else if (exec.status === 'pending') {
      // pending：直接改状态为 paused，让调度器 acquireLease CAS 不再命中
      await db.task_executions.update({
        where: { execution_id: exec.execution_id },
        data: { status: 'paused', control_status: 'paused' },
      });
    }
  }

  return active.length;
}

/**
 * 批量恢复执行：将 paused/failed/stopped/cancelled 重置为 pending，交由调度器拾取
 * 返回恢复的任务数
 */
async function resumeExecutions(where: Record<string, any>): Promise<number> {
  const result = await db.task_executions.updateMany({
    where: {
      ...where,
      status: { in: ['paused', 'failed', 'stopped', 'cancelled'] },
    },
    data: {
      status: 'pending',
      control_status: 'idle',
      worker_id: null,
      lease_token: null,
      lease_expires_at: null,
      retry_at: null,
    },
  });
  return result.count;
}

/**
 * 批量入队执行：将 draft/pending 统一置为 pending，交回调度器拾取
 *
 * 与 resumeExecutions 的区别：入队只处理 draft/pending（可执行态），
 * 恢复处理 paused/failed/stopped/cancelled（中断态）。
 *
 * 路由层不做实际启动 —— 并发控制由 scheduler-controller 统一负责，
 * 直接调用 graphRunner.startExecution 会绕过 MAX_CONCURRENT 限制。
 */
async function enqueueExecutions(where: Record<string, any>): Promise<number> {
  const result = await db.task_executions.updateMany({
    where: {
      ...where,
      status: { in: ['draft', 'pending'] },
    },
    data: {
      status: 'pending',
      control_status: 'idle',
      worker_id: null,
      lease_token: null,
      lease_expires_at: null,
      retry_at: null,
    },
  });
  return result.count;
}

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
    // 仅做状态转换（draft/pending → pending），实际启动交给调度器
    const count = await enqueueExecutions({
      tasks: { user_stories: { feature_id: featureId } },
    });

    res.json({
      ok: true,
      started_count: count,
      message: count === 0 ? '无待执行任务' : `已将 ${count} 个任务加入调度队列`,
    });
  } catch (err) {
    res.status(500).json({ error: '执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/features/:id/pause
 * 暂停该 Feature 下所有 running + pending 任务
 */
requirementsRouter.post('/features/:id/pause', async (req, res) => {
  try {
    const count = await pauseExecutions({
      tasks: { user_stories: { feature_id: req.params.id } },
    });
    res.json({ ok: true, paused_count: count });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/features/:id/resume
 * 恢复该 Feature 下所有已暂停/失败/停止的任务
 */
requirementsRouter.post('/features/:id/resume', async (req, res) => {
  try {
    const count = await resumeExecutions({
      tasks: { user_stories: { feature_id: req.params.id } },
    });
    res.json({ ok: true, resumed_count: count });
  } catch (err) {
    res.status(500).json({ error: '恢复失败', detail: (err as Error).message });
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

    // 仅做状态转换（draft/pending → pending），实际启动交给调度器
    const count = await enqueueExecutions({ tasks: { user_story_id: userStoryId } });

    res.json({
      ok: true,
      started_count: count,
      message: count === 0 ? '无待执行任务' : `已将 ${count} 个任务加入调度队列`,
    });
  } catch (err) {
    res.status(500).json({ error: '执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/user-stories/:id/pause
 * 暂停该 UserStory 下所有 running + pending 任务
 */
requirementsRouter.post('/user-stories/:id/pause', async (req, res) => {
  try {
    const count = await pauseExecutions({ tasks: { user_story_id: req.params.id } });
    res.json({ ok: true, paused_count: count });
  } catch (err) {
    res.status(500).json({ error: '暂停失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/user-stories/:id/resume
 * 恢复该 UserStory 下所有已暂停/失败/停止的任务
 */
requirementsRouter.post('/user-stories/:id/resume', async (req, res) => {
  try {
    const count = await resumeExecutions({ tasks: { user_story_id: req.params.id } });
    res.json({ ok: true, resumed_count: count });
  } catch (err) {
    res.status(500).json({ error: '恢复失败', detail: (err as Error).message });
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
