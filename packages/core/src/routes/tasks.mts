// packages/core/src/routes/tasks.mts
// 任务路由 —— 璇玑 V4 API 层
// 提供任务的 CRUD 接口，支持按需求过滤

import { Router } from 'express';
import { taskStore } from '../storage/task-store.mjs';
import { db } from '../db.mjs';

export const tasksRouter: Router = Router();

/**
 * GET /api/tasks
 * 任务列表（可按 requirementId 过滤）
 * 无参数时返回全部任务（按 sequence 升序）
 */
tasksRouter.get('/', async (req, res) => {
  try {
    const { requirementId } = req.query;
    if (requirementId) {
      const tasks = await taskStore.listByRequirement(requirementId as string);
      res.json(tasks);
    } else {
      // 无过滤条件时返回全部任务
      const tasks = await db.task.findMany({
        orderBy: { sequence: 'asc' },
        take: 100,
      });
      res.json(tasks);
    }
  } catch (err) {
    res.status(500).json({ error: '查询任务失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/tasks/:id
 * 任务详情
 */
tasksRouter.get('/:id', async (req, res) => {
  try {
    const task = await taskStore.getById(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: '查询任务失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/tasks
 * 创建任务
 */
tasksRouter.post('/', async (req, res) => {
  try {
    const task = await taskStore.create(req.body);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: '创建任务失败', detail: (err as Error).message });
  }
});
