// packages/core/src/storage/log-store.mts
// 任务日志存储 —— 璇玑 V4 Audit 层
// 对应 task_logs 表：记录任务执行过程中的关键日志信息

import { db } from '../db.mjs';
import type { TaskLog } from '@prisma/client';

export const logStore = {
  /**
   * 创建任务日志
   *
   * @param data.executionId 关联的执行实例 ID（可选）
   * @param data.taskId 关联的任务 ID（可选）
   * @param data.requirementId 关联的需求 ID（可选）
   * @param data.phase 所属阶段（如 'develop' / 'compile_check' / 'testing'）
   * @param data.message 日志内容
   */
  async create(data: {
    executionId?: string;
    taskId?: string;
    requirementId?: string;
    phase?: string;
    message: string;
  }): Promise<TaskLog> {
    return db.taskLog.create({ data });
  },

  /**
   * 按 ID 查询日志
   */
  async getById(id: number): Promise<TaskLog | null> {
    return db.taskLog.findUnique({ where: { id } });
  },

  /**
   * 按执行实例 ID 列出所有日志（按时间升序）
   */
  async listByExecution(executionId: string): Promise<TaskLog[]> {
    return db.taskLog.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * 按任务 ID 列出所有日志
   */
  async listByTask(taskId: string): Promise<TaskLog[]> {
    return db.taskLog.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * 按需求 ID 列出所有日志
   */
  async listByRequirement(requirementId: string): Promise<TaskLog[]> {
    return db.taskLog.findMany({
      where: { requirementId },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * 列出最近 N 条日志（全局）
   */
  async listRecent(limit: number = 100): Promise<TaskLog[]> {
    return db.taskLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  },
};
