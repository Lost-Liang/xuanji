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
  session_id: string      // V4: Claude Code CLI 会话 ID
  status: string
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
  requirement: {
    id: string
    input_text: string
    status: string
    rollup_status?: string | null
    can_execute?: boolean
    can_pause?: boolean
    can_resume?: boolean
    execution_id: string | null
  }
  epics: EpicNode[]
}

export interface EpicNode {
  id: string
  title: string
  description: string | null
  module: string | null
  status: string
  can_execute?: boolean
  can_pause?: boolean
  can_resume?: boolean
  features: FeatureNode[]
  orphan_user_stories: UserStoryNode[]
}

export interface FeatureNode {
  id: string
  title: string
  description: string | null
  status: string
  can_execute?: boolean
  can_pause?: boolean
  can_resume?: boolean
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
  can_execute?: boolean
  can_pause?: boolean
  can_resume?: boolean
  tasks: TaskNode[]
}

export interface TaskNode {
  id: string
  title: string | null
  description: string | null
  task_type: string | null
  status: string
  control_status?: string | null
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
  async confirmAll(requirementId: string): Promise<{ok: boolean, confirmed_count: number, message: string}> {
    const r = await fetch(`${base}/${requirementId}/confirm-all-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    return r.json()
  },

  // Requirement 级暂停
  async pauseRequirement(id: string): Promise<{ok: boolean, paused_count: number}> {
    const r = await fetch(`${base}/${id}/pause`, { method: 'POST' })
    return r.json()
  },

  // Requirement 级恢复
  async resumeRequirement(id: string): Promise<{ok: boolean, resumed_count: number}> {
    const r = await fetch(`${base}/${id}/resume`, { method: 'POST' })
    return r.json()
  },

  // Epic 级操作
  async executeEpic(epicId: string): Promise<{ok: boolean, started_count: number, message?: string}> {
    const r = await fetch(`${base}/epics/${epicId}/execute`, { method: 'POST' })
    return r.json()
  },
  async pauseEpic(epicId: string): Promise<{ok: boolean, paused_count: number}> {
    const r = await fetch(`${base}/epics/${epicId}/pause`, { method: 'POST' })
    return r.json()
  },
  async resumeEpic(epicId: string): Promise<{ok: boolean, resumed_count: number}> {
    const r = await fetch(`${base}/epics/${epicId}/resume`, { method: 'POST' })
    return r.json()
  },
  async deleteEpic(epicId: string): Promise<{ok: boolean}> {
    const r = await fetch(`${base}/epics/${epicId}`, { method: 'DELETE' })
    return r.json()
  },

  // Feature 级操作
  async executeFeature(featureId: string): Promise<{ok: boolean, started_count: number, message?: string}> {
    const r = await fetch(`${base}/features/${featureId}/execute`, { method: 'POST' })
    return r.json()
  },
  async pauseFeature(featureId: string): Promise<{ok: boolean, paused_count: number}> {
    const r = await fetch(`${base}/features/${featureId}/pause`, { method: 'POST' })
    return r.json()
  },
  async resumeFeature(featureId: string): Promise<{ok: boolean, resumed_count: number}> {
    const r = await fetch(`${base}/features/${featureId}/resume`, { method: 'POST' })
    return r.json()
  },
  async deleteFeature(featureId: string): Promise<{ok: boolean}> {
    const r = await fetch(`${base}/features/${featureId}`, { method: 'DELETE' })
    return r.json()
  },

  // UserStory 级操作
  async executeUserStory(userStoryId: string): Promise<{ok: boolean, started_count: number, message?: string}> {
    const r = await fetch(`${base}/user-stories/${userStoryId}/execute`, { method: 'POST' })
    return r.json()
  },
  async pauseUserStory(userStoryId: string): Promise<{ok: boolean, paused_count: number}> {
    const r = await fetch(`${base}/user-stories/${userStoryId}/pause`, { method: 'POST' })
    return r.json()
  },
  async resumeUserStory(userStoryId: string): Promise<{ok: boolean, resumed_count: number}> {
    const r = await fetch(`${base}/user-stories/${userStoryId}/resume`, { method: 'POST' })
    return r.json()
  },
  async deleteUserStory(userStoryId: string): Promise<{ok: boolean}> {
    const r = await fetch(`${base}/user-stories/${userStoryId}`, { method: 'DELETE' })
    return r.json()
  },
}
