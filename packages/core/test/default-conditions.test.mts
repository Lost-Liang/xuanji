import { describe, it, expect, beforeAll } from 'vitest'
import { initDefaultConditions } from '../src/graph/conditions/default-conditions.mjs'
import { getCondition } from '../src/graph/conditions/index.mjs'

describe('default-conditions.mts', () => {
  beforeAll(() => {
    initDefaultConditions()
  })

  describe('code_review 条件函数', () => {
    it('code_review_pass 存在', () => {
      const fn = getCondition('code_review_pass')
      expect(fn).toBeDefined()
      expect(typeof fn).toBe('function')
    })

    it('code_review_issues 存在', () => {
      const fn = getCondition('code_review_issues')
      expect(fn).toBeDefined()
      expect(typeof fn).toBe('function')
    })

    it('code_review_pass 审查通过返回 true', () => {
      const fn = getCondition('code_review_pass')!
      // Task 3: 条件函数接收文本而不是 state
      const text = '{"ok": true, "approved": true}'
      expect(fn(text)).toBe(true)
    })

    it('code_review_pass 审查失败返回 false', () => {
      const fn = getCondition('code_review_pass')!
      // Task 3: 条件函数接收文本而不是 state
      const text = '{"ok": false, "approved": false}'
      expect(fn(text)).toBe(false)
    })

    it('code_review_pass 无法解析返回 false', () => {
      const fn = getCondition('code_review_pass')!
      // Task 3: 条件函数接收文本而不是 state
      const text = 'not json'
      expect(fn(text)).toBe(false)
    })

    it('code_review_issues 审查失败返回 true', () => {
      const fn = getCondition('code_review_issues')!
      // Task 3: 条件函数接收文本而不是 state
      const text = '{"ok": false, "approved": false}'
      expect(fn(text)).toBe(true)
    })

    it('code_review_issues 无法解析返回 true（fail-fast）', () => {
      const fn = getCondition('code_review_issues')!
      // Task 3: 条件函数接收文本而不是 state
      const text = 'not json'
      expect(fn(text)).toBe(true)
    })
  })
})
