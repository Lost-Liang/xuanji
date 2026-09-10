// packages/core/src/routes/conversations.mts
// 对话历史路由 —— 璇玑 V4 API 层
// 提供对话事件查询和人类追问（followup）接口
// followup 使用 runLocal() 的 resume 参数实现 --resume 会话恢复

import { Router } from 'express';
import { conversationStore } from '../storage/conversation-store.mjs';
import { executionStore } from '../storage/execution-store.mjs';
import { runLocal, type AdapterEvent } from '@xuanji/runner';

export const conversationsRouter: Router = Router();

/**
 * GET /api/conversations/:sessionId/events
 * 获取指定会话的完整对话历史
 * 返回按时间升序排列的所有对话事件（token 流 + 工具调用）
 */
conversationsRouter.get('/:sessionId/events', async (req, res) => {
  try {
    const events = await conversationStore.getBySession(req.params.sessionId);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: '查询对话历史失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/conversations/session/:sessionId/followup
 * 人类追问 —— 使用 --resume 继续已有会话
 *
 * 流程：
 * 1. 根据 executionId 查找执行实例，获取 provider 和 targetRepoPath
 * 2. 调用 runLocal() 并传入 resume 参数，恢复之前的 CLI 会话
 * 3. 每个 AdapterEvent 实时写入 conversation_events 表
 * 4. 返回 Agent 的最终输出
 */
conversationsRouter.post('/session/:sessionId/followup', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, executionId } = req.body;

    if (!executionId) {
      res.status(400).json({ error: 'executionId 字段必填' });
      return;
    }

    // 查找执行实例以获取 provider 和工作目录
    const execution = await executionStore.get(executionId);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }

    // 使用 --resume 恢复已有会话，追加人类的新消息
    const result = await runLocal({
      provider: (execution.provider as 'claude' | 'codex') || 'claude',
      prompt: '',
      workDir: execution.target_repo_path,
      resume: { providerConversationId: sessionId, input: message },
      // 执行实例 ID —— 用于 MCP 配置（如果需要 inbox_ask）
      executionId,
      onEvent: async (event: AdapterEvent) => {
        // 将每个适配器事件持久化到对话事件流
        await conversationStore.saveEvent({
          execution_id: executionId,
          session_id: sessionId,
          event_type: event.type,
          payload: JSON.parse(JSON.stringify(event)) as any,
        });
      },
    });

    res.json({ success: result.success, output: result.finalOutput });
  } catch (err) {
    res.status(500).json({ error: '追问失败', detail: (err as Error).message });
  }
});
