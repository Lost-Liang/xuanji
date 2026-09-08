// Agent Binding Store —— Prisma 查询层
// 读取 AgentBinding 配置供 agent-node 使用

import { db } from '../db.mjs';
import type { AgentBinding as PrismaAgentBinding } from '@prisma/client';

export type AgentBinding = PrismaAgentBinding;

export async function getByRole(ids: string[]): Promise<AgentBinding[]> {
  if (!ids.length) return [];
  return db.agentBinding.findMany({
    where: { id: { in: ids } },
  });
}

export async function list(): Promise<AgentBinding[]> {
  return db.agentBinding.findMany({
    orderBy: { createdAt: 'asc' },
  });
}

export async function getById(id: string): Promise<AgentBinding | null> {
  return db.agentBinding.findUnique({
    where: { id },
  });
}