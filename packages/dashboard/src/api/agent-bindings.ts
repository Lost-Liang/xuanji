// core/web/src/api/agent-bindings.ts —— Agent 绑定 API 客户端（fetch 薄封装，照 tasks.ts 模式）
const base = '/api/agent-bindings'

export interface AgentBinding {
  id: string
  plugin_id: string | null
  agent_id: string
  omnigent_agent_id: string | null
  harness: string
  skill_id: string | null
  prompt_content: string | null
  triggers: any
  model: string | null
  reasoning_effort: string | null
  created_at: string
  session_count?: number
}

export const api = {
  async list(): Promise<AgentBinding[]> {
    const r = await fetch(base)
    return r.json()
  },
  async get(id: string): Promise<AgentBinding> {
    const r = await fetch(`${base}/${id}`)
    return r.json()
  },
  async create(b: Partial<AgentBinding>): Promise<any> {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })
    return r.json()
  },
  async update(id: string, b: Partial<AgentBinding>): Promise<any> {
    const r = await fetch(`${base}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })
    return r.json()
  },
  async remove(id: string): Promise<any> {
    const r = await fetch(`${base}/${id}`, { method: 'DELETE' })
    return r.json()
  },
}

// 执行总览列表端点（executions.mts GET /）
export interface ExecutionListItem {
  id: string
  status: string
  thread_id: string | null
  current_node_id: string | null
  started_at: string | null
  finished_at: string | null
  subject_type: string
  subject_id: string | null
  parent_execution_id: string | null
  loop_counters: any
  requirement_text: string | null
  task_count: number
  phase_count: number
}

export interface SubExecution {
  id: string
  status: string
  current_node_id: string | null
  subject_id: string | null
  started_at: string | null
  finished_at: string | null
}

export const execApi = {
  async list(): Promise<ExecutionListItem[]> {
    const r = await fetch('/api/executions?subject_type=requirement')
    return r.json()
  },
  async subExecutions(id: string): Promise<SubExecution[]> {
    const r = await fetch(`/api/executions/${id}/sub-executions`)
    return r.json()
  },
}

// —— 画布用：agent binding id → 中文 agent 名（节点 label 缺省时回填）——
let labelCache: Map<string, string> | null = null

export const agentApi = {
  async list(): Promise<AgentBinding[]> {
    return api.list()
  },
  /** 获取所有 agent binding 的 id → agent_id 映射 */
  async getLabelMap(): Promise<Map<string, string>> {
    if (labelCache) return labelCache
    const list = await api.list()
    const map = new Map<string, string>()
    for (const b of list) {
      map.set(b.id, b.agent_id || b.id)
    }
    labelCache = map
    return map
  },
  invalidateCache() { labelCache = null },
}
