# 璇玑 V4 核心问题修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 3 个核心问题：Agent 输出结构化、条件评估机制、事件记录 Bug，让研发流程完整执行

**Architecture:** 
1. 要求 Agent 输出 markdown+JSON 格式，在 agent-node.mts 中解析 JSON 并存储到 phase_instances.result_payload
2. 将 YAML 条件边从 expression 改为 function 类型，利用已有 test_pass/test_fail 条件函数
3. 修复 mapAdapterEvent 返回可空类型，只在 init 时记录 model_started

**Tech Stack:** TypeScript, LangGraph, Vitest, Prisma

**Spec:** `docs/superpowers/specs/2026-09-11-core-issues-fix-design.md`

## Global Constraints

- 后端代码用 `.mts` 扩展名（ES modules with TypeScript）
- 测试用 Vitest，文件命名 `*.test.mts`
- 数据库 schema 不变（phase_instances 已有 result_payload JSONB 字段）
- 解析失败时降级处理，不中断流程
- 条件函数使用 fail-fast 原则：无法解析 → null → 视为失败

---

## File Structure

### 后端

| 文件 | 职责 |
|------|------|
| `packages/core/src/graph/shared-agent-utils.mts` | mapAdapterEvent 返回类型改为可空 |
| `packages/core/src/graph/agent-node.mts` | onEvent 只记录非空事件；解析 Agent 输出 JSON |
| `packages/core/src/graph/conditions/default-conditions.mts` | parseNodeOutput 支持 JSON 代码块提取；新增 code_review 条件函数 |
| `packages/core/workflows/ruoyi-dev-flow.yaml` | 条件边改为 function 类型 |
| `packages/core/test/parse-output.test.mts` | 解析 Agent 输出 JSON 的单元测试 |
| `packages/core/test/default-conditions.test.mts` | 条件函数的单元测试 |
| `packages/core/test/map-adapter-event.test.mts` | mapAdapterEvent 的单元测试 |

---

## Task 1: 修复 mapAdapterEvent 返回可空类型

**Files:**
- Modify: `packages/core/src/graph/shared-agent-utils.mts:34-74`
- Create: `packages/core/test/map-adapter-event.test.mts`

**Interfaces:**
- Consumes: `AdapterEvent` 类型（来自 Runner）
- Produces: `mapAdapterEvent` 函数返回类型改为 `{ eventType, role?, payload } | null`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/test/map-adapter-event.test.mts`：

```ts
import { describe, it, expect } from 'vitest'
import { mapAdapterEvent } from '../src/graph/shared-agent-utils.mjs'

