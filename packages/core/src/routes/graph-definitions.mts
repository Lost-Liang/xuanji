// Graph Definitions API
// GET /api/graph-definitions - 列表（presets from YAML + user from DB）
// GET /api/graph-definitions/:id - 详情（返回 definition_json）
// POST /api/graph-definitions - 创建（仅用户流，存 DB）
// PUT /api/graph-definitions/:id - 更新（仅用户流）
// DELETE /api/graph-definitions/:id - 删除（仅用户流）

import { Router } from 'express';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { db } from '../db.mjs';
import { loadWorkflowFromFile, mapYamlToGraphDef } from '../graph/yaml-loader.mjs';
import type { GraphDef } from '../graph/types.mjs';

export const graphDefinitionsRouter: Router = Router();

// cwd = packages/core（运行时）
const WORKFLOWS_DIR = () => join(process.cwd(), 'workflows');

// 扫描 presets（workflows/*.yaml）
async function scanPresetGraphs(): Promise<Array<{ id: string; name: string; description: string; type: 'preset' }>> {
  const dir = WORKFLOWS_DIR();
  if (!existsSync(dir)) return [];

  const results: Array<{ id: string; name: string; description: string; type: 'preset' }> = [];

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;

    try {
      const workflow = await loadWorkflowFromFile(join(dir, entry.name));
      const graphDef = mapYamlToGraphDef(workflow);
      results.push({
        id: graphDef.id || entry.name.replace(/\.yaml$/, ''),
        name: graphDef.name,
        description: graphDef.description || '',
        type: 'preset',
      });
    } catch (e) {
      console.error(`[graph-definitions] 解析 preset 失败: ${entry.name}`, e);
    }
  }

  return results;
}

// GET / - 列表
graphDefinitionsRouter.get('/', async (_req, res) => {
  // presets（YAML）
  const presets = await scanPresetGraphs();

  // user（DB）
  const userRows = await db.graphDefinition.findMany({
    orderBy: { updatedAt: 'desc' },
  });

  const user = userRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    type: 'user' as const,
  }));

  res.json({ presets, user });
});

// GET /:id - 详情
graphDefinitionsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;

  // 先查 preset（YAML）
  const yamlPath = join(WORKFLOWS_DIR(), `${id}.yaml`);
  if (existsSync(yamlPath)) {
    try {
      const workflow = await loadWorkflowFromFile(yamlPath);
      const graphDef = mapYamlToGraphDef(workflow);
      return res.json({
        id: graphDef.id,
        name: graphDef.name,
        description: graphDef.description || '',
        plugin_id: graphDef.plugin_id || null,
        definition_json: graphDef,
        type: 'preset',
      });
    } catch (e) {
      console.error(`[graph-definitions] 加载 preset 失败: ${id}`, e);
      return res.status(500).json({ error: 'Failed to load preset graph' });
    }
  }

  // 再查 user（DB）
  const row = await db.graphDefinition.findUnique({
    where: { id },
  });

  if (!row) {
    return res.status(404).json({ error: 'Graph definition not found' });
  }

  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    plugin_id: row.pluginId,
    definition_json: row.definitionJson,
    type: 'user',
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
});

// POST / - 创建（仅用户流）
graphDefinitionsRouter.post('/', async (req, res) => {
  const { id, name, description, plugin_id, definition_json } = req.body;

  if (!id || !name || !definition_json) {
    return res.status(400).json({ error: 'id, name, definition_json are required' });
  }

  // 检查是否与 preset 冲突
  const yamlPath = join(WORKFLOWS_DIR(), `${id}.yaml`);
  if (existsSync(yamlPath)) {
    return res.status(409).json({ error: 'Cannot overwrite preset graph' });
  }

  const row = await db.graphDefinition.create({
    data: {
      id,
      name,
      description: description || null,
      pluginId: plugin_id || null,
      definitionJson: definition_json,
    },
  });

  res.status(201).json({
    id: row.id,
    name: row.name,
    description: row.description,
    plugin_id: row.pluginId,
    definition_json: row.definitionJson,
    type: 'user',
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
});

// PUT /:id - 更新（仅用户流）
graphDefinitionsRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, plugin_id, definition_json } = req.body;

  // 检查是否是 preset
  const yamlPath = join(WORKFLOWS_DIR(), `${id}.yaml`);
  if (existsSync(yamlPath)) {
    return res.status(403).json({ error: 'Cannot modify preset graph' });
  }

  const row = await db.graphDefinition.update({
    where: { id },
    data: {
      name,
      description: description || null,
      pluginId: plugin_id || null,
      definitionJson: definition_json,
    },
  });

  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    plugin_id: row.pluginId,
    definition_json: row.definitionJson,
    type: 'user',
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
});

// DELETE /:id - 删除（仅用户流）
graphDefinitionsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;

  // 检查是否是 preset
  const yamlPath = join(WORKFLOWS_DIR(), `${id}.yaml`);
  if (existsSync(yamlPath)) {
    return res.status(403).json({ error: 'Cannot delete preset graph' });
  }

  await db.graphDefinition.delete({
    where: { id },
  });

  res.json({ ok: true });
});