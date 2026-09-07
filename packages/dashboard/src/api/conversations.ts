// packages/dashboard/src/api/conversations.ts —— 对话历史 API 客户端
// 对接璇玑 Core 的 /api/conversations 路由（routes/conversations.mts）
//
// 对话事件（token 流 + 工具调用）持久化到 conversation_events 表。
// Dashboard 按 sessionId 查询完整对话流，支持人类通过 followup 追问。

const base = '/api/conversations'

/** 单个对话事件（对应 conversation_events 表） */
export interface ConversationEvent {
  id: string
  executionId: string | null
  sessionId: string | null
  turnIndex: number | null
  /**
   * 事件类型：
   * - model_started:  模型开始生成
   * - model_delta:    模型增量输出（每个 token）
   * - tool_started:   工具调用开始
   * - tool_completed: 工具调用完成
   * - final_output:   最终输出
   * - inbox_ask:      Agent 向人类提问
   * - inbox_answer:   人类回答
   * - error:          错误事件
   */
  eventType: string
  role: 'assistant' | 'user' | 'system' | null
  payload: Record<string, unknown>
  createdAt: string
}

/** followup 接口的响应 */
export interface FollowupResponse {
  success: boolean
  output: string | null
}

export const conversationsApi = {
  /**
   * 获取指定会话的完整对话历史（按 createdAt 升序）
   *
   * 返回该 sessionId 下所有的 token 流事件和工具调用事件，
   * Dashboard 按时间线渲染。
   */
  async getEvents(sessionId: string): Promise<ConversationEvent[]> {
    const r = await fetch(`${base}/${encodeURIComponent(sessionId)}/events`)
    if (!r.ok) {
      throw new Error(`查询对话历史失败: ${r.status} ${r.statusText}`)
    }
    return r.json()
  },

  /**
   * 人类追问 —— 使用 --resume 继续已有会话
   *
   * 1. Core 根据 executionId 查找 provider 和 targetRepoPath
   * 2. 调用 runLocal() 并传入 resume 参数，恢复之前的 CLI 会话
   * 3. 每个适配器事件实时写入 conversation_events 表
   * 4. 返回 Agent 的最终输出
   */
  async followup(
    sessionId: string,
    executionId: string,
    message: string,
  ): Promise<FollowupResponse> {
    const r = await fetch(
      `${base}/session/${encodeURIComponent(sessionId)}/followup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId, message }),
      },
    )
    if (!r.ok) {
      const text = await r.text()
      throw new Error(`追问失败: ${r.status} ${text}`)
    }
    return r.json()
  },
}
