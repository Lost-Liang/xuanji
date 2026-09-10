// packages/core/src/storage/conversation-store.mts
// 对话事件存储 —— 璇玑 V4 Storage 层
// 完整记录每次 Agent 对话的 token 流和工具调用

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { conversation_events, Prisma } from '@prisma/client';

export const conversationStore = {
  /**
   * 保存对话事件
   *
   * eventType 枚举值：
   * - model_started:   模型开始生成
   * - model_delta:     模型增量输出（每个 token）
   * - tool_started:    工具调用开始
   * - tool_completed:  工具调用完成
   * - final_output:    最终输出
   * - inbox_ask:       Agent 向人类提问
   * - inbox_answer:    人类回答
   * - error:           错误事件
   */
  async saveEvent(data: {
    execution_id?: string;
    session_id?: string;
    turn_index?: number;
    event_type: string;
    role?: string;
    payload: Prisma.InputJsonValue;
  }): Promise<conversation_events> {
    return db.conversation_events.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    });
  },

  /**
   * 根据执行实例 ID 获取完整对话流
   */
  async getByExecution(execution_id: string): Promise<conversation_events[]> {
    return db.conversation_events.findMany({
      where: { execution_id },
      orderBy: { created_at: 'asc' },
    });
  },

  /**
   * 根据会话 ID 获取对话流（用于 --resume 恢复会话）
   */
  async getBySession(session_id: string): Promise<conversation_events[]> {
    return db.conversation_events.findMany({
      where: { session_id },
      orderBy: { created_at: 'asc' },
    });
  },
};
