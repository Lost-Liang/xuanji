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
import { pollForAnswer } from '../graph/session-control-v2.mjs';

export const internalRouter: Router = Router();

// ─── 长轮询分片模式 ──────────────────────────────────────────────────────────
//
// 当 MCP Bridge 通过 HTTP 调用 inbox-ask 时，需要等待人类回答。
// pollForAnswer 使用数据库轮询，支持服务重启后继续等待。
// 单次轮询最多 30 秒，MCP Bridge 循环调用直到收到回答。
// Dashboard 通过 POST /api/inbox/:id/answer 回答时，
// inbox 路由更新数据库状态，pollForAnswer 在下次轮询时检测到回答。

// ─── POST /api/internal/inbox-ask ──────────────────────────────────────────────

/**
 * 提交 inbox_ask 问题或轮询等待回答（长轮询分片模式）
 *
 * 支持两种模式：
 *
 * 1. 创建模式：
 *    请求体: { create: true, executionId, question, choices? }
 *    - 创建问题记录并返回 questionId
 *    - 更新执行状态为 'waiting'
 *    - 返回 questionId 供后续轮询使用
 *
 * 2. 轮询模式：
 *    请求体: { questionId }
 *    - 使用 pollForAnswer 进行数据库轮询（单次最多 30 秒）
 *    - 返回状态：answered（已回答）, pending（继续轮询）, timeout（超时）
 *
 * 完整流程：
 * 1. MCP Bridge 第一次请求：create=true，创建问题并获取 questionId
 * 2. MCP Bridge 后续轮询：questionId，检查问题是否已回答
 * 3. 人类在 Dashboard 回答 → 问题状态变为 answered
 * 4. 下次轮询返回答案，恢复执行状态为 'running'
 *
 * 响应：
 * - 200: { questionId, status: 'answered', answer } - 已回答
 * - 200: { questionId, status: 'pending', continue: true } - 继续轮询
 * - 504: { questionId, status: 'timeout', error } - 超时
 * - 400: 参数错误
 * - 500: 服务器错误
 */
internalRouter.post('/inbox-ask', async (req, res) => {
  try {
    const { create, executionId, question, choices, questionId } = req.body as {
      create?: boolean;
      executionId?: string;
      question?: string;
      choices?: string[];
      questionId?: string;
    };

    let currentQuestionId = questionId;
    let execId = executionId;

    // ─── 创建模式 ──────────────────────────────────────────────────────────
    if (create) {
      if (!executionId || !question) {
        res.status(400).json({ error: '创建模式需要 executionId 和 question' });
        return;
      }

      currentQuestionId = randomUUID();
      const now = new Date();

      // 创建问题记录
      await db.inboxQuestion.create({
        data: {
          id: currentQuestionId,
          executionId,
          sessionId: null,
          body: question,
          choices: choices ? choices : Prisma.JsonNull,
          status: 'pending',
          waitingSince: now,
          processId: process.pid.toString(),
          timeoutMs: 24 * 60 * 60 * 1000, // 24 小时
        },
      });

      // 保存对话事件（用于 Dashboard 显示）
      await db.conversationEvent.create({
        data: {
          id: randomUUID(),
          executionId,
          eventType: 'inbox_ask',
          payload: {
            questionId: currentQuestionId,
            body: question,
            choices: choices ?? null,
            source: 'mcp-bridge',
          } as Prisma.InputJsonValue,
        },
      });

      // 更新执行状态为 waiting
      await db.taskExecution.update({
        where: { executionId },
        data: { status: 'waiting' },
      }).catch(() => {
        // 执行记录可能不存在，忽略错误
      });
    }

    // ─── 参数验证 ──────────────────────────────────────────────────────────
    if (!currentQuestionId) {
      res.status(400).json({ error: '缺少 questionId' });
      return;
    }

    // ─── 单次轮询（最多 30 秒）──────────────────────────────────────────────
    const result = await pollForAnswer(currentQuestionId, 30_000);

    if (result.status === 'answered' && result.answer) {
      // 获取 executionId（如果之前没有）
      if (!execId) {
        const q = await db.inboxQuestion.findUnique({
          where: { id: currentQuestionId },
          select: { executionId: true },
        });
        if (q?.executionId) {
          execId = q.executionId;
        }
      }

      if (execId) {
        // 记录回答事件
        await db.conversationEvent.create({
          data: {
            id: randomUUID(),
            executionId: execId,
            eventType: 'inbox_answer',
            payload: {
              questionId: currentQuestionId,
              answer: result.answer,
              source: 'mcp-bridge',
            } as Prisma.InputJsonValue,
          },
        });

        // 恢复执行状态为 running
        await db.taskExecution.update({
          where: { executionId: execId },
          data: { status: 'running' },
        }).catch(() => {
          // 执行记录可能不存在，忽略错误
        });
      }

      res.json({ questionId: currentQuestionId, status: 'answered', answer: result.answer });
    } else if (result.status === 'pending') {
      // 仍在等待，告知客户端继续轮询
      res.json({ questionId: currentQuestionId, status: 'pending', continue: true });
    } else {
      // 超时或其他错误
      res.status(504).json({
        questionId: currentQuestionId,
        status: 'timeout',
        error: '等待人类回答超时',
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: '处理 inbox_ask 失败', detail: errorMsg });
  }
});
