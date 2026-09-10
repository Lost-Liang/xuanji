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
  const bindings = await db.agent_bindings.findMany({
    orderBy: { created_at: 'asc' },
  });

  // 前端期望的字段名（camelCase）
  const result = bindings.map((b) => ({
    id: b.id,
    plugin_id: b.plugin_id,
    agent_id: b.agent_id,
    omnigent_agent_id: null, // 不再使用，前端兼容字段
    harness: b.harness,
    skill_id: b.skill_id,
    prompt_content: b.prompt_content,
    triggers: b.triggers,
    model: b.model,
    reasoning_effort: b.reasoning_effort,
    created_at: b.created_at.toISOString(),
    session_count: 0, // 暂不统计，前端 ?? 0 兼容
  }));

  res.json(result);
});

// GET /:id - 详情
agentBindingsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;

  const binding = await db.agent_bindings.findUnique({
    where: { id },
  });

  if (!binding) {
    return res.status(404).json({ error: 'Agent binding not found' });
  }

  res.json({
    id: binding.id,
    plugin_id: binding.plugin_id,
    agent_id: binding.agent_id,
    omnigent_agent_id: null,
    harness: binding.harness,
    skill_id: binding.skill_id,
    prompt_content: binding.prompt_content,
    triggers: binding.triggers,
    model: binding.model,
    reasoning_effort: binding.reasoning_effort,
    created_at: binding.created_at.toISOString(),
    session_count: 0,
  });
});

// POST / - 创建
agentBindingsRouter.post('/', async (req: Request, res) => {
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
  }: {
    id?: string;
    plugin_id?: string | null;
    agent_id?: string;
    harness?: string;
    skill_id?: string | null;
    prompt_content?: string;
    triggers?: unknown;
    model?: string | null;
    reasoning_effort?: string | null;
  } = req.body;

  // id 缺省用 agent_id 或 uuid
  const bindingId = id || agent_id || crypto.randomUUID();

  const binding = await db.agent_bindings.create({
    data: {
      id: bindingId,
      plugin_id: plugin_id || null,
      agent_id: agent_id || bindingId,
      harness: harness || 'claude',
      skill_id: skill_id || null,
      prompt_content: prompt_content || '',
      triggers: triggers ? triggers : Prisma.JsonNull,
      model: model || null,
      reasoning_effort: reasoning_effort || null,
    },
  });

  res.status(201).json({
    id: binding.id,
    plugin_id: binding.plugin_id,
    agent_id: binding.agent_id,
    omnigent_agent_id: null,
    harness: binding.harness,
    skill_id: binding.skill_id,
    prompt_content: binding.prompt_content,
    triggers: binding.triggers,
    model: binding.model,
    reasoning_effort: binding.reasoning_effort,
    created_at: binding.created_at.toISOString(),
  });
});

// PUT /:id - 更新
agentBindingsRouter.put('/:id', async (req: Request, res) => {
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
  }: {
    plugin_id?: string | null;
    agent_id?: string;
    harness?: string;
    skill_id?: string | null;
    prompt_content?: string;
    triggers?: unknown;
    model?: string | null;
    reasoning_effort?: string | null;
  } = req.body;

  const binding = await db.agent_bindings.update({
    where: { id },
    data: {
      plugin_id,
      agent_id,
      harness,
      skill_id,
      prompt_content,
      triggers: triggers ? triggers : Prisma.JsonNull,
      model,
      reasoning_effort,
    },
  });

  res.json({
    id: binding.id,
    plugin_id: binding.plugin_id,
    agent_id: binding.agent_id,
    omnigent_agent_id: null,
    harness: binding.harness,
    skill_id: binding.skill_id,
    prompt_content: binding.prompt_content,
    triggers: binding.triggers,
    model: binding.model,
    reasoning_effort: binding.reasoning_effort,
    created_at: binding.created_at.toISOString(),
  });
});

// DELETE /:id - 删除
agentBindingsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;

  await db.agent_bindings.delete({
    where: { id },
  });

  res.json({ ok: true });
});