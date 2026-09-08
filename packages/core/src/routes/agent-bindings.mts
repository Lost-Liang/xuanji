// Agent Bindings API
// GET /api/agent-bindings - 列表
// GET /api/agent-bindings/:id - 详情
// POST /api/agent-bindings - 创建
// PUT /api/agent-bindings/:id - 更新
// DELETE /api/agent-bindings/:id - 删除

import { Router, type Request, type Response } from 'express';
import { db } from '../db.mjs';
import { Prisma } from '@prisma/client';

export const agentBindingsRouter: Router = Router();

// GET / - 列表
agentBindingsRouter.get('/', async (_req, res) => {
  const bindings = await db.agentBinding.findMany({
    orderBy: { createdAt: 'asc' },
  });

  // 前端期望的字段名（camelCase）
  const result = bindings.map((b) => ({
    id: b.id,
    plugin_id: b.pluginId,
    agent_id: b.agentId,
    omnigent_agent_id: null, // 不再使用，前端兼容字段
    harness: b.harness,
    skill_id: b.skillId,
    prompt_content: b.promptContent,
    triggers: b.triggers,
    model: b.model,
    reasoning_effort: b.reasoningEffort,
    created_at: b.createdAt.toISOString(),
    session_count: 0, // 暂不统计，前端 ?? 0 兼容
  }));

  res.json(result);
});

// GET /:id - 详情
agentBindingsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;

  const binding = await db.agentBinding.findUnique({
    where: { id },
  });

  if (!binding) {
    return res.status(404).json({ error: 'Agent binding not found' });
  }

  res.json({
    id: binding.id,
    plugin_id: binding.pluginId,
    agent_id: binding.agentId,
    omnigent_agent_id: null,
    harness: binding.harness,
    skill_id: binding.skillId,
    prompt_content: binding.promptContent,
    triggers: binding.triggers,
    model: binding.model,
    reasoning_effort: binding.reasoningEffort,
    created_at: binding.createdAt.toISOString(),
    session_count: 0,
  });
});

// POST / - 创建
agentBindingsRouter.post('/', async (req, res) => {
  const {
    id,
    plugin_id,
    agent_id,
    harness,
    skill_id,
    prompt_content,
    triggers,
    model,
    reasoning_effort,
  } = req.body;

  // id 缺省用 agent_id 或 uuid
  const bindingId = id || agent_id || crypto.randomUUID();

  const binding = await db.agentBinding.create({
    data: {
      id: bindingId,
      pluginId: plugin_id || null,
      agentId: agent_id || bindingId,
      harness: harness || 'claude',
      skillId: skill_id || null,
      promptContent: prompt_content || '',
      triggers: triggers ? triggers : Prisma.JsonNull,
      model: model || null,
      reasoningEffort: reasoning_effort || null,
    },
  });

  res.status(201).json({
    id: binding.id,
    plugin_id: binding.pluginId,
    agent_id: binding.agentId,
    omnigent_agent_id: null,
    harness: binding.harness,
    skill_id: binding.skillId,
    prompt_content: binding.promptContent,
    triggers: binding.triggers,
    model: binding.model,
    reasoning_effort: binding.reasoningEffort,
    created_at: binding.createdAt.toISOString(),
  });
});

// PUT /:id - 更新
agentBindingsRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    plugin_id,
    agent_id,
    harness,
    skill_id,
    prompt_content,
    triggers,
    model,
    reasoning_effort,
  } = req.body;

  const binding = await db.agentBinding.update({
    where: { id },
    data: {
      pluginId: plugin_id,
      agentId: agent_id,
      harness,
      skillId: skill_id,
      promptContent: prompt_content,
      triggers: triggers ? triggers : Prisma.JsonNull,
      model,
      reasoningEffort: reasoning_effort,
    },
  });

  res.json({
    id: binding.id,
    plugin_id: binding.pluginId,
    agent_id: binding.agentId,
    omnigent_agent_id: null,
    harness: binding.harness,
    skill_id: binding.skillId,
    prompt_content: binding.promptContent,
    triggers: binding.triggers,
    model: binding.model,
    reasoning_effort: binding.reasoningEffort,
    created_at: binding.createdAt.toISOString(),
  });
});

// DELETE /:id - 删除
agentBindingsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;

  await db.agentBinding.delete({
    where: { id },
  });

  res.json({ ok: true });
});