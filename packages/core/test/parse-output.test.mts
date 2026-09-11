import { describe, it, expect } from 'vitest'
import { parseOutput } from '../src/graph/conditions/default-conditions.mjs'

describe('parseOutput', () => {
  it('解析纯 JSON 字符串', () => {
    const result = parseOutput('{"ok": true}')
    expect(result).toEqual({ ok: true })
  })

  it('从 markdown 中提取 JSON 代码块', () => {
    const markdown = `
## 测试完成

分析过程...

\`\`\`json
{ "ok": true, "passed": 39, "total": 39 }
\`\`\`
`
    const result = parseOutput(markdown)
    expect(result).toEqual({ ok: true, passed: 39, total: 39 })
  })

  it('从 markdown 中提取 JSON 代码块（带多余空格）', () => {
    const markdown = `
\`\`\`json
  { "ok": false, "summary": "Failed" }
\`\`\`
`
    const result = parseOutput(markdown)
    expect(result).toEqual({ ok: false, summary: 'Failed' })
  })

  it('空文本返回 null', () => {
    const result = parseOutput('')
    expect(result).toBeNull()
  })

  it('null 返回 null', () => {
    const result = parseOutput(null)
    expect(result).toBeNull()
  })

  it('无 ok 字段的 JSON 返回 null', () => {
    const result = parseOutput('{"passed": 39}')
    expect(result).toBeNull()
  })

  it('无法解析的文本返回 null', () => {
    const result = parseOutput('not json')
    expect(result).toBeNull()
  })
})
