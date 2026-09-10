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

    // 级联删除：删除整个分解树和关联执行
    // 1. 删除所有关联的 TaskExecutions（需求级 + 任务级）
    await db.task_executions.deleteMany({
      where: {
        OR: [
          { subject_type: 'requirement', subject_id: requirementId },
          { requirement_id: requirementId },
        ],
      },
    });

    // 2. 删除所有关联的 Tasks（通过 Epic 层级联）
    await db.tasks.deleteMany({
      where: {
        epic: {
          requirement_id: requirementId,
        },
      },
    });

    // 3. 删除所有关联的 UserStories
    await db.user_stories.deleteMany({
      where: {
        OR: [
          { epic: { requirement_id: requirementId } },
          { feature: { epic: { requirement_id: requirementId } } },
        ],
      },
    });

    // 4. 删除所有关联的 Features
    await db.features.deleteMany({
      where: {
        epic: {
          requirement_id: requirementId,
        },
      },
    });

    // 5. 删除所有关联的 Epics
    await db.epics.deleteMany({
      where: {
        requirement_id: requirementId,
      },
    });

    // 6. 删除需求本身
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
   * 创建需求执行实例（长期方案）
   *
   * 职责：
   * 1. 创建执行实例（status='draft'）
   * 2. 返回执行 ID，由用户在 Dashboard 手动触发
   *
   * 注意：创建后保持 draft 状态，需要手动调用 POST /api/executions/:id/execute 触发执行。
   */
requirementsRouter.post('/:id/execute', async (req, res) => {
  try {
    const requirementId = req.params.id;
    const requirement = await requirementStore.getById(requirementId);

    if (!requirement) {
      res.status(404).json({ error: '需求不存在' });
      return;
    }

    // 创建执行实例（status='draft'，不自动触发）
    const execution = await executionStore.create({
      subjectType: 'requirement',
      subjectId: requirementId,
      targetProjectId: requirement.target_project_id,
      targetRepoPath: requirement.target_repo_path,
    });

    const executionId = execution.execution_id;

    res.json({
      success: true,
      executionId,
      message: '需求执行实例已创建（status=draft），请在 Dashboard 手动触发执行',
      status: 'draft',
    });
  } catch (err) {
    res.status(500).json({ error: '创建需求执行失败', detail: (err as Error).message });
  }
});