describe('mapAdapterEvent', () => {
  it('system/init 事件映射为 model_started', () => {
    const result = mapAdapterEvent({
      type: 'system',
      subtype: 'init',
      sessionId: 'test-session-123',
    })
    expect(result).toEqual({
      eventType: 'model_started',
      payload: { sessionId: 'test-session-123' },
    })
  })

  it('system 非 init 事件返回 null', () => {
    // 模拟 streaming chunk 发送的 system 事件（无 subtype 或 subtype 非 init）
    const result = mapAdapterEvent({
      type: 'system',
      subtype: 'progress',  // 非 init
    } as any)
    expect(result).toBeNull()
  })

  it('assistant 事件映射为 model_delta', () => {
    const result = mapAdapterEvent({
      type: 'assistant',
      message: 'Hello',
      toolUse: [{ id: 'tool-1', name: 'read_file' }],
    })
    expect(result).toEqual({
      eventType: 'model_delta',
      role: 'assistant',
      payload: {
        message: 'Hello',
        toolUse: [{ id: 'tool-1', name: 'read_file' }],
      },
    })
  })

  it('user 事件映射为 tool_completed', () => {
    const result = mapAdapterEvent({
      type: 'user',
      message: 'Tool result',
      toolResult: [{ toolUseId: 'tool-1' }],
    })
    expect(result).toEqual({
      eventType: 'tool_completed',
      role: 'user',
      payload: {
        message: 'Tool result',
        toolResult: [{ toolUseId: 'tool-1' }],
      },
    })
  })

  it('result success 映射为 final_output', () => {
    const result = mapAdapterEvent({
      type: 'result',
      subtype: 'success',
      output: 'Done',
    })
    expect(result).toEqual({
      eventType: 'final_output',
      payload: { output: 'Done' },
    })
  })

  it('result error 映射为 error', () => {
    const result = mapAdapterEvent({
      type: 'result',
      subtype: 'error',
      error: 'Failed',
    })
    expect(result).toEqual({
      eventType: 'error',
      payload: { error: 'Failed' },
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @xuanji/core test test/map-adapter-event.test.mts
```

Expected: 失败，因为 `system 非 init 事件返回 null` 测试会失败（当前实现返回非 null）

- [ ] **Step 3: 修改 mapAdapterEvent 实现**

修改 `packages/core/src/graph/shared-agent-utils.mts`：

```ts
export function mapAdapterEvent(event: AdapterEvent): {
  eventType: string;
  role?: string;
  payload: Prisma.InputJsonValue;
} | null {
  switch (event.type) {
    case 'system':
      // 只在会话初始化时记录
      if (event.subtype === 'init') {
        return {
          eventType: 'model_started',
          payload: { sessionId: event.sessionId } as Prisma.InputJsonValue,
        };
      }
      // 其他 system 事件不记录
      return null;

    case 'assistant':
      return {
        eventType: 'model_delta',
        role: 'assistant',
        payload: {
          message: event.message,
          toolUse: event.toolUse,
        } as Prisma.InputJsonValue,
      };

    case 'user':
      return {
        eventType: 'tool_completed',
        role: 'user',
        payload: {
          message: event.message,
          toolResult: event.toolResult,
        } as Prisma.InputJsonValue,
      };

    case 'result':
      if (event.subtype === 'error') {
        return {
          eventType: 'error',
          payload: { error: event.error } as Prisma.InputJsonValue,
        };
      }
      return {
        eventType: 'final_output',
        payload: { output: event.output } as Prisma.InputJsonValue,
      };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @xuanji/core test test/map-adapter-event.test.mts
```

Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph/shared-agent-utils.mts packages/core/test/map-adapter-event.test.mts
git commit -m "fix: mapAdapterEvent 返回可空类型，只在 init 时记录 model_started

- 返回类型改为 { eventType, role?, payload } | null
- system 非 init 事件返回 null，避免 streaming chunk 重复记录
- 添加单元测试覆盖所有事件类型

Fixes: conversation_events 表 18,043 条重复 model_started 事件"
```

---

## Task 2: agent-node.mts 只记录非空事件

**Files:**
- Modify: `packages/core/src/graph/agent-node.mts:423-446`

**Interfaces:**
- Consumes: `mapAdapterEvent` 函数（Task 1 产出）
- Produces: onEvent 回调只记录非空事件

- [ ] **Step 1: 修改 onEvent 回调**

修改 `packages/core/src/graph/agent-node.mts` 第 438-446 行：

```ts
// 映射并保存对话事件
const mapped = mapAdapterEvent(event);
if (mapped) {  // 只记录非空事件
  await conversationStore.saveEvent({
    execution_id: execId,
    session_id: currentSessionId ?? undefined,
    event_type: mapped.eventType,
    role: mapped.role,
    payload: mapped.payload,
  });
}
```

- [ ] **Step 2: 验证构建通过**

```bash
pnpm --filter @xuanji/core build
```

Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/graph/agent-node.mts
git commit -m "fix: agent-node onEvent 只记录非空事件

- mapAdapterEvent 返回 null 时跳过 saveEvent
- 配合 Task 1 的 mapAdapterEvent 修改，彻底解决重复事件问题"
```

---

## Task 3: parseNodeOutput 支持 JSON 代码块提取

**Files:**
- Modify: `packages/core/src/graph/conditions/default-conditions.mts:12-22`
- Create: `packages/core/test/parse-output.test.mts`

**Interfaces:**
- Consumes: Agent 输出（markdown + JSON 代码块）
- Produces: `parseNodeOutput` 返回 `{ ok: boolean }` 或 null

- [ ] **Step 1: 写失败测试**

创建 `packages/core/test/parse-output.test.mts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @xuanji/core test test/parse-output.test.mts
```

Expected: 失败，因为当前 `parseNodeOutput` 不支持 markdown 代码块提取

- [ ] **Step 3: 修改 parseNodeOutput 实现**

修改 `packages/core/src/graph/conditions/default-conditions.mts` 第 12-22 行：

```ts
function parseNodeOutput(state: any, sourceId: string): { ok: boolean } | null {
  const text = sourceText(state, sourceId)
  if (!text || text === '') return null

  // 尝试从 ```json 代码块提取
  const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      if (typeof parsed?.ok === 'boolean') return parsed
    } catch { }
  }

  // 回退：尝试直接解析整个输出
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.ok === 'boolean') return parsed
  } catch { }

  // 无法解析 → 返回 null（视为失败）
  return null
}
```

**注意**：`parseNodeOutput` 是内部函数，需要导出以便测试。同时需要修改 `sourceText` 的导入，改为通过参数传入（便于测试 mock）。

修改函数签名：

```ts
// 导出供测试使用
export function parseNodeOutput(
  state: any,
  sourceId: string,
  sourceTextFn: (state: any, sourceId: string) => string | null = sourceText,
): { ok: boolean } | null {
  const text = sourceTextFn(state, sourceId)
  // ... 其余逻辑不变
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @xuanji/core test test/parse-output.test.mts
```

Expected: 全部通过

- [ ] **Step 5: 运行现有测试确认不破坏**

```bash
pnpm --filter @xuanji/core test
```

Expected: 所有现有测试通过

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/graph/conditions/default-conditions.mts packages/core/test/parse-output.test.mts
git commit -m "feat: parseNodeOutput 支持从 markdown 中提取 JSON 代码块

- 支持 \`\`\`json { ... } \`\`\` 格式提取
- 回退到直接解析整个输出
- 添加 sourceTextFn 参数便于测试 mock
- 添加单元测试覆盖各种输入格式

为 Agent 输出结构化做准备"
```

---

## Task 4: 新增 code_review 条件函数

**Files:**
- Modify: `packages/core/src/graph/conditions/default-conditions.mts:58-76`
- Create: `packages/core/test/default-conditions.test.mts`

**Interfaces:**
- Consumes: `parseNodeOutput` 函数（Task 3 产出）
- Produces: `code_review_pass` 和 `code_review_issues` 条件函数已注册

- [ ] **Step 1: 写失败测试**

创建 `packages/core/test/default-conditions.test.mts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { 
  initDefaultConditions, 
  getCondition 
} from '../src/graph/conditions/default-conditions.mjs'

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
      const state = {
        results: {
          code_review: '{"ok": true, "approved": true}',
        },
      }
      expect(fn(state)).toBe(true)
    })

    it('code_review_pass 审查失败返回 false', () => {
      const fn = getCondition('code_review_pass')!
      const state = {
        results: {
          code_review: '{"ok": false, "approved": false}',
        },
      }
      expect(fn(state)).toBe(false)
    })

    it('code_review_pass 无法解析返回 false', () => {
      const fn = getCondition('code_review_pass')!
      const state = {
        results: {
          code_review: 'not json',
        },
      }
      expect(fn(state)).toBe(false)
    })

    it('code_review_issues 审查失败返回 true', () => {
      const fn = getCondition('code_review_issues')!
      const state = {
        results: {
          code_review: '{"ok": false, "approved": false}',
        },
      }
      expect(fn(state)).toBe(true)
    })

    it('code_review_issues 无法解析返回 true（fail-fast）', () => {
      const fn = getCondition('code_review_issues')!
      const state = {
        results: {
          code_review: 'not json',
        },
      }
      expect(fn(state)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @xuanji/core test test/default-conditions.test.mts
```

Expected: 失败，因为 `code_review_pass` 和 `code_review_issues` 未注册

- [ ] **Step 3: 添加条件函数并注册**

修改 `packages/core/src/graph/conditions/default-conditions.mts`，在现有条件函数后添加：

```ts
// ─── 代码审查类：code_review 节点的输出 ─────────────────────────────────
export const codeReviewPass: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'code_review')
  return result?.ok === true
}

export const codeReviewIssues: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'code_review')
  // 防御性处理：没有输出或 ok=false 都视为有问题
  return result === null || result.ok === false
}
```

在 `initDefaultConditions` 函数中注册：

```ts
export function initDefaultConditions(): void {
  registerCondition('compile_pass', compilePass)
  registerCondition('compile_fail', compileFail)
  registerCondition('test_pass', testPass)
  registerCondition('test_fail', testFail)
  registerCondition('quality_pass', qualityPass)
  registerCondition('quality_issues', qualityIssues)
  registerCondition('security_pass', securityPass)
  registerCondition('security_issues', securityIssues)
  // 新增 code_review 条件函数
  registerCondition('code_review_pass', codeReviewPass)
  registerCondition('code_review_issues', codeReviewIssues)
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @xuanji/core test test/default-conditions.test.mts
```

Expected: 全部通过

- [ ] **Step 5: 运行现有测试确认不破坏**

```bash
pnpm --filter @xuanji/core test
```

Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/graph/conditions/default-conditions.mts packages/core/test/default-conditions.test.mts
git commit -m "feat: 新增 code_review_pass 和 code_review_issues 条件函数

- codeReviewPass: code_review 节点 ok=true 时返回 true
- codeReviewIssues: code_review 节点 ok=false 或无法解析时返回 true
- 在 initDefaultConditions 中注册

为 ruoyi-dev-flow.yaml 条件边修改做准备"
```

---

## Task 5: 修改 ruoyi-dev-flow.yaml 条件边

**Files:**
- Modify: `packages/core/workflows/ruoyi-dev-flow.yaml:66-108`

**Interfaces:**
- Consumes: `test_pass`、`test_fail`、`code_review_pass`、`code_review_issues` 条件函数（Task 3/4 产出）
- Produces: YAML 工作流条件边使用 function 类型

- [ ] **Step 1: 修改条件边**

修改 `packages/core/workflows/ruoyi-dev-flow.yaml` 第 66-108 行：

```yaml
edges:
  # write_tests → develop（先写测试，再写代码）
  - from: write_tests
    to: develop

  # develop → test（开发完成后测试验证）
  - from: develop
    to: test

  # test 条件边：pass → code_review, fail → develop（最多 2 次）
  - from: test
    to: code_review
    condition:
      type: function
      config:
        name: test_pass

  - from: test
    to: develop
    condition:
      type: function
      config:
        name: test_fail
    loop_max: 2

  # code_review 条件边：pass → final_review, issues → code_fix（最多 3 次）
  - from: code_review
    to: final_review
    condition:
      type: function
      config:
        name: code_review_pass

  - from: code_review
    to: code_fix
    condition:
      type: function
      config:
        name: code_review_issues
    loop_max: 3

  # code_fix → code_review（修复后重新审查）
  - from: code_fix
    to: code_review

  # final_review → __end__（人审通过后流程结束）
  - from: final_review
    to: __end__
```

- [ ] **Step 2: 验证 YAML 语法**

```bash
node -e "const yaml = require('yaml'); const fs = require('fs'); yaml.parse(fs.readFileSync('packages/core/workflows/ruoyi-dev-flow.yaml', 'utf-8')); console.log('YAML syntax OK')"
```

Expected: `YAML syntax OK`

- [ ] **Step 3: 验证工作流加载**

```bash
pnpm --filter @xuanji/core test test/builder.test.mts
```

Expected: 测试通过（工作流能正常加载和构建）

- [ ] **Step 4: Commit**

```bash
git add packages/core/workflows/ruoyi-dev-flow.yaml
git commit -m "fix: ruoyi-dev-flow.yaml 条件边改为 function 类型

- test → code_review/develop 使用 test_pass/test_fail
- code_review → final_review/code_fix 使用 code_review_pass/code_review_issues
- 移除 expression 类型（Builder 不支持）

Fixes: code_review 和 final_review 阶段被跳过"
```

---

## Task 6: 修改 Agent Prompt 要求 JSON 输出

**Files:**
- Modify: `packages/core/src/graph/agent-node.mts:150-200`（buildSystemPrompt 函数）

**Interfaces:**
- Consumes: Agent 执行流程
- Produces: Agent 输出 markdown + JSON 代码块

- [ ] **Step 1: 在 buildSystemPrompt 中添加输出格式要求**

修改 `packages/core/src/graph/agent-node.mts` 的 `buildSystemPrompt` 函数，在 prompt 尾部追加：

```ts
// 根据节点类型追加输出格式要求
const nodeType = opts.nodeId
let outputFormat = ''

if (nodeType === 'write_tests') {
  outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,           // 测试编写是否完成
  "summary": "一句话总结",
  "test_files": ["文件路径"],
  "test_count": number     // 测试用例总数
}
\`\`\``
} else if (nodeType === 'develop') {
  outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,              // 开发是否完成
  "summary": "一句话总结",
  "files_created": ["文件路径"],
  "files_modified": ["文件路径"],
  "compilation_ok": boolean   // 编译是否通过
}
\`\`\``
} else if (nodeType === 'test') {
  outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,              // 测试是否全部通过
  "summary": "一句话总结",
  "passed": boolean,          // 测试是否全部通过
  "passed_count": number,     // 通过的测试数
  "total_count": number,      // 测试总数
  "compilation_ok": boolean   // 编译是否通过
}
\`\`\``
} else if (nodeType === 'code_review') {
  outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,              // 审查是否通过
  "summary": "一句话总结",
  "approved": boolean,        // 是否批准
  "issues": ["问题描述"]
}
\`\`\``
} else if (nodeType === 'code_fix') {
  outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,                 // 修复是否完成
  "summary": "一句话总结",
  "files_modified": ["文件路径"],
  "issues_resolved": ["问题描述"]
}
\`\`\``
}

