// core/web/src/api/requirements.ts —— 需求 API 客户端（fetch 薄封装，照 graph.ts 模式）
const base = '/api/requirements'

export interface CreateRequirement {
  id: string
  input_text: string
  workflow_id?: string
  targetRepoPath?: string  // 工作目录
}

export interface RequirementListItem {
  id: string
  input_text: string
  spec_content: string | null
  status: string
  execution_id: string | null
  created_at: string
  execution_status: string | null
  execution_thread_id: string | null
}

export interface SessionRef {
  id: string
  node_id: string
  iteration: number
  role: string
  omnigent_session_id: string
  omnigent_status: string
}

export interface RequirementDetail {
  id: string
  input_text: string
  spec_content: string | null
  status: string
  execution_id: string | null
  created_at: string
  execution: any
  session_refs: SessionRef[]
}

export interface RequirementTree {
  requirement: { id: string; input_text: string; status: string; execution_id: string | null }
  epics: EpicNode[]
}

export interface EpicNode {
  id: string
  title: string
  description: string | null
  module: string | null
  status: string
  features: FeatureNode[]
  orphan_user_stories: UserStoryNode[]
}

export interface FeatureNode {
  id: string
  title: string
  description: string | null
  status: string
  user_stories: UserStoryNode[]
}

export interface UserStoryNode {
  id: string
  title: string
  as_a: string | null
  i_want: string | null
  so_that: string | null
  priority: string
  acceptance_text: string | null
  status: string
  tasks: TaskNode[]
}

export interface TaskNode {
  id: string
  title: string | null
  description: string | null
  task_type: string | null
  status: string
  execution_id: string | null
  estimated_hours: number | null
}

export const api = {
  async list(): Promise<RequirementListItem[]> {
    const r = await fetch(base)
    return r.json()
  },
  async get(id: string): Promise<RequirementDetail> {
    const r = await fetch(`${base}/${id}`)
    return r.json()
  },
  async getTree(id: string): Promise<RequirementTree> {
    const r = await fetch(`${base}/${id}/tree`)
    return r.json()
  },
  async execute(id: string, input_text?: string): Promise<any> {
    const r = await fetch(`${base}/${id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_text }),
    })
    return r.json()
  },
  async stop(id: string): Promise<any> {
    const r = await fetch(`${base}/${id}/stop`, { method: 'POST' })
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
}
