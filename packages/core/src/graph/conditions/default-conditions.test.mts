import { describe, it, expect } from 'vitest'
import { compilePass, compileFail, securityPass, securityIssues } from './default-conditions.mjs'

describe('Compile conditions', () => {
  it('compilePass returns true when ok is true', () => {
    const text = '```json\n{"ok": true, "summary": "编译通过"}\n```'
    expect(compilePass(text)).toBe(true)
  })

  it('compilePass returns false when ok is false', () => {
    const text = '```json\n{"ok": false, "errors": []}\n```'
    expect(compilePass(text)).toBe(false)
  })

  it('compileFail returns true when ok is false', () => {
    const text = '```json\n{"ok": false, "errors": []}\n```'
    expect(compileFail(text)).toBe(true)
  })

  it('compileFail returns true when text is null', () => {
    expect(compileFail(null)).toBe(true)
  })
})

describe('Security conditions', () => {
  it('securityPass returns true when ok is true', () => {
    const text = '```json\n{"ok": true, "issues": []}\n```'
    expect(securityPass(text)).toBe(true)
  })

  it('securityPass returns false when text is null', () => {
    expect(securityPass(null)).toBe(false)
  })

  it('securityIssues returns true when ok is false', () => {
    const text = '```json\n{"ok": false, "issues": [...]}\n```'
    expect(securityIssues(text)).toBe(true)
  })

  it('securityIssues returns true when text is null', () => {
    expect(securityIssues(null)).toBe(true)
  })
})