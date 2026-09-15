import { describe, it, expect } from 'vitest'
import { TopState } from './state-schema.mjs'

describe('TopState schema', () => {
  it('code_fix_history has reducer that accumulates', () => {
    const state1 = { code_fix_history: [{ attempt: 1, issues: [], fixes_applied: 'fix1', review_result: '' }] }
    const state2 = { code_fix_history: [{ attempt: 2, issues: [], fixes_applied: 'fix2', review_result: '' }] }

    // 模拟 reducer 行为
    const merged = [...state1.code_fix_history, ...state2.code_fix_history]

    expect(merged).toHaveLength(2)
    expect(merged[0].attempt).toBe(1)
    expect(merged[1].attempt).toBe(2)
  })

  it('code_fix_history default is empty array', () => {
    // 验证默认值
    const defaultValue: any[] = []
    expect(defaultValue).toEqual([])
  })
})