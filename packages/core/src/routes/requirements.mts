// packages/core/src/routes/requirements.mts
// 需求路由 —— 璇玑 V4 API 层
// 提供需求的 CRUD 接口

import { Router } from 'express';
import { requirementStore } from '../storage/requirement-store.mjs';

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
