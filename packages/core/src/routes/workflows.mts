// packages/core/src/routes/workflows.mts
// 工作流路由 —— 璇玑 V4 API 层
// 提供工作流（YAML 定义的研发流程 + DB 用户流）的查询/创建/删除接口

import { Router } from 'express';
import { readdir, readFile, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { db } from '../db.mjs';

export const workflowsRouter: Router = Router();

/**
 * GET /api/workflows
 * 工作流列表
 *
 * 扫描 workflows/ 目录下的所有 YAML 文件（presets）+ DB 用户流（user）
 */
workflowsRouter.get('/', async (_req, res) => {
  try {
    const workflowsDir = join(process.cwd(), 'workflows');

    // presets（YAML）
    const presets = [];
    if (existsSync(workflowsDir)) {
      const files = await new Promise<string[]>((resolve, reject) => {
        readdir(workflowsDir, (err, files) => err ? reject(err) : resolve(files));
      });
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const content = await new Promise<string>((resolve, reject) => {
          readFile(join(workflowsDir, file), 'utf-8', (err, data) => err ? reject(err) : resolve(data));
        });
        const def = parse(content) as any;

        presets.push({
          id: def.id ?? file.replace(/\.(yaml|yml)$/, ''),
          name: def.name ?? file,
          version: def.version ?? '1',
          description: def.description ?? '',
          file,
          nodes: def.nodes || [],
          edges: def.edges || [],
          start: def.start || [],
          end: def.end || [],
          type: 'preset',
        });
      }
    }

    // user（DB graph_definitions）
    const userRows = await db.graphDefinition.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    const user = userRows.map((row) => {
      const def = row.definitionJson as any;
      return {
        id: row.id,
        name: row.name,
        version: '1',
        description: row.description || '',
        nodes: def?.nodes || [],
        edges: def?.edges || [],
        start: def?.start || [],
        end: def?.end || [],
        type: 'user',
      };
    });

    res.json({ presets, user });
  } catch (err) {
    res.status(500).json({ error: '查询工作流失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/workflows/:id
 * 工作流详情（YAML 内容 或 DB definition_json）
 */
workflowsRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workflowsDir = join(process.cwd(), 'workflows');

    // 先查 YAML preset
    if (existsSync(workflowsDir)) {
      const files = await new Promise<string[]>((resolve, reject) => {
        readdir(workflowsDir, (err, files) => err ? reject(err) : resolve(files));
      });
      const file = files.find(f => {
        const fileId = f.replace(/\.(yaml|yml)$/, '');
        return fileId === id || f === id;
      });

      if (file) {
        const content = await new Promise<string>((resolve, reject) => {
          readFile(join(workflowsDir, file), 'utf-8', (err, data) => err ? reject(err) : resolve(data));
        });
        const def = parse(content);
        return res.json({ ...def, type: 'preset' });
      }
    }

    // 再查 DB user
    const row = await db.graphDefinition.findUnique({
      where: { id },
    });

    if (!row) {
      return res.status(404).json({ error: '工作流不存在' });
    }

    const def = row.definitionJson as any;
    res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      version: '1',
      nodes: def?.nodes || [],
      edges: def?.edges || [],
      start: def?.start || [],
      end: def?.end || [],
      type: 'user',
    });
  } catch (err) {
    res.status(500).json({ error: '查询工作流详情失败', detail: (err as Error).message });
  }
});

/**
 * DELETE /api/workflows/:id
 * 删除用户工作流（仅 DB 用户流；preset 返回 403）
 */
workflowsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查是否是 preset
    const workflowsDir = join(process.cwd(), 'workflows');
    const yamlPath = join(workflowsDir, `${id}.yaml`);
    if (existsSync(yamlPath)) {
      return res.status(403).json({ error: 'Cannot delete preset workflow' });
    }

    await db.graphDefinition.delete({
      where: { id },
    });

    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: '工作流不存在' });
    }
    res.status(500).json({ error: '删除工作流失败', detail: err.message });
  }
});
