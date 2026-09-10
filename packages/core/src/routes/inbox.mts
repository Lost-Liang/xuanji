// packages/core/src/routes/inbox.mts
// 人机交互路由 —— 璇玑 V4 API 层
// Agent 通过 inbox_ask 工具向人类提问，人类通过此 API 提交回答
// 回答后通过 notifyHumanAnswered 通知等待中的 agent-node（session-control-v2.mts 实现）

import { Router } from 'express';
import { db } from '../db.mjs';
import { notifyHumanAnswered } from '../graph/session-control-v2.mjs';

export const inboxRouter: Router = Router();

/**
 * GET /api/inbox/pending
 * 获取所有待回答的问题列表
 * Dashboard 轮询此接口以展示待处理的人机交互
 */
inboxRouter.get('/pending', async (_req, res) => {
  try {
    const questions = await db.inbox_questions.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
    });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: '查询待回答问题失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/inbox/:id/answer
 * 提交人类回答
 *
 * 流程：
 * 1. 更新 inbox_questions 表（answer/status='answered'/answeredAt）
 * 2. 调用 notifyHumanAnswered(id, answer) 解除 handleInboxAsk 中 waitForHumanAnswer 的阻塞
 * 3. agent-node 的 handleInboxAsk 收到答案并返回给 MCP Server
 * 4. Agent 继续执行（同一 CLI 会话，无需 --resume）
 *
 * 注意：如果 agent 执行已超时（waitForHumanAnswer 的 Promise 已 reject），
 * notifyHumanAnswered 会返回 false（无等待中的 Promise），但 DB 更新仍然成功，
 * 问题状态保持为 'answered'，Dashboard 可以正确显示。
 */
inboxRouter.post('/:id/answer', async (req, res) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;

    if (!answer) {
      res.status(400).json({ error: 'answer 字段必填' });
      return;
    }

    // 先更新数据库（幂等操作，即使 notify 失败也保留了人类回答记录）
    const updated = await db.inbox_questions.update({
      where: { id },
      data: {
        answer,
        status: 'answered',
        answered_at: new Date(),
      },
    });

    // 通知 session-control-v2 解除 waitForHumanAnswer 的阻塞
    // 返回 false 不影响正常响应（可能已超时，但 DB 已更新）
    const notified = notifyHumanAnswered(id, answer);

    res.json({
      ...updated,
      // 附加通知状态供 Dashboard 调试：false 表示 agent 已不在等待（可能超时）
      _notified: notified,
    });
  } catch (err) {
    res.status(500).json({ error: '提交回答失败', detail: (err as Error).message });
  }
});
