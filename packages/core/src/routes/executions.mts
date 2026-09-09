// packages/core/src/routes/executions.mts
// 执行实例路由 —— 璇玑 V4 API 层
// 提供执行实例的查询、暂停、取消接口
// 暂停/取消通过修改 controlStatus 字段实现，由 worker-graph 轮询检测并响应

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { executionStore } from '../storage/execution-store.mjs';
import { db } from '../db.mjs';

export const executionsRouter: Router = Router();

// =============================================================================
// 字段映射：Prisma (camelCase) <-> Dashboard (snake_case)
// =============================================================================

/**
 * 将 Prisma TaskExecution 对象映射为 Dashboard 期望的 ExecutionListItem 格式
 */
async function toExecutionListItem(e: any): Promise<any> {
  // 查询关联需求文本
  let requirementText: string | null = null;
  if (e.subjectType === 'requirement' && e.subjectId) {
    try {
      const req = await db.requirement.findUnique({ where: { id: e.subjectId }, select: { title: true } });
      requirementText = req?.title ?? null;
    } catch { /* ignore */ }
  } else if (e.requirementId) {
    try {
      const req = await db.requirement.findUnique({ where: { id: e.requirementId }, select: { title: true } });
      requirementText = req?.title ?? null;
    } catch { /* ignore */ }
  }

  // 查询子任务数和 phase 数
  let taskCount = 0;
  let phaseCount = 0;
  try {
    phaseCount = await db.phaseInstance.count({ where: { executionId: e.executionId } });
    if (e.subjectType === 'requirement' && e.subjectId) {
      // 需求级执行：统计该需求下的任务数
      taskCount = await db.task.count({
        where: {
          epic: { requirementId: e.subjectId },
        },
      });
    }
  } catch { /* ignore */ }

  // 聚合 phase_nodes：{ phaseId: status }
  let phaseNodes: Record<string, string> = {};
  try {
    const phases = await db.phaseInstance.findMany({
      where: { executionId: e.executionId },
      select: { phaseId: true, status: true },
    });
    phaseNodes = phases.reduce((acc: Record<string, string>, p: any) => {
      acc[p.phaseId] = p.status;
      return acc;
    }, {});
  } catch { /* ignore */ }

  return {
    id: e.executionId,
    status: e.status,
    graph_definition_id: e.graphDefinitionId ?? null,
    thread_id: e.threadId ?? e.sessionId, // thread_id 优先，回退 sessionId
    current_node_id: e.stage || null,
    phase_nodes: phaseNodes,
    started_at: e.startedAt?.toISOString?.() ?? e.startedAt,
    finished_at: e.completedAt?.toISOString?.() ?? e.completedAt,
    subject_type: e.subjectType,
    subject_id: e.subjectId,
    parent_execution_id: null, // V4 暂不支持父子执行
    loop_counters: {},         // V4 暂无
    token_input: null,         // 占位
    token_output: null,        // 占位
    requirement_text: requirementText,
    task_count: taskCount,
    phase_count: phaseCount,
  };
}

// =============================================================================
// 路由
// =============================================================================

/**
 * GET /api/executions
 * 执行实例列表（最近 50 条，按创建时间降序）
 * 支持过滤：?subject_type=&requirement_id=
 */
