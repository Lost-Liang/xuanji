// packages/core/src/routes/projects.mts
// 项目路由 —— 璇玑 V4 API 层
// 提供项目的 CRUD 接口

import { Router } from 'express';
import { db } from '../db.mjs';

export const projectsRouter: Router = Router();

// =============================================================================
// 字段映射：Prisma (camelCase) <-> Dashboard (snake_case)
// =============================================================================

/**
 * 将 Prisma Project 对象映射为 API 响应格式
 */
function toResponse(p: any) {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    description: p.description ?? null,
    created_at: p.createdAt?.toISOString?.() ?? p.createdAt,
    updated_at: p.updatedAt?.toISOString?.() ?? p.updatedAt,
  };
}

// =============================================================================
// 路由
// =============================================================================

/**
 * GET /api/projects
 * 项目列表（按更新时间降序）
 */
projectsRouter.get('/', async (_req, res) => {
  try {
    const projects = await db.projects.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    res.json(projects.map(toResponse));
  } catch (err) {
    res.status(500).json({ error: '查询项目失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/projects
 * 添加项目
 */
projectsRouter.post('/', async (req, res) => {
  try {
    const { name, path, description } = req.body;

    if (!name || !path) {
      res.status(400).json({ error: 'name 和 path 必填' });
      return;
    }

    const project = await db.projects.create({
      data: {
        id: crypto.randomUUID(),
        name,
        path,
        description,
        updatedAt: new Date(),
      },
    });

    res.status(201).json(toResponse(project));
  } catch (err: any) {
    // Prisma unique constraint violation (path 已存在)
    if (err.code === 'P2002') {
      res.status(409).json({ error: '项目路径已存在' });
      return;
    }
    res.status(500).json({ error: '创建项目失败', detail: err.message });
  }
});

/**
 * DELETE /api/projects/:id
 * 删除项目
 */
projectsRouter.delete('/:id', async (req, res) => {
  try {
    await db.projects.delete({
      where: { id: req.params.id },
    });
    res.json({ ok: true });
  } catch (err: any) {
    // Prisma record not found
    if (err.code === 'P2025') {
      res.status(404).json({ error: '项目不存在' });
      return;
    }
    res.status(500).json({ error: '删除项目失败', detail: err.message });
  }
});