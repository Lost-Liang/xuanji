// packages/core/src/routes/inbox.mts
// 人机交互路由 —— 璇玑 V4 API 层
// Agent 通过 inbox_ask 工具向人类提问，人类通过此 API 提交回答
// 回答后通过 notifyHumanAnswered 通知等待中的 agent-node（Task 11 实现）

import { Router } from 'express';
import { db } from '../db.mjs';

export const inboxRouter: Router = Router();

/**
 * GET /api/inbox/pending
 * 获取所有待回答的问题列表
 * Dashboard 轮询此接口以展示待处理的人机交互
 */
inboxRouter.get('/pending', async (_req, res) => {
  try {
    const questions = await db.inboxQuestion.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: '查询待回答问题失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/inbox/:id/answer
 * 提交人类回答
 * 更新 InboxQuestion 的 answer/status/answeredAt 字段
 * 后续 Task 11 将在此处添加 notifyHumanAnswered() 调用以唤醒等待的 agent
 */
inboxRouter.post('/:id/answer', async (req, res) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;

    if (!answer) {
      res.status(400).json({ error: 'answer 字段必填' });
      return;
    }

    const updated = await db.inboxQuestion.update({
      where: { id },
      data: {
        answer,
        status: 'answered',
        answeredAt: new Date(),
      },
    });

    // TODO: Task 11 添加 —— 通知 session-control-v2 的 waitForHumanAnswer 解除阻塞
    // notifyHumanAnswered(id, answer);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '提交回答失败', detail: (err as Error).message });
  }
});
