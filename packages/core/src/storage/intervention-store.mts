// packages/core/src/storage/intervention-store.mts
// 人工干预记录存储 —— 璇玑 V4 Audit 层
// 对应 interventions 表：记录人类对 Agent 执行过程的干预（反馈、改向、中止）

import { db } from '../db.mjs';
import type { interventions } from '@prisma/client';

// 干预类型枚举（与 schema 中 type 字段对齐）
export type InterventionType = 'feedback' | 'redirect' | 'abort';

// 干预状态枚举
export type InterventionStatus = 'pending' | 'applied' | 'dismissed';

export const interventionStore = {
  /**
   * 创建人工干预记录
   *
   * @param data.executionId 关联的执行实例 ID（可选）
   * @param data.taskId 关联的任务 ID（可选）
   * @param data.phaseId 关联的阶段 ID（可选）
   * @param data.type 干预类型：'feedback' | 'redirect' | 'abort'
   * @param data.message 干预内容
   * @param data.suggestedAgent 建议接手处理的 Agent binding ID（可选）
   */
  async create(data: {
    executionId?: string;
    taskId?: string;
    phaseId?: string;
    type: InterventionType;
    message: string;
    suggestedAgent?: string;
  }): Promise<interventions> {
    return db.interventions.create({
      data: {
        status: 'pending',
        execution_id: data.executionId,
        task_id: data.taskId,
        phase_id: data.phaseId,
        type: data.type,
        message: data.message,
        suggested_agent: data.suggestedAgent,
      },
    });
  },

  /**
   * 按 ID 查询干预记录
   */
  async getById(id: number): Promise<interventions | null> {
    return db.interventions.findUnique({ where: { id } });
  },

  /**
   * 按执行实例 ID 列出所有干预
   */
  async listByExecution(executionId: string): Promise<interventions[]> {
    return db.interventions.findMany({
      where: { execution_id: executionId },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按任务 ID 列出所有干预
   */
  async listByTask(taskId: string): Promise<interventions[]> {
    return db.interventions.findMany({
      where: { task_id: taskId },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按状态列出干预（用于仪表盘待处理队列）
   */
  async listByStatus(status: InterventionStatus): Promise<interventions[]> {
    return db.interventions.findMany({
      where: { status },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 更新干预状态（处理人工干预的流转）
   */
  async updateStatus(id: number, status: InterventionStatus): Promise<interventions> {
    return db.interventions.update({
      where: { id },
      data: { status },
    });
  },

  /**
   * 列出所有干预记录（分页）
   */
  async list(opts: { limit?: number; offset?: number } = {}): Promise<interventions[]> {
    return db.interventions.findMany({
      take: opts.limit ?? 100,
      skip: opts.offset ?? 0,
      orderBy: { created_at: 'desc' },
    });
  },
};
