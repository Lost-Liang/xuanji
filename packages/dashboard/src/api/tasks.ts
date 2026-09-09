// core/web/src/api/tasks.ts —— 任务 API 客户端（fetch 薄封装，照 requirements.ts 模式）
const base = '/api/tasks'

export interface TaskListItem {
  id: string
  title: string
  status: string
  task_id: string | null
  thread_id: string
  parent_execution_id: string | null
  current_node_id: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string | null
  rate_limited_count: number | null
  rate_limited_until: string | null
  breakdown_content: string | null
  session_ref_id: string | null
}

export interface PhaseOutput {
  id: string
  execution_id: string
  node_id: string
  iteration: number
  file_changes: any
  diff_content: string | null
  pr_url: string | null
  test_result: any
  review_result: any
  compile_result: any
  created_at: string
}

export interface SessionRef {
  id: string
  node_id: string
  iteration: number
  role: string
  omnigent_session_id: string
  omnigent_status: string
}

export interface TaskDetail {
  id: string
  title: string  // 任务标题（从 Task 表关联获取）
  status: string
  thread_id: string
  parent_execution_id: string | null
  parent_current_node_id: string | null
  parent_status: string | null
  current_node_id: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  rate_limited_count: number | null
  rate_limited_until: string | null
  task_id: string | null
  breakdown_content: string | null
  requirement_id: string | null
  graph_definition_id: string | null  // 图定义 ID（用于画布跳转）
  // token 聚合 + 循环计数（spec §9.4 子图执行态）
  token_in: number | null
  token_out: number | null
  cost: number | null
  loop_counters: Record<string, number> | null
  phase_outputs: PhaseOutput[]
  session_refs: SessionRef[]
}

export const api = {
  async list(requirementId?: string): Promise<TaskListItem[]> {
    const url = requirementId ? `${base}?requirement_id=${encodeURIComponent(requirementId)}` : base
    const r = await fetch(url)
    return r.json()
  },
  async get(id: string): Promise<TaskDetail> {
    const r = await fetch(`${base}/${id}`)
    return r.json()
  },
  async pause(execId: string): Promise<any> {
    const r = await fetch(`/api/executions/${execId}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'sub' }),
    })
    return r.json()
  },
  async resume(execId: string): Promise<any> {
    const r = await fetch(`/api/executions/${execId}/resume`, { method: 'POST' })
    return r.json()
  },
  async cancel(execId: string): Promise<any> {
    const r = await fetch(`/api/executions/${execId}/cancel`, { method: 'POST' })
    return r.json()
  },
  async retry(execId: string, nodeId: string): Promise<any> {
    const r = await fetch(`/api/executions/${execId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, mode: 'message' }),
    })
    return r.json()
  },
  async delete(id: string): Promise<any> {
    const r = await fetch(`${base}/${id}`, { method: 'DELETE' })
    return r.json()
  },
  async gate(execId: string, decision: string, comments?: string): Promise<any> {
    const r = await fetch(`/api/executions/${execId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, comments }),
    })
    return r.json()
  },
  async chat(refId: string, message: string): Promise<any> {
    const r = await fetch(`/api/sessions/${refId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    return r.json()
  },
  async confirm(execId: string): Promise<any> {
    const r = await fetch(`${base}/${execId}/confirm`, { method: 'POST' })
    return r.json()
  },
  async execute(execId: string): Promise<any> {
    const r = await fetch(`${base}/${execId}/execute`, { method: 'POST' })
    return r.json()
  },
}
