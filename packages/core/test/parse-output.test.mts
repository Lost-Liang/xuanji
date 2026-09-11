import { describe, it, expect } from 'vitest'
import { parseNodeOutput } from '../src/graph/conditions/default-conditions.mjs'

describe('parseNodeOutput', () => {
  // 模拟 sourceText 函数
  const mockSourceText = (text: string | null) => {
    return (state: any, sourceId: string) => text
  }

  it('解析纯 JSON 字符串', () => {
    const state = { results: { test: '{"ok": true}' } }
    const result = parseNodeOutput(state, 'test', mockSourceText('{"ok": true}'))
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
    const state = {}
    const result = parseNodeOutput(state, 'test', mockSourceText(markdown))
    expect(result).toEqual({ ok: true, passed: 39, total: 39 })
  })

  it('从 markdown 中提取 JSON 代码块（带多余空格）', () => {
    const markdown = `
\`\`\`json
  { "ok": false, "summary": "Failed" }
\`\`\`
`
    const result = parseNodeOutput({}, 'test', mockSourceText(markdown))
    expect(result).toEqual({ ok: false, summary: 'Failed' })
  })

  it('空文本返回 null', () => {
    const result = parseNodeOutput({}, 'test', mockSourceText(''))
    expect(result).toBeNull()
  })

  it('null 返回 null', () => {
    const result = parseNodeOutput({}, 'test', mockSourceText(null))
    expect(result).toBeNull()
  })

  it('无 ok 字段的 JSON 返回 null', () => {
    const result = parseNodeOutput({}, 'test', mockSourceText('{"passed": 39}'))
    expect(result).toBeNull()
  })

  it('无法解析的文本返回 null', () => {
    const result = parseNodeOutput({}, 'test', mockSourceText('not json'))
    expect(result).toBeNull()
  })
})