return parts.join('') + outputFormat
```

- [ ] **Step 2: 验证构建通过**

```bash
pnpm --filter @xuanji/core build
```

Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/graph/agent-node.mts
git commit -m "feat: Agent Prompt 追加 JSON 输出格式要求

- write_tests: ok, summary, test_files, test_count
- develop: ok, summary, files_created, files_modified, compilation_ok
- test: ok, summary, passed, passed_count, total_count, compilation_ok
- code_review: ok, summary, approved, issues
- code_fix: ok, summary, files_modified, issues_resolved

为 Agent 输出结构化做准备"
```

---

## Task 7: 解析 Agent 输出并存储到 result_payload

**Files:**
- Modify: `packages/core/src/graph/agent-node.mts:514-534`（保存阶段产出物逻辑）

**Interfaces:**
- Consumes: Agent 输出（markdown + JSON 代码块）
- Produces: `phase_instances.result_payload` 存储解析出的 JSON

- [ ] **Step 1: 修改保存阶段产出物逻辑**

修改 `packages/core/src/graph/agent-node.mts` 第 514-534 行：

```ts
// ── 保存阶段产出物 ───────────────────────────────────────────────────────
if (phaseInstance) {
  // 保存完整输出到 phase_outputs
  await db.phase_outputs.create({
    data: {
      phase_instance_id: phaseInstance.id,
      key: opts.writeKey,
      value: output,
    },
  });

  // 尝试从输出中提取 JSON 并存储到 result_payload
  let resultPayload: any = null
  if (output) {
    // 尝试从 ```json 代码块提取
    const jsonMatch = output.match(/```json\s*(\{[\s\S]*?\})\s*```/)
    if (jsonMatch) {
      try {
        resultPayload = JSON.parse(jsonMatch[1])
      } catch {
        console.warn(`[agent-node] 无法解析 ${opts.nodeId} 的 JSON 代码块`)
      }
    } else {
      // 回退：尝试直接解析
      try {
        const parsed = JSON.parse(output)
        if (typeof parsed === 'object' && parsed !== null) {
          resultPayload = parsed
        }
      } catch {
        console.warn(`[agent-node] ${opts.nodeId} 输出无法解析为 JSON`)
      }
    }
  }

  // 标记 phase instance 完成
  await db.phase_instances.update({
    where: { id: phaseInstance.id },
    data: {
      status: 'completed',
      result_content: output,
      result_payload: resultPayload,  // 存储解析出的 JSON
      session_id: currentSessionId,
      completed_at: new Date(),
    },
  });
}
```

- [ ] **Step 2: 验证构建通过**

```bash
pnpm --filter @xuanji/core build
```

Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/graph/agent-node.mts
git commit -m "feat: 解析 Agent 输出 JSON 并存储到 result_payload

- 从 \`\`\`json 代码块提取 JSON
- 回退到直接解析整个输出
- 解析失败时记录警告，不中断流程
- 存储到 phase_instances.result_payload (JSONB)

为条件评估和 Dashboard 展示提供结构化数据"
```

