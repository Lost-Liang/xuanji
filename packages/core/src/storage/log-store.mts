// packages/core/src/storage/log-store.mts
// 任务日志存储 —— 璇玑 V4 Audit 层
// 对应 task_logs 表：记录任务执行过程中的关键日志信息

import { db } from '../db.mjs';
import type { task_logs } from '@prisma/client';

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
    execution_id?: string;
    task_id?: string;
    requirement_id?: string;
    phase?: string;
    message: string;
  }): Promise<task_logs> {
    return db.task_logs.create({
      data: {
        execution_id: data.execution_id,
        task_id: data.task_id,
        requirement_id: data.requirement_id,
        phase: data.phase,
        message: data.message,
      },
    });
  },

  /**
   * 按 ID 查询日志
   */
  async getById(id: number): Promise<task_logs | null> {
    return db.task_logs.findUnique({ where: { id } });
  },

  /**
   * 按执行实例 ID 列出所有日志（按时间升序）
   */
  async listByExecution(executionId: string): Promise<task_logs[]> {
    return db.task_logs.findMany({
      where: { execution_id: executionId },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按任务 ID 列出所有日志
   */
  async listByTask(taskId: string): Promise<task_logs[]> {
    return db.task_logs.findMany({
      where: { task_id: taskId },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按需求 ID 列出所有日志
   */
  async listByRequirement(requirementId: string): Promise<task_logs[]> {
    return db.task_logs.findMany({
      where: { requirement_id: requirementId },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 列出最近 N 条日志（全局）
   */
  async listRecent(limit: number = 100): Promise<task_logs[]> {
    return db.task_logs.findMany({
      take: limit,
      orderBy: { created_at: 'desc' },
    });
  },
};