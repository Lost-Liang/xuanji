// packages/core/src/storage/event-store.mts
// 执行事件流存储 —— 璇玑 V4 Audit 层
// 对应 execution_events 表：记录执行实例的状态变迁事件（限流、超时、完成、失败）

import { db } from '../db.mjs';
import type { execution_events } from '@prisma/client';

// 事件类型枚举（与 schema 中 event_type 字段对齐）
export type ExecutionEventType =
  | 'rate_limited'     // 触发 429 限流
  | 'timed_out'        // 执行超时
  | 'completed'        // 正常完成
  | 'failed'           // 执行失败
  | 'started'          // 开始执行
  | 'paused'           // 暂停
  | 'resumed'          // 恢复
  | 'cancelled';       // 取消

export const eventStore = {
  /**
   * 创建执行事件
   *
   * @param data.executionId 关联的执行实例 ID（必填）
   * @param data.eventType 事件类型
   * @param data.fromStatus 原状态（可选）
   * @param data.toStatus 新状态（可选）
   * @param data.message 事件说明（可选）
   */
  async create(data: {
    execution_id: string;
    event_type: ExecutionEventType | string;
    from_status?: string;
    to_status?: string;
    message?: string;
  }): Promise<execution_events> {
    return db.execution_events.create({ data });
  },

  /**
   * 按 ID 查询事件
   */
  async getById(id: number): Promise<execution_events | null> {
    return db.execution_events.findUnique({ where: { id } });
  },

  /**
   * 按执行实例 ID 列出所有事件（时间升序，用于追踪执行过程）
   */
  async listByExecution(execution_id: string): Promise<execution_events[]> {
    return db.execution_events.findMany({
      where: { execution_id },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 按事件类型过滤（用于统计限流/超时频率）
   */
  async listByType(event_type: string, limit: number = 100): Promise<execution_events[]> {
    return db.execution_events.findMany({
      where: { event_type },
      take: limit,
      orderBy: { created_at: 'desc' },
    });
  },

  /**
   * 列出最近 N 条事件（全局，用于仪表盘）
   */
  async listRecent(limit: number = 100): Promise<execution_events[]> {
    return db.execution_events.findMany({
      take: limit,
      orderBy: { created_at: 'desc' },
    });
  },

  /**
   * 批量创建事件（调度器一次性产生多条事件时使用）
   */
  async createMany(data: Array<{
    execution_id: string;
    event_type: string;
    from_status?: string;
    to_status?: string;
    message?: string;
  }>): Promise<{ count: number }> {
    return db.execution_events.createMany({ data });
  },
};