---

## Task 8: 集成测试

**Files:** 无（纯验证任务）

- [ ] **Step 1: 运行所有测试**

```bash
pnpm --filter @xuanji/core test
```

Expected: 所有测试通过

- [ ] **Step 2: 构建整个项目**

```bash
pnpm build
```

Expected: 所有包构建成功

- [ ] **Step 3: 手动测试（可选）**

启动系统，创建一个需求，验证：
1. Agent 输出包含 JSON 代码块
2. `phase_instances.result_payload` 有值
3. 工作流按条件边正确路由
4. conversation_events 数量正常

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "test: 集成测试通过，无额外修复"
```

---

## Summary

| Task | 产出 | 依赖 | 预估时间 |
|------|------|------|---------|
| 1 | mapAdapterEvent 可空返回 | 无 | 30 分钟 |
| 2 | agent-node 只记录非空事件 | Task 1 | 15 分钟 |
| 3 | parseNodeOutput 支持 JSON 代码块 | 无 | 1 小时 |
| 4 | code_review 条件函数 | Task 3 | 1 小时 |
| 5 | YAML 条件边改为 function | Task 4 | 30 分钟 |
| 6 | Agent Prompt 追加 JSON 格式 | 无 | 1 小时 |
| 7 | 解析 JSON 存储到 result_payload | Task 6 | 1 小时 |
| 8 | 集成测试 | Task 1-7 | 30 分钟 |

**总预估**：6 小时

**并行机会**：Task 1+2, Task 3+4+5, Task 6+7 可以分别并行

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-11-core-issues-fix.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
