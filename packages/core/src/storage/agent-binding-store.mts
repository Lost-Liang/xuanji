// Agent Binding Store —— Prisma 查询层
// 读取 AgentBinding 配置供 agent-node 使用

import { db } from '../db.mjs';
import type { agent_bindings } from '@prisma/client';

export type AgentBinding = agent_bindings;

export async function getByRole(ids: string[]): Promise<AgentBinding[]> {
  if (!ids.length) return [];
  return db.agent_bindings.findMany({
    where: { id: { in: ids } },
  });
}

export async function list(): Promise<AgentBinding[]> {
  return db.agent_bindings.findMany({
    orderBy: { created_at: 'asc' },
  });
}

export async function getById(id: string): Promise<AgentBinding | null> {
  return db.agent_bindings.findUnique({
    where: { id },
  });
}