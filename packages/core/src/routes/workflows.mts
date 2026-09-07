// packages/core/src/routes/workflows.mts
// 工作流路由 —— 璇玑 V4 API 层
// 提供工作流（YAML 定义的研发流程）的查询接口

import { Router } from 'express';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

export const workflowsRouter: Router = Router();

/**
 * GET /api/workflows
 * 工作流列表
 *
 * 扫描 workflows/ 目录下的所有 YAML 文件，返回工作流列表。
 * Dashboard 在创建需求时使用此列表选择工作流。
 */
workflowsRouter.get('/', async (_req, res) => {
  try {
    const workflowsDir = join(process.cwd(), 'workflows');
    const files = await readdir(workflowsDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    const workflows = [];

    for (const file of yamlFiles) {
      const content = await readFile(join(workflowsDir, file), 'utf-8');
      const def = parse(content) as { id?: string; name?: string; version?: number; description?: string };

      workflows.push({
        id: def.id ?? file.replace(/\.(yaml|yml)$/, ''),
        name: def.name ?? file,
        version: def.version ?? 1,
        description: def.description ?? '',
        file,
      });
    }

    res.json(workflows);
  } catch (err) {
    res.status(500).json({ error: '查询工作流失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/workflows/:id
 * 工作流详情（YAML 内容）
 */
workflowsRouter.get('/:id', async (req, res) => {
  try {
    const workflowsDir = join(process.cwd(), 'workflows');
    const files = await readdir(workflowsDir);
    const file = files.find(f => {
      const id = f.replace(/\.(yaml|yml)$/, '');
      return id === req.params.id || f === req.params.id;
    });

    if (!file) {
      res.status(404).json({ error: '工作流不存在' });
      return;
    }

    const content = await readFile(join(workflowsDir, file), 'utf-8');
    const def = parse(content);

    res.json(def);
  } catch (err) {
    res.status(500).json({ error: '查询工作流详情失败', detail: (err as Error).message });
  }
});
