// packages/core/src/storage/decision-store.mts
// Agent 决策记录存储 —— 璇玑 V4 Audit 层
// 对应 decisions 表：记录 Agent 在各阶段做出的关键决策（含置信度、严重级别）

import { db } from '../db.mjs';
import type { decisions, Prisma } from '@prisma/client';

export const decisionStore = {
  /**
   * 创建决策记录
   *
   * @param data.execution_id 关联的执行实例 ID（可选）
   * @param data.task_id 关联的任务 ID（可选）
   * @param data.phase_instance_id 关联的阶段实例 ID（可选）
   * @param data.phase 决策所属阶段（如 'code-review' / 'security-review'）
   * @param data.decision 决策内容（如 'APPROVE' / 'REJECT' / '需要重构'）
   * @param data.confidence 置信度（0-100）
   * @param data.severity 严重级别（'green' / 'yellow' / 'red'）
   * @param data.raw 原始决策数据（JSON 字符串，可选）
   */
  async create(data: {
    execution_id?: string;
    task_id?: string;
    phase_instance_id?: string;
    phase: string;
    decision: string;
    confidence: number;
    severity?: string;
    raw?: string;
  }): Promise<decisions> {
    return db.decisions.create({
      data: {
        severity: 'green',
        ...data,
      },
    });
  },

  /**
   * 按 ID 查询决策
   */
  async getById(id: number): Promise<decisions | null> {
    return db.decisions.findUnique({ where: { id } });
  },

  /**
   * 按执行实例 ID 列出所有决策
   */
  async listByExecution(execution_id: string): Promise<decisions[]> {
    return db.decisions.findMany({
      where: { execution_id },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按任务 ID 列出所有决策
   */
  async listByTask(task_id: string): Promise<decisions[]> {
    return db.decisions.findMany({
      where: { task_id },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按阶段实例 ID 列出所有决策
   */
  async listByPhaseInstance(phase_instance_id: string): Promise<decisions[]> {
    return db.decisions.findMany({
      where: { phase_instance_id },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按严重级别过滤（用于仪表盘告警）
   */
  async listBySeverity(execution_id: string, severity: string): Promise<decisions[]> {
    return db.decisions.findMany({
      where: { execution_id, severity },
      orderBy: { created_at: 'desc' },
    });
  },

  /**
   * 批量创建决策（一次审查产生多条发现）
   */
  async createMany(data: Array<{
    execution_id?: string;
    task_id?: string;
    phase_instance_id?: string;
    phase: string;
    decision: string;
    confidence: number;
    severity?: string;
    raw?: string;
  }>): Promise<Prisma.BatchPayload> {
    return db.decisions.createMany({
      data: data.map((d) => ({ severity: 'green', ...d })),
    });
  },
};
