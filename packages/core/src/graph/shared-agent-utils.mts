// packages/core/src/graph/shared-agent-utils.mts
// 共享 Agent 工具函数 —— 璇玑 V4 LangGraph 编排层
//
// 提取 worker-graph.mts 和 agent-node.mts 的公共逻辑，避免代码重复：
// 1. mapAdapterEvent —— 将 AdapterEvent 映射为 conversationStore 事件类型
// 2. handleInboxAsk —— 处理 Agent 的 inbox_ask 请求（人机交互核心流程）
//
// 两处使用场景：
// - worker-graph.mts: 调度图的工作节点
// - agent-node.mts: 画布图的 agent 节点工厂

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AdapterEvent } from '@xuanji/runner';
import { db } from '../db.mjs';
import { conversationStore } from '../storage/conversation-store.mjs';
import { waitForHumanAnswer } from './session-control-v2.mjs';

// ─── 事件映射 ──────────────────────────────────────────────────────────────────

/**
 * 将 AdapterEvent 映射为 conversationStore 的 eventType
 *
 * Adapter 事件类型 → 对话事件类型：
 * - system/init     → model_started（模型开始生成）
 * - assistant       → model_delta（模型增量输出）
 * - user            → tool_completed（工具执行完成）
 * - result/success  → final_output（最终输出）
 * - result/error    → error（错误事件）
 *
 * 此函数在 worker-graph.mts 和 agent-node.mts 中都被使用，
 * 提取为共享函数避免代码重复。
 */
export function mapAdapterEvent(event: AdapterEvent): {
  eventType: string;
  role?: string;
  payload: Prisma.InputJsonValue;
} | null {
  switch (event.type) {
    case 'system':
      // 只在会话初始化时记录
      if (event.subtype === 'init') {
        return {
          eventType: 'model_started',
          payload: { sessionId: event.sessionId } as Prisma.InputJsonValue,
        };
      }
      // 其他 system 事件不记录
      return null;
    case 'assistant':
      return {
        eventType: 'model_delta',
        role: 'assistant',
        payload: {
          message: event.message,
          toolUse: event.toolUse,
        } as Prisma.InputJsonValue,
      };
    case 'user':
      return {
        eventType: 'tool_completed',
        role: 'user',
        payload: {
          message: event.message,
          toolResult: event.toolResult,
        } as Prisma.InputJsonValue,
      };
    case 'result':
      if (event.subtype === 'error') {
        return {
          eventType: 'error',
          payload: { error: event.error } as Prisma.InputJsonValue,
        };
      }
      return {
        eventType: 'final_output',
        payload: { output: event.output } as Prisma.InputJsonValue,
      };
  }
}

// ─── 人机交互处理 ──────────────────────────────────────────────────────────────

/**
 * 处理 Agent 的 inbox_ask 请求（人机交互核心流程）
 *
 * 完整流程：
 * 1. Agent 调用 inbox_ask MCP 工具（在 CLI 进程内）
 * 2. MCP Server → runLocal 的 onInboxAsk 回调（本函数）
 * 3. 写入 inbox_questions 表（status='pending'），Dashboard 可通过 /api/inbox/pending 查询
 * 4. 调用 waitForHumanAnswer(questionId) —— 阻塞 onInboxAsk 回调
 *    （CLI 进程在等待期间空闲，不消耗 token，进程不退出但定时器已 unref）
 * 5. 人类在 Dashboard 看到问题，提交回答
 * 6. Dashboard API（POST /api/inbox/:id/answer）更新 DB 并调用 notifyHumanAnswered
 * 7. notifyHumanAnswered 解除 waitForHumanAnswer 的阻塞
 * 8. 本函数返回答案给 MCP Server → Agent 继续执行（同一会话，无需 --resume）
 *
 * 超时处理：
 * - 默认 24 小时（DEFAULT_TIMEOUT_MS in session-control-v2.mts）
 * - 超时后 Promise reject，本函数抛出 Error，runLocal 失败
 * - 对应 task_execution 状态变为 failed
 *
 * @param executionId - 当前 task_execution 的 ID（用于 DB 关联）
 * @param sessionId - 当前 CLI 会话 ID（用于 DB 关联，可为 null）
 * @param question - MCP inbox_ask 工具传入的问题对象
 * @returns 人类的回答内容（string），传回 MCP Server 给 Agent
 * @throws Error 等待超时
 */
export async function handleInboxAsk(
  executionId: string | undefined,
  sessionId: string | null,
  question: { id: string; body: string; choices?: string[] },
): Promise<string> {
  // 生成 DB 主键
  const questionId = randomUUID();

  // 保存问题到 inbox_questions 表
  // Dashboard 通过 GET /api/inbox/pending 查询 status='pending' 的记录
  await db.inbox_questions.create({
    data: {
      id: questionId,
      execution_id: executionId ?? null,
      session_id: sessionId ?? null,
      body: question.body,
      choices: question.choices ? question.choices : Prisma.JsonNull,
      status: 'pending',
    },
  });

  // 保存对话事件（用于 Dashboard 对话历史显示）
  await conversationStore.saveEvent({
    execution_id: executionId,
    session_id: sessionId ?? undefined,
    event_type: 'inbox_ask',
    payload: {
      questionId,
      body: question.body,
      choices: question.choices ?? null,
      source: 'onInboxAsk',
    } as Prisma.InputJsonValue,
  });

  // 阻塞等待人类回答
  // waitForHumanAnswer 内部维护 Promise + 全局 Map
  // notifyHumanAnswered（由 inbox 路由调用）触发 resolve 解除阻塞
  const answer = await waitForHumanAnswer(questionId);

  // 保存回答事件
  await conversationStore.saveEvent({
    execution_id: executionId,
    session_id: sessionId ?? undefined,
    event_type: 'inbox_answer',
    payload: {
      questionId,
      answer,
      source: 'onInboxAsk',
    } as Prisma.InputJsonValue,
  });

  return answer;
}
