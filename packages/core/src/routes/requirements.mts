// packages/core/src/routes/requirements.mts
// 需求路由 —— 璇玑 V4 API 层
// 提供需求的 CRUD 接口 + 执行触发

import { Router } from 'express';
import { requirementStore } from '../storage/requirement-store.mjs';
import { executionStore } from '../storage/execution-store.mjs';
import { db } from '../db.mjs';

export const requirementsRouter: Router = Router();

/**
 * GET /api/requirements
 * 需求列表（按创建时间降序）
 */
requirementsRouter.get('/', async (_req, res) => {
  try {
    const requirements = await requirementStore.list();
    res.json(requirements);
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
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: '查询需求失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/requirements
 * 创建需求
 */
requirementsRouter.post('/', async (req, res) => {
  try {
    const requirement = await requirementStore.create(req.body);
    res.json(requirement);
  } catch (err) {
    res.status(500).json({ error: '创建需求失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/requirements/:id/execute
 * 触发需求执行
 *
 * 创建执行实例并启动 worker 执行需求分析
 */
requirementsRouter.post('/:id/execute', async (req, res) => {
  try {
    const requirementId = req.params.id;
    const requirement = await requirementStore.getById(requirementId);

    if (!requirement) {
      res.status(404).json({ error: '需求不存在' });
      return;
    }

    // 创建执行实例
    const execution = await executionStore.create({
      subjectType: 'requirement',
      subjectId: requirementId,
      targetProjectId: requirement.targetProjectId,
      targetRepoPath: requirement.targetRepoPath,
    });

    const executionId = execution.executionId;

    // 异步启动 worker（不阻塞响应）
    setImmediate(async () => {
      try {
        console.log(`[requirements] 开始执行需求 ${requirementId}，执行实例 ${executionId}`);

        // 更新状态为 running
        await db.taskExecution.update({
          where: { executionId },
          data: { status: 'running', startedAt: new Date() },
        });

        // TODO: 调用 workerNode 或 buildRecoveryGraph 执行需求分析
        // 当前简化为直接更新状态
        // 完整实现需要集成 LangGraph 调度器

        // 临时：标记为完成
        await executionStore.complete(executionId, '需求分析完成（临时实现）');
        await requirementStore.updateStatus(requirementId, 'completed');
        console.log(`[requirements] 需求 ${requirementId} 执行完成`);
      } catch (err) {
        console.error(`[requirements] 执行需求 ${requirementId} 出错:`, err);
        await executionStore.fail(executionId, (err as Error).message);
        await requirementStore.updateStatus(requirementId, 'failed');
      }
    });

    res.json({
      success: true,
      executionId,
      message: '执行已启动',
    });
  } catch (err) {
    res.status(500).json({ error: '触发执行失败', detail: (err as Error).message });
  }
});
