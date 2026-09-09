// packages/dashboard/src/api/projects.ts —— 项目 API 客户端
const base = '/api/projects'

export interface Project {
  id: string
  name: string
  path: string
  description: string | null
  created_at: string
  updated_at: string
}

export const api = {
  async list(): Promise<Project[]> {
    const r = await fetch(base)
    return r.json()
  },

  async create(data: { name: string; path: string; description?: string }): Promise<Project> {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error || '创建失败')
    }
    return r.json()
  },

  async delete(id: string): Promise<void> {
    const r = await fetch(`${base}/${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error || '删除失败')
    }
  },
}