// packages/dashboard/src/api/projects.ts —— 项目 API 客户端
const base = '/api/projects'

export interface Project {
  id: string
  name: string
  path: string
  description?: string
}

export const api = {
  async list(): Promise<Project[]> {
    const res = await fetch(base)
    if (!res.ok) throw new Error(`Failed to list projects: ${res.statusText}`)
    return res.json()
  },

  async get(id: string): Promise<Project> {
    const res = await fetch(`${base}/${id}`)
    if (!res.ok) throw new Error(`Failed to get project: ${res.statusText}`)
    return res.json()
  },

  async create(data: Omit<Project, 'id'>): Promise<Project> {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) throw new Error(`Failed to create project: ${res.statusText}`)
    return res.json()
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${base}/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Failed to delete project: ${res.statusText}`)
  }
}