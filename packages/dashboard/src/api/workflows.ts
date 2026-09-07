// core/web/src/api/workflows.ts —— 工作流 API 客户端

const base = '/api/workflows'

export const api = {
  /**
   * 获取可用的条件函数列表
   */
  async getConditions(): Promise<string[]> {
    const r = await fetch(`${base}/conditions`)
    if (!r.ok) {
      throw new Error(`Failed to fetch conditions: ${r.status} ${r.statusText}`)
    }
    return r.json()
  }
}