executionsRouter.get('/', async (req, res) => {
  try {
    const { subject_type, requirement_id } = req.query;

    const where: any = {};
    if (subject_type) {
      where.subjectType = subject_type as string;
    }
    if (requirement_id) {
      where.requirementId = requirement_id as string;
    }

    const executions = await db.taskExecution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // 映射字段格式
    const items = await Promise.all(executions.map(toExecutionListItem));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: '查询执行实例失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/executions/:id
 * 执行实例详情
 * 注意：主键是 executionId（Prisma schema 中 @id 字段）
 */
executionsRouter.get('/:id', async (req, res) => {
  try {
    const e = await executionStore.get(req.params.id);
    if (!e) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    // 映射为 Dashboard 格式
    const item = await toExecutionListItem(e);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: '查询执行实例失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/executions/:id/sub-executions
 * 子执行实例列表
 */
executionsRouter.get('/:id/sub-executions', async (req, res) => {
  try {
    // V4 暂无父子执行关系，返回空数组
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: '查询子执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/pause
 * 请求暂停执行
 * 将 controlStatus 设置为 'pause_requested'，由 worker 轮询检测并响应
 */
executionsRouter.post('/:id/pause', async (req, res) => {
  try {
    await db.taskExecution.update({
      where: { executionId: req.params.id },
      data: { controlStatus: 'pause_requested' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '暂停执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/cancel
 * 请求取消执行
 * 将 controlStatus 设置为 'cancel_requested'，由 worker 轮询检测并响应
 */
executionsRouter.post('/:id/cancel', async (req, res) => {
  try {
    await db.taskExecution.update({
      where: { executionId: req.params.id },
      data: { controlStatus: 'cancel_requested' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '取消执行失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/gate
 * Review gate 决策
 */
executionsRouter.post('/:id/gate', async (req, res) => {
  try {
    const { decision, comments } = req.body;
    // 记录决策到 decisions 表
    await db.decision.create({
      data: {
        executionId: req.params.id,
        phase: 'gate',
        decision: decision || 'unknown',
        confidence: 100,
        severity: 'green',
        raw: comments || null,
      },
    });
    res.json({ ok: true, decision });
  } catch (err) {
    res.status(500).json({ error: 'Gate 决策失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/resume
 * 请求恢复执行
 * 将 controlStatus 设置为 'resume_requested'，M1 接图续跑
 */
executionsRouter.post('/:id/resume', async (req, res) => {
  try {
    await db.taskExecution.update({
      where: { executionId: req.params.id },
      data: { controlStatus: 'resume_requested' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '恢复执行失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/executions/:id/events
 * 获取执行实例的历史对话事件
 * 返回格式与 LiveEventStream 组件期望的格式匹配
 */
executionsRouter.get('/:id/events', async (req, res) => {
  try {
    const events = await db.conversationEvent.findMany({
      where: { executionId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });

    // 转换为前端期望的格式
    const result: Array<{
      type: string;
      node_id: string;
      text?: string;
      created_at: string;
    }> = [];

    for (const e of events) {
      const payload = e.payload as Record<string, any>;

      // 根据 eventType 决定返回格式
      if (e.eventType === 'model_delta') {
        // model_delta 来自 assistant 事件，payload 包含 message 字段
        let text = '';
        if (typeof payload?.message === 'string') {
          text = payload.message;
        } else if (payload?.message?.content) {
          text = payload.message.content;
        } else if (payload?.text) {
          text = payload.text;
        } else if (payload?.delta) {
          text = payload.delta;
        }

        // 只返回有文本内容的事件（过滤掉纯工具调用事件）
        if (text && text.length > 0) {
          result.push({
            type: 'token',
            node_id: e.role || 'agent',
            text,
            created_at: e.createdAt?.toISOString?.() ?? String(e.createdAt),
          });
        }
      } else if (e.eventType === 'tool_completed') {
        // 工具完成事件 - 标记阶段完成
        result.push({
          type: 'done',
          node_id: payload?.tool_name || e.role || 'tool',
          text: payload?.result || '',
          created_at: e.createdAt?.toISOString?.() ?? String(e.createdAt),
        });
      } else if (e.eventType === 'final_output') {
        // 最终输出
        result.push({
          type: 'done',
          node_id: 'output',
          text: payload?.output || '',
          created_at: e.createdAt?.toISOString?.() ?? String(e.createdAt),
        });
      } else if (e.eventType === 'error') {
        // 错误事件
        result.push({
          type: 'error',
          node_id: 'system',
          text: payload?.error || '未知错误',
          created_at: e.createdAt?.toISOString?.() ?? String(e.createdAt),
        });
      } else if (e.eventType === 'inbox_ask') {
        // 人机交互提问
        result.push({
          type: 'inbox_ask',
          node_id: 'agent',
          text: payload?.body || '',
          created_at: e.createdAt?.toISOString?.() ?? String(e.createdAt),
        });
      } else if (e.eventType === 'inbox_answer') {
        // 人机交互回答
        result.push({
          type: 'inbox_answer',
          node_id: 'human',
          text: payload?.answer || '',
          created_at: e.createdAt?.toISOString?.() ?? String(e.createdAt),
        });
      }
      // model_started 事件不返回（没有实际内容）
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '获取事件失败', detail: (err as Error).message });
  }
});

/**
 * GET /api/executions/:id/stream
 * SSE 实时事件流
 * 使用轮询方式检查新事件，推送给前端
 */
executionsRouter.get('/:id/stream', async (req, res) => {
  const executionId = req.params.id;

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲

  // 发送初始连接消息
  res.write('data: {"type":"connected"}\n\n');

  // 跟踪最后看到的事件时间戳（使用 createdAt 而非 id，因为 UUID 字典序不可靠）
  let lastEventAt: Date | null = null;

  // 获取数据库中最后一个事件的时间戳
  try {
    const lastEvent = await db.conversationEvent.findFirst({
      where: { executionId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (lastEvent) {
      lastEventAt = lastEvent.createdAt;
    }
  } catch {
    // 初始查询失败，继续运行
  }

  // 轮询间隔 500ms
  const pollInterval = setInterval(async () => {
    try {
      // 检查执行状态
      const exec = await db.taskExecution.findUnique({
        where: { executionId },
        select: { status: true },
      });

      if (!exec || exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled') {
        // 执行已结束，发送结束消息并关闭连接
        res.write(`data: {"type":"execution_done","status":"${exec?.status || 'unknown'}"}\n\n`);
        clearInterval(pollInterval);
        res.end();
        return;
      }

      // waiting/paused 状态：Agent 在等待人类回答，通知前端刷新问题列表
      if (exec.status === 'waiting' || exec.status === 'paused') {
        res.write(`data: {"type":"execution_done","status":"${exec.status}"}\n\n`);
        // 不关闭连接，继续轮询等待恢复
      }

      // 查询新事件（使用 createdAt 时间戳过滤，避免 UUID 字典序比较不可靠）
      const whereClause: any = { executionId };
      if (lastEventAt) {
        whereClause.createdAt = { gt: lastEventAt };
      }

      const newEvents = await db.conversationEvent.findMany({
        where: whereClause,
        orderBy: { createdAt: 'asc' },
      });

      for (const e of newEvents) {
        const payload = e.payload as Record<string, any>;

        // 转换为 SSE 消息格式
        if (e.eventType === 'model_delta') {
          // 提取文本内容
          let text = '';
          if (typeof payload?.message === 'string') {
            text = payload.message;
          } else if (payload?.message?.content) {
            text = payload.message.content;
          } else if (payload?.text) {
            text = payload.text;
          } else if (payload?.delta) {
            text = payload.delta;
          }

          // 只推送有文本内容的事件
          if (text && text.length > 0) {
            const msg = {
              type: 'token',
              node_id: e.role || 'agent',
              text,
            };
            res.write(`data: ${JSON.stringify(msg)}\n\n`);
          }
        } else if (e.eventType === 'tool_completed') {
          const msg = {
            type: 'done',
            node_id: payload?.tool_name || e.role || 'tool',
          };
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        } else if (e.eventType === 'final_output') {
          const msg = {
            type: 'done',
            node_id: 'output',
          };
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        } else if (e.eventType === 'error') {
          const msg = {
            type: 'error',
            node_id: 'system',
            text: payload?.error || '未知错误',
          };
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        } else if (e.eventType === 'inbox_ask') {
          // 人机交互提问，通知前端刷新
          const msg = {
            type: 'inbox_ask',
            node_id: 'agent',
            text: payload?.body || '',
          };
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        } else if (e.eventType === 'inbox_answer') {
          const msg = {
            type: 'inbox_answer',
            node_id: 'human',
            text: payload?.answer || '',
          };
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        }
        // model_started 事件不推送（没有实际内容）

        // 更新最后事件时间戳
        if (!lastEventAt || e.createdAt > lastEventAt) {
          lastEventAt = e.createdAt;
        }
      }
    } catch (err) {
      console.error('[executions/stream] 轮询错误:', err);
      // 出错但不关闭连接，继续轮询
    }
  }, 500);

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(pollInterval);
    res.end();
  });
});

/**
 * GET /api/executions/:id/elicitations
 * 获取该执行实例的待回答问题（人机交互）
 * 返回 inbox_questions 表中 status='pending' 且 executionId 匹配的记录
 */
executionsRouter.get('/:id/elicitations', async (req, res) => {
  try {
    // 禁用缓存，确保实时获取
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const questions = await db.inboxQuestion.findMany({
      where: {
        executionId: req.params.id,
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
    });

    // 转换为 LiveEventStream 期望的格式
    const result = questions.map((q: any) => ({
      id: q.id,
      execution_id: q.executionId,
      body: q.body,
      choices: q.choices,
      created_at: q.createdAt?.toISOString?.() ?? null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '获取问题列表失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/elicitations/:questionId/reply
 * 提交人类回答
 */
executionsRouter.post('/:id/elicitations/:questionId/reply', async (req, res) => {
  try {
    const { answer } = req.body;
    const { questionId } = req.params;

    if (!answer) {
      res.status(400).json({ error: 'answer 字段必填' });
      return;
    }

    // 更新问题状态
    const updated = await db.inboxQuestion.update({
      where: { id: questionId },
      data: {
        answer: typeof answer === 'string' ? answer : answer.content || JSON.stringify(answer),
        status: 'answered',
        answeredAt: new Date(),
      },
    });

    // 通知 session-control-v2 解除 waitForHumanAnswer 的阻塞
    // handleInboxAsk 会自动创建 inbox_answer 事件，这里不再重复创建
    const { notifyHumanAnswered } = await import('../graph/session-control-v2.mjs');
    const notified = notifyHumanAnswered(questionId, answer);

    res.json({ ...updated, _notified: notified });
  } catch (err) {
    res.status(500).json({ error: '提交回答失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/executions/:id/dialog
 * 对话式回复（用于连续对话场景）
 */
executionsRouter.post('/:id/dialog', async (req, res) => {
  try {
    const { message, action } = req.body;

    // 如果是跳过/结束对话
    if (action === 'skip') {
      // 找到该执行的所有 pending 问题并标记为 answered
      await db.inboxQuestion.updateMany({
        where: {
          executionId: req.params.id,
          status: 'pending',
        },
        data: {
          status: 'answered',
          answeredAt: new Date(),
          answer: '[用户跳过]',
        },
      });
      res.json({ ok: true, action: 'skipped' });
      return;
    }

    // 如果有消息，记录并通知
    if (message) {
      // 创建或更新问题记录
      const existingQuestion = await db.inboxQuestion.findFirst({
        where: {
          executionId: req.params.id,
          status: 'pending',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingQuestion) {
        await db.inboxQuestion.update({
          where: { id: existingQuestion.id },
          data: {
            answer: message,
            status: 'answered',
            answeredAt: new Date(),
          },
        });

        // 通知 MCP bridge 解除 waitForHumanAnswer 阻塞
        // inbox_answer 事件由 internal.mts 的 waitForHumanAnswer 返回后创建
        // 这里不再重复创建，避免数据重复
        const { notifyHumanAnswered } = await import('../graph/session-control-v2.mjs');
        notifyHumanAnswered(existingQuestion.id, message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '对话处理失败', detail: (err as Error).message });
  }
});
