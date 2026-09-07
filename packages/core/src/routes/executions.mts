// packages/core/src/routes/executions.mts
// 执行实例路由 —— 璇玑 V4 API 层
// 提供执行实例的查询、暂停、取消接口
// 暂停/取消通过修改 controlStatus 字段实现，由 worker-graph 轮询检测

import { Router } from 'express';
import { executionStore } from '../storage/execution-store.mjs';
import { db } from '../db.mjs';

export const executionsRouter: Router = Router();

/**
 * GET /api/executions
 * 执行实例列表（最近 50 条，按创建时间降序）
 */
executionsRouter.get('/', async (_req, res) => {
  try {
    const executions = await db.taskExecution.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(executions);
  } catch (err) {
    res.status(500).json({ error: '查询执行实例失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/executions/:id
 * 执行实例详情
 * 注意：主键是 executionId（Prisma schema 中 @id 字段）
 */
executionsRouter.get('/:id', async (req, res) => {
  try {
    const e = await executionStore.get(req.params.id);
    if (!e) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(e);
  } catch (err) {
    res.status(500).json({ error: '查询执行实例失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/pause
 * 请求暂停执行
 * 将 controlStatus 设置为 'pause_requested'，由 worker 轮询检测并响应
 */
executionsRouter.post('/:id/pause', async (req, res) => {
  try {
    await db.taskExecution.update({
      where: { executionId: req.params.id },
      data: { controlStatus: 'pause_requested' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '暂停执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/cancel
 * 请求取消执行
 * 将 controlStatus 设置为 'cancel_requested'，由 worker 轮询检测并响应
 */
executionsRouter.post('/:id/cancel', async (req, res) => {
  try {
    await db.taskExecution.update({
      where: { executionId: req.params.id },
      data: { controlStatus: 'cancel_requested' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '取消执行失败', detail: (err as Error).message });
  }
});
