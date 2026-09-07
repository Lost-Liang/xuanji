// packages/core/src/routes/internal.mts
// 内部 API 路由 —— 璇玑 V4 MCP Bridge 专用
//
// 提供给 MCP Bridge 子进程（mcp-bridge.ts）调用的内部端点。
// 这些端点不面向 Dashboard，仅供 MCP Server 子进程通过 HTTP 调用。
//
// 端点：
// - POST /api/internal/inbox-ask: 提交 inbox_ask 问题并长轮询等待回答
//   用于 MCP Bridge 的 inbox_ask 工具实现

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../db.mjs';
import { waitForHumanAnswer, notifyHumanAnswered } from '../graph/session-control-v2.mjs';

export const internalRouter: Router = Router();

// ─── 长轮询等待注册表 ──────────────────────────────────────────────────────────
//
// 当 MCP Bridge 通过 HTTP 调用 inbox-ask 时，需要等待人类回答。
// waitForHumanAnswer 使用进程内 Promise，与 session-control-v2 的机制一致。
// Dashboard 通过 POST /api/inbox/:id/answer 回答时，
// inbox 路由调用 notifyHumanAnswered，解除 waitForHumanAnswer 的阻塞。

// ─── POST /api/internal/inbox-ask ──────────────────────────────────────────────

/**
 * 提交 inbox_ask 问题并阻塞等待人类回答（长轮询）
 *
 * 完整流程：
 * 1. MCP Bridge 子进程发送 POST 请求，携带 question 和 executionId
 * 2. 将问题写入 inbox_questions 表（status='pending'）
 * 3. 调用 waitForHumanAnswer(questionId) 阻塞等待
 * 4. 人类在 Dashboard 回答 → POST /api/inbox/:id/answer
 *    → inbox 路由更新 DB 并调用 notifyHumanAnswered
 *    → waitForHumanAnswer resolve
 * 5. 返回答案给 MCP Bridge → Agent 继续执行
 *
 * 超时处理：
 * - waitForHumanAnswer 默认超时 24 小时
 * - 超时后 Promise reject，返回 504 错误
 * - MCP Bridge 收到错误后返回给 Agent
 *
 * 请求体：
 * - executionId: string - 当前执行实例 ID
 * - question: string - 问题内容
 * - choices?: string[] - 可选的预设选项
 *
 * 响应：
 * - 200: { questionId, answer } - 人类的回答
 * - 504: 等待超时
 * - 500: 服务器错误
 */
internalRouter.post('/inbox-ask', async (req, res) => {
  try {
    const { executionId, question, choices } = req.body as {
      executionId: string;
      question: string;
      choices?: string[];
    };

    if (!executionId || !question) {
      res.status(400).json({ error: '缺少必要参数: executionId, question' });
      return;
    }

    // 生成问题 ID 并写入 inbox_questions 表
    const questionId = randomUUID();

    await db.inboxQuestion.create({
      data: {
        id: questionId,
        executionId,
        sessionId: null,
        body: question,
        choices: choices ? choices : Prisma.JsonNull,
        status: 'pending',
      },
    });

    // 保存对话事件（用于 Dashboard 显示）
    await db.conversationEvent.create({
      data: {
        id: randomUUID(),
        executionId,
        eventType: 'inbox_ask',
        payload: {
          questionId,
          body: question,
          choices: choices ?? null,
          source: 'mcp-bridge',
        } as Prisma.InputJsonValue,
      },
    });

    // 阻塞等待人类回答（使用 session-control-v2 的 Promise 机制）
    // 默认超时 24 小时
    const answer = await waitForHumanAnswer(questionId);

    // 记录对话事件（人类回答）
    await db.conversationEvent.create({
      data: {
        id: randomUUID(),
        executionId,
        eventType: 'inbox_answer',
        payload: {
          questionId,
          answer,
          source: 'mcp-bridge',
        } as Prisma.InputJsonValue,
      },
    });

    res.json({ questionId, answer });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 超时错误
    if (errorMsg.includes('超时')) {
      res.status(504).json({ error: errorMsg });
      return;
    }

    res.status(500).json({ error: '处理 inbox_ask 失败', detail: errorMsg });
  }
});
