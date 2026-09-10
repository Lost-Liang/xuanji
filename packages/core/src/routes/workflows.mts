// packages/core/src/routes/workflows.mts
// 工作流路由 —— 璇玑 V4 API 层
// 提供工作流（YAML 定义的研发流程 + DB 用户流）的查询/创建/删除接口

import { Router } from 'express';
import { readdir, readFile, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { db } from '../db.mjs';

// 获取当前文件所在目录（ESM 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// workflows 目录相对于当前文件的位置（src/routes -> ../../workflows）
const WORKFLOWS_DIR = join(__dirname, '../../workflows');

export const workflowsRouter: Router = Router();

/**
 * GET /api/workflows
 * 工作流列表
 *
 * 扫描 workflows/ 目录下的所有 YAML 文件（presets）+ DB 用户流（user）
 */
workflowsRouter.get('/', async (_req, res) => {
  try {
    // presets（YAML）
    const presets = [];
    if (existsSync(WORKFLOWS_DIR)) {
      const files = await new Promise<string[]>((resolve, reject) => {
        readdir(WORKFLOWS_DIR, (err, files) => err ? reject(err) : resolve(files));
      });
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const content = await new Promise<string>((resolve, reject) => {
          readFile(join(WORKFLOWS_DIR, file), 'utf-8', (err, data) => err ? reject(err) : resolve(data));
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
    const userRows = await db.graph_definitions.findMany({
      orderBy: { updated_at: 'desc' },
    });

    const user = userRows.map((row: { id: string; name: string; description: string | null; definition_json: unknown }) => {
      const def = row.definition_json as Record<string, unknown> | null;
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

    // 先查 YAML preset
    if (existsSync(WORKFLOWS_DIR)) {
      const files = await new Promise<string[]>((resolve, reject) => {
        readdir(WORKFLOWS_DIR, (err, files) => err ? reject(err) : resolve(files));
      });
      const file = files.find(f => {
        const fileId = f.replace(/\.(yaml|yml)$/, '');
        return fileId === id || f === id;
      });

      if (file) {
        const content = await new Promise<string>((resolve, reject) => {
          readFile(join(WORKFLOWS_DIR, file), 'utf-8', (err, data) => err ? reject(err) : resolve(data));
        });
        const def = parse(content);
        return res.json({ ...def, type: 'preset' });
      }
    }

    // 再查 DB user
    const row = await db.graph_definitions.findUnique({
      where: { id },
    });

    if (!row) {
      return res.status(404).json({ error: '工作流不存在' });
    }

    const def = row.definition_json as Record<string, unknown> | null;
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
    const yamlPath = join(WORKFLOWS_DIR, `${id}.yaml`);
    if (existsSync(yamlPath)) {
      return res.status(403).json({ error: 'Cannot delete preset workflow' });
    }

    await db.graph_definitions.delete({
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
