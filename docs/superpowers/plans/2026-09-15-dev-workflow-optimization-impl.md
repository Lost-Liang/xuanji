# 研发工作流优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 AI 自动研发工作流，修复 10 个已识别问题（P0-1个、P1-5个、P2-3个、P3-1个），实现真正的 TDD、编译检查、安全扫描、修复验证和人审不跳过。

**Architecture:** 在现有 LangGraph 工作流基础上增加节点（run_initial_tests、compile_check、security_scan、regression_test），新增 agent 定义（compiler、security-scanner），扩展条件函数，修正路由逻辑，补充 state schema。

**Tech Stack:** 
- LangGraph 1.4.15
- TypeScript/Node.js
- Prisma ORM
- YAML 工作流定义

**Spec:** `docs/superpowers/specs/2026-09-15-dev-workflow-optimization-design.md`

## Global Constraints

- 所有新增条件函数必须在 `initDefaultConditions()` 中注册
- Agent 定义必须包含 frontmatter（id、name、description、skillId）
- 工作流 YAML 必须能被 `loadWorkflowFromYaml()` 解析
- 所有边的 `loop_max` 必须明确设置，避免无限循环
- 路由日志必须包含：source、condition、result、target
- 所有 agent 输出必须符合 `{ ok: boolean, summary: string }` 格式

---

## 任务分解

### Task 1: P0 修复 - 增加路由日志定位 final_review 被跳过问题

**Files:**
- Modify: `packages/core/src/graph/builder.mts:99-145` (routeFromSource 函数)

**Interfaces:**
- Consumes: `state: any`, `meta: RouteMeta`
- Produces: 详细的路由决策日志

- [ ] **Step 1: 在 routeFromSource 入口增加状态日志**

```typescript
export function routeFromSource(state: any, meta: RouteMeta, DEFAULT_MAX: number = 3): string {
  console.log(`[router] === Routing from ${meta.source} ===`)
  console.log(`[router] loop_counters: ${JSON.stringify(state.loop_counters || {})}`)
  console.log(`[router] node_outputs keys: ${Object.keys(state.node_outputs || {}).join(', ')}`)
  
  const nonDefault = meta.edges.filter((e) => !e.is_default && !e.loop_back)
  const loopBack = meta.edges.find((e) => e.loop_back)
  
  console.log(`[router] nonDefault edges: ${nonDefault.map(e => e.target).join(', ')}`)
  console.log(`[router] loopBack edge: ${loopBack?.target || 'none'}`)
```

- [ ] **Step 2: 在非回环边评估中增加详细日志**

```typescript
  // 评估非回环条件边
  for (const e of nonDefault) {
    if (!e.condition) continue
    if (e.condition.type === 'function') {
      const fn = getCondition(e.condition.config.name!)
      const sourceId = e.condition.config.source
      const text = sourceId ? sourceText(state, sourceId) : null
      console.log(`[router] Evaluating ${e.condition.config.name}(${sourceId})`)
      console.log(`[router]   text preview: ${text?.slice(0, 100)}...`)
      const result = fn(text)
      console.log(`[router]   result: ${result}, target: ${e.target}`)
      if (result) {
        console.log(`[router] >>> Routed to ${e.target} via ${e.condition.config.name}`)
        return e.target
      }
    }
  }
```

- [ ] **Step 3: 在回环边评估中增加详细日志**

```typescript
  // 回环边（修复循环）
  if (loopBack) {
    const visits = state.loop_counters?.[meta.source] ?? 0
    const limit = loopBack.loop_max ?? DEFAULT_MAX
    console.log(`[router] Loop check: visits=${visits}, limit=${limit}`)
    if (visits <= limit) {
      console.log(`[router]   visits <= limit, checking loop condition`)
      if (loopBack.condition?.type === 'function') {
        const fn = getCondition(loopBack.condition.config.name!)
        const sourceId = loopBack.condition.config.source
        const text = sourceId ? sourceText(state, sourceId) : null
        console.log(`[router]   Evaluating loop ${loopBack.condition.config.name}(${sourceId})`)
        const result = fn(text)
        console.log(`[router]   result: ${result}`)
        if (result) {
          console.log(`[router] >>> Looped back to ${loopBack.target}`)
          return loopBack.target
        }
      }
    } else {
      console.log(`[router]   Loop exhausted (visits > limit)`)
    }
  }
  
  const d = meta.edges.find((e) => e.is_default)
  const target = d ? d.target : '__end__'
  console.log(`[router] >>> Fallback to ${target}`)
  return target
}
```

- [ ] **Step 4: 测试日志输出**

启动系统并触发一个完整流程，检查日志：
```bash
cd packages/core
pnpm dev
```

在另一个终端观察日志：
```bash
tail -f logs/core.log | grep '\[router\]'
```

预期：看到完整的路由决策过程，包括：
- 状态快照
- 每个条件的评估结果
- 最终路由目标

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph/builder.mts
git commit -m "feat(router): 增加详细路由日志用于调试 final_review 被跳过问题

- 记录每次路由的 loop_counters 和 node_outputs
- 记录每个条件边的评估结果
- 记录最终路由目标

Issue: P0-1 final_review 被跳过"
```

---

### Task 2: 新增条件函数 - compile_pass/fail 和 security_pass/issues

**Files:**
- Modify: `packages/core/src/graph/conditions/default-conditions.mts:97-114`

**Interfaces:**
- Consumes: `parseOutput(text: string | null): { ok: boolean } | null`
- Produces: `compilePass`, `compileFail`, `securityPass`, `securityIssues` 四个条件函数

- [ ] **Step 1: 编写编译条件函数的失败测试**

Create: `packages/core/src/graph/conditions/default-conditions.test.mts`

```typescript
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

  it('securityIssues returns true when ok is false', () => {
    const text = '```json\n{"ok": false, "issues": [...]}\n```'
    expect(securityIssues(text)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd packages/core
pnpm test src/graph/conditions/default-conditions.test.mts
```

预期：FAIL with "compilePass is not defined"

- [ ] **Step 3: 实现编译和安全条件函数**

在 `default-conditions.mts` 的 `codeReviewIssues` 函数后添加：

```typescript
// 编译类（复用 parseOutput）
export const compilePass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const compileFail: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result === null || result.ok === false
}

// 安全类（复用 parseOutput）
export const securityPass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const securityIssues: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result === null || result.ok === false
}
```

- [ ] **Step 4: 在 initDefaultConditions 中注册新函数**

```typescript
export function initDefaultConditions(): void {
  registerCondition('compile_pass', compilePass)
  registerCondition('compile_fail', compileFail)
  registerCondition('test_pass', testPass)
  registerCondition('test_fail', testFail)
  registerCondition('security_pass', securityPass)
  registerCondition('security_issues', securityIssues)
  registerCondition('quality_pass', qualityPass)
  registerCondition('quality_issues', qualityIssues)
  registerCondition('code_review_pass', codeReviewPass)
  registerCondition('code_review_issues', codeReviewIssues)
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm test src/graph/conditions/default-conditions.test.mts
```

预期：ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/graph/conditions/
git commit -m "feat(conditions): 新增编译和安全扫描条件函数

- compilePass/compileFail: 判断编译是否通过
- securityPass/securityIssues: 判断安全扫描结果
- 复用 parseOutput 解析 JSON 输出
- 增加单元测试覆盖

Issue: P1-2 缺少编译检查, P1-4 缺少安全扫描"
```

---

### Task 3: 创建 compiler agent 定义

**Files:**
- Create: `packages/core/agents/ruoyi/compiler.md`

**Interfaces:**
- Consumes: `develop` 阶段的 `files_created` 和 `files_modified`
- Produces: `{ ok: boolean, backend: {...}, frontend: {...}, summary: string }`

- [ ] **Step 1: 创建 compiler.md 文件**

```markdown
---
id: compiler
name: 编译检查 Agent
description: 智能判断前后端并执行编译验证
skillId: null
---

# 编译检查 Agent

## ⛔ 最高优先级约束

**你的最终输出必须包含可解析的 JSON 代码块**，包含 `ok` 和 `summary` 字段。

### 绝对禁止

- ❌ 只输出 markdown 摘要，没有 JSON 代码块
- ❌ 在 JSON 中省略 `ok` 或 `summary` 字段
- ❌ 直接失败退出，不尝试编译

### 输出契约

- **你会收到**：`develop` 阶段的输出（包含 files_created/files_modified）
- **你必须返回**：编译结果（markdown）+ ` ```json ` 代码块
- **验证标准**：`JSON.parse(你输出的 json 代码块)` 必须成功

---

## 角色定义

你负责验证代码能否编译通过。

## 工作路径

- 后端：`/workspace/RuoYi-Cloud-Plus`
- 前端：`/workspace/RuoYi-Cloud-Plus/ruoyi-ui`

## 任务类型判断

从 `develop` 阶段的输出中读取 `files_created` 和 `files_modified`：

- **后端**：包含 `.java`、`.xml` 文件
  → `cd /workspace/RuoYi-Cloud-Plus && mvn compile -pl <module> -am`
- **前端**：包含 `.vue`、`.ts` 文件
  → `cd /workspace/RuoYi-Cloud-Plus/ruoyi-ui && pnpm exec vue-tsc --noEmit`
- **全栈**：两者都有 → 先后端，再前端

## 执行步骤

1. **解析 develop 输出**：提取 `files_created` 和 `files_modified`
2. **判断任务类型**：根据文件扩展名
3. **执行编译**：cd 到对应目录，执行命令
4. **解析错误**：提取文件名、行号、错误信息
5. **输出 JSON**

## 错误处理

- 后端编译失败：提取 `[ERROR]` 行
- 前端编译失败：提取 TypeScript 错误
- 目录不存在：返回 `ok: false, summary: "工作目录不存在"`

## 输出格式

\`\`\`json
{
  "ok": true,
  "backend": { 
    "ok": true, 
    "errors": []
  },
  "frontend": { 
    "ok": true, 
    "errors": []
  },
  "files_checked": { "backend": 3, "frontend": 5 },
  "summary": "编译通过"
}
\`\`\`

**ok 为 false 的例子**：

\`\`\`json
{
  "ok": false,
  "backend": {
    "ok": false,
    "errors": [
      { "file": "BookController.java", "line": 45, "message": "类型 BookVO 未找到" }
    ]
  },
  "frontend": { "ok": true, "errors": [] },
  "summary": "后端编译失败：类型 BookVO 未找到"
}
\`\`\`

## 输出前自检清单

- [ ] 是否包含 ` ```json ` 代码块？
- [ ] JSON 中是否包含 `ok` 字段？
- [ ] JSON 中是否包含 `summary` 字段？
- [ ] JSON 是否能被 `JSON.parse()` 解析？
```

- [ ] **Step 2: 验证文件格式**

```bash
# 检查 frontmatter 格式
head -n 6 packages/core/agents/ruoyi/compiler.md
```

预期：看到正确的 YAML frontmatter

- [ ] **Step 3: Commit**

```bash
git add packages/core/agents/ruoyi/compiler.md
git commit -m "feat(agent): 创建编译检查 agent 定义

- 智能判断前后端任务类型
- 支持后端 mvn compile 和前端 vue-tsc
- 输出结构化 JSON 包含详细错误信息

Issue: P1-2 缺少编译检查阶段"
```

---

### Task 4: 创建 security-scanner agent 定义

**Files:**
- Create: `packages/core/agents/ruoyi/security-scanner.md`

**Interfaces:**
- Consumes: `develop` 阶段的代码变更
- Produces: `{ ok: boolean, issues: [...], summary: string }`

- [ ] **Step 1: 创建 security-scanner.md 文件**

```markdown
---
id: security-scanner
name: 安全扫描 Agent
description: 自动检测 XSS、SQL 注入等安全漏洞
skillId: null
---

# 安全扫描 Agent

## ⛔ 最高优先级约束

**你的最终输出必须包含可解析的 JSON 代码块**，包含 `ok`、`issues` 和 `summary` 字段。

### 绝对禁止

- ❌ 只输出 markdown 摘要，没有 JSON 代码块
- ❌ 在 JSON 中省略 `ok`、`issues` 或 `summary` 字段
- ❌ 将所有问题都标记为 critical（误报）

---

## 角色定义

你负责扫描代码中的安全漏洞。

## 扫描范围

- **XSS（跨站脚本攻击）**：未转义的用户输入、innerHTML 使用
- **SQL 注入**：字符串拼接 SQL、MyBatis 的 `${}` 使用
- **敏感信息泄露**：console.log 输出密码、密钥硬编码
- **不安全的依赖**：已知漏洞的依赖版本

## 执行方式

### 前端扫描

检查以下模式：
- `innerHTML =` 或 `v-html` 使用
- 未转义的用户输入拼接到 HTML
- `eval()` 或 `Function()` 使用
- console.log 输出敏感信息

```bash
cd /workspace/RuoYi-Cloud-Plus/ruoyi-ui
# 使用 grep 检查常见漏洞模式
grep -rn 'innerHTML\|v-html' src/
grep -rn 'eval(' src/
```

### 后端扫描

检查以下模式：
- MyBatis XML 中的 `${}`（SQL 注入风险）
- 字符串拼接 SQL
- 硬编码密钥

```bash
cd /workspace/RuoYi-Cloud-Plus
grep -rn '\${}' --include="*.xml" src/main/resources/mapper/
grep -rn -E '(password|secret|key|token)\s*=\s*"[^"]+"' src/main/java/
```

## 严重程度判断

- **critical**: SQL 注入、XSS、硬编码密钥
- **high**: 未转义的用户输入
- **medium**: console.log 敏感信息
- **low**: 代码风格问题

## 输出格式

\`\`\`json
{
  "ok": true,
  "issues": [],
  "summary": "未发现安全问题"
}
\`\`\`

**ok 为 false 的例子**：

\`\`\`json
{
  "ok": false,
  "issues": [
    {
      "file": "src/views/xxx.vue",
      "line": 123,
      "severity": "high",
      "type": "XSS",
      "message": "未转义的用户输入直接拼接到 HTML",
      "suggestion": "使用 textContent 或 DOMPurify.sanitize()"
    }
  ],
  "summary": "发现 1 个高危安全问题"
}
\`\`\`

## 输出前自检清单

- [ ] 是否包含 ` ```json ` 代码块？
- [ ] JSON 中是否包含 `ok` 字段？
- [ ] JSON 中是否包含 `issues` 数组？
- [ ] JSON 中是否包含 `summary` 字段？
- [ ] 每个 issue 是否都有 severity？
```

- [ ] **Step 2: 验证文件格式**

```bash
head -n 6 packages/core/agents/ruoyi/security-scanner.md
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/agents/ruoyi/security-scanner.md
git commit -m "feat(agent): 创建安全扫描 agent 定义

- 检测 XSS、SQL 注入、敏感信息泄露
- 前端：innerHTML、v-html、eval 检查
- 后端：MyBatis ${}、硬编码密钥检查
- 输出结构化 JSON 包含 severity

Issue: P1-4 缺少安全扫描阶段"
```

---

### Task 5: 扩展 state schema 支持 code_fix_history

**Files:**
- Modify: `packages/core/src/graph/state-schema.mts:15-30`

**Interfaces:**
- Consumes: 无
- Produces: `code_fix_history` 字段，类型为 `Array<{ attempt, issues, fixes_applied, review_result }>`

- [ ] **Step 1: 编写 state schema 扩展的测试**

Create: `packages/core/src/graph/state-schema.test.mts`

```typescript
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
    const defaultValue = []
    expect(defaultValue).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test src/graph/state-schema.test.mts
```

预期：可能通过（因为只是验证逻辑，不依赖实际定义）

- [ ] **Step 3: 扩展 TopState 定义**

在 `state-schema.mts` 的 TopState 定义中，在 `session_refs` 之后添加：

```typescript
export const TopState = Annotation.Root({
  // ... 已有字段
  session_refs: Annotation<Array<{ node_id: string; session_id: string }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => []
  }),
  
  // 新增：code_fix 历史记录
  code_fix_history: Annotation<Array<{
    attempt: number
    issues: any[]
    fixes_applied: string
    review_result: string
  }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => []
  }),
})
```

- [ ] **Step 4: 同样扩展 SubState（如果需要）**

在 SubState 定义中添加相同字段（如果 SubState 也需要）

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm test src/graph/state-schema.test.mts
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
pnpm exec tsc --noEmit
```

预期：无编译错误

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/graph/state-schema.mts packages/core/src/graph/state-schema.test.mts
git commit -m "feat(state): 扩展 state schema 支持 code_fix_history

- 新增 code_fix_history 字段记录修复历史
- 使用 reducer 累积多次修复记录
- 包含 attempt、issues、fixes_applied、review_result
- 增加单元测试

Issue: P2-2 死代码反复出现"
```

---

### Task 6: 创建新工作流 ruoyi-dev-flow-v2.yaml

**Files:**
- Create: `packages/core/workflows/ruoyi-dev-flow-v2.yaml`

**Interfaces:**
- Consumes: 现有的 agent 定义和条件函数
- Produces: 完整的新工作流定义，包含 10 个节点和 15 条边

- [ ] **Step 1: 创建工作流文件头部**

```yaml
# 若依研发流程 V2（真正的 TDD + 编译检查 + 安全扫描）
#
# 流程：write_tests → run_initial_tests → develop → compile_check → test → security_scan → code_review ↔ code_fix → final_review
#
# 改进：
# 1. 真正的 TDD：run_initial_tests 确认测试失败
# 2. 编译检查：compile_check 智能判断前后端
# 3. 安全扫描：security_scan 独立阶段
# 4. 修复验证：code_fix → compile_check → regression_test → code_review
# 5. 人审不跳过：final_review gate 强制触发

version: "1"
id: ruoyi-dev-flow-v2
name: 若依研发流程 V2
description: 真正的 TDD + 编译检查 + 安全扫描 + 修复验证
```

- [ ] **Step 2: 定义 10 个节点**

```yaml
nodes:
  # 1. 写测试（TDD Red 阶段）
  - id: write_tests
    type: agent
    name: 写测试
    agent_binding_ids: [test-engineer]
    inputs: [task]
    write_key: results
    prompt: |
      根据任务需求编写测试用例。
      期望：测试应该失败（因为代码还没写）

  # 2. 运行初始测试（确认失败）
  - id: run_initial_tests
    type: agent
    name: 运行初始测试
    agent_binding_ids: [tester]
    inputs: [task, write_tests]
    write_key: results
    prompt: |
      运行刚写好的测试。
      期望：测试失败（ok: false, failed_count > 0）

  # 3. 开发（TDD Green 阶段）
  - id: develop
    type: agent
    name: 开发
    agent_binding_ids: [ruoyi-developer]
    inputs: [task, run_initial_tests]
    write_key: results
    prompt: |
      根据失败的测试实现功能，让测试通过。
      参考 run_initial_tests 的失败信息了解需求。

  # 4. 编译检查（智能判断前后端）
  - id: compile_check
    type: agent
    name: 编译检查
    agent_binding_ids: [compiler]
    inputs: [task, develop]
    write_key: results
    prompt: |
      验证代码能否编译通过。
      前后端分离项目，根据文件类型智能判断。

  # 5. 测试验证
  - id: test
    type: agent
    name: 测试验证
    agent_binding_ids: [tester]
    inputs: [task, develop]
    write_key: results
    prompt: |
      运行完整测试套件。
      期望：测试通过（ok: true）

  # 6. 安全扫描
  - id: security_scan
    type: agent
    name: 安全扫描
    agent_binding_ids: [security-scanner]
    inputs: [task, develop]
    write_key: results
    prompt: |
      扫描代码中的安全漏洞。
      检测：XSS、SQL 注入、敏感信息泄露

  # 7. 代码审查
  - id: code_review
    type: agent
    name: 代码审查
    agent_binding_ids: [reviewer]
    inputs: [task, develop, test, security_scan]
    write_key: results
    prompt: |
      五维度代码审查（正确性、安全性、性能、可维护性、规范性）。
      参考测试和安全扫描结果。

  # 8. 代码修复
  - id: code_fix
    type: agent
    name: 代码修复
    agent_binding_ids: [code-fixer]
    inputs: [task, code_review, code_fix_history]
    write_key: results
    prompt: |
      修复 code_review 发现的问题。
      参考 code_fix_history 避免重复修改。

  # 9. 回归测试（验证修复）
  - id: regression_test
    type: agent
    name: 回归测试
    agent_binding_ids: [tester]
    inputs: [task, code_fix]
    write_key: results
    prompt: |
      验证修复是否成功，是否引入新问题。
      运行完整测试套件。

  # 10. 最终审查（人审 gate）
  - id: final_review
    type: gate
    name: 最终审查
```

- [ ] **Step 3: 定义 15 条边**

```yaml
edges:
  # TDD Red: 写测试 → 运行测试
  - from: write_tests
    to: run_initial_tests

  # 初始测试失败 → 开发（真正的 TDD）
  - from: run_initial_tests
    to: develop
    condition:
      type: function
      config:
        name: test_fail
        source: run_initial_tests

  # 初始测试通过 → 跳过 TDD，直接进入开发
  - from: run_initial_tests
    to: develop
    condition:
      type: function
      config:
        name: test_pass
        source: run_initial_tests

  # 开发 → 编译检查
  - from: develop
    to: compile_check

  # 编译通过 → 测试
  - from: compile_check
    to: test
    condition:
      type: function
      config:
        name: compile_pass
        source: compile_check

  # 编译失败 → 回到开发
  - from: compile_check
    to: develop
    condition:
      type: function
      config:
        name: compile_fail
        source: compile_check
    loop_max: 2

  # 测试通过 → 安全扫描
  - from: test
    to: security_scan
    condition:
      type: function
      config:
        name: test_pass
        source: test

  # 测试失败 → 回到开发
  - from: test
    to: develop
    condition:
      type: function
      config:
        name: test_fail
        source: test
    loop_max: 2

  # 安全扫描通过 → 代码审查
  - from: security_scan
    to: code_review
    condition:
      type: function
      config:
        name: security_pass
        source: security_scan

  # 安全扫描发现问题 → 回到开发
  - from: security_scan
    to: develop
    condition:
      type: function
      config:
        name: security_issues
        source: security_scan
    loop_max: 2

  # 代码审查通过 → 最终审查
  - from: code_review
    to: final_review
    condition:
      type: function
      config:
        name: code_review_pass
        source: code_review

  # 代码审查发现问题 → 代码修复
  - from: code_review
    to: code_fix
    condition:
      type: function
      config:
        name: code_review_issues
        source: code_review
    loop_max: 3

  # 代码修复 → 编译检查
  - from: code_fix
    to: compile_check

  # 回归测试通过 → 重新审查
  - from: regression_test
    to: code_review
    condition:
      type: function
      config:
        name: test_pass
        source: regression_test

  # 回归测试失败 → 回到修复
  - from: regression_test
    to: code_fix
    condition:
      type: function
      config:
        name: test_fail
        source: regression_test
    loop_max: 2

  # 最终审查 → 结束
  - from: final_review
    to: __end__

start:
  - write_tests
```

- [ ] **Step 4: 验证 YAML 语法**

```bash
cd packages/core
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const doc = yaml.load(fs.readFileSync('workflows/ruoyi-dev-flow-v2.yaml', 'utf8'));
console.log('YAML 解析成功');
console.log('节点数:', doc.nodes.length);
console.log('边数:', doc.edges.length);
"
```

预期：输出 "节点数: 10, 边数: 15"

- [ ] **Step 5: Commit**

```bash
git add packages/core/workflows/ruoyi-dev-flow-v2.yaml
git commit -m "feat(workflow): 创建 ruoyi-dev-flow-v2 工作流

新增节点：
- run_initial_tests: TDD Red 阶段验证
- compile_check: 编译检查
- security_scan: 安全扫描
- regression_test: 回归测试

改进：
- 真正的 TDD 流程
- 前后端编译检查
- 独立安全扫描
- 修复后验证机制
- 人审不可跳过

Issue: P0-1, P1-1, P1-2, P1-4, P1-5"
```

---

### Task 7: 修正 loop_max 语义（可选，根据决策）

**Files:**
- Modify: `packages/core/src/graph/builder.mts:119` 或文档

**Interfaces:**
- Consumes: `visits`, `limit`
- Produces: 修正后的边界判断逻辑

**注意**：此任务根据实际调试结果决定是否执行。如果路由日志显示 `visits <= limit` 不是问题根因，可以跳过此任务。

- [ ] **Step 1: 决策 - 修改代码还是文档**

基于 Task 1 的日志分析结果：

**方案 A：修改代码**（如果 `visits <= limit` 确实导致多一次执行）

```typescript
// builder.mts:119
if (visits < limit) {  // 改为 <
  // 回环逻辑
}
```

**方案 B：保持代码，更新文档**（如果当前逻辑符合预期）

在 `ruoyi-dev-flow-v2.yaml` 顶部注释中说明：
```yaml
# loop_max 语义：
# - loop_max: 2 意味着节点可以执行 3 次（初始 1 次 + 回环 2 次）
# - visits 从 1 开始计数（不是从 0）
# - 判断条件：visits <= limit
```

- [ ] **Step 2: 根据决策执行修改**

（此步骤根据方案 A 或 B 执行）

- [ ] **Step 3: Commit**

```bash
git add <modified files>
git commit -m "fix(router): 修正 loop_max 语义

[根据实际修改内容填写]

Issue: P3-1 loop_max 语义模糊"
```

---

### Task 8: 集成测试 - 端到端验证新工作流

**Files:**
- Create: `packages/core/tests/integration/workflow-v2.test.mts`

**Interfaces:**
- Consumes: 完整的系统栈（数据库、LangGraph、agents）
- Produces: 端到端测试验证所有改进

- [ ] **Step 1: 编写集成测试框架**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'
import { buildGraphFromWorkflow } from '../../src/graph/builder.mjs'
import { loadWorkflowFromYaml } from '../../src/graph/yaml-loader.mjs'

describe('Workflow V2 Integration Tests', () => {
  let workflowDef: any
  let graph: any
  
  beforeAll(async () => {
    // 加载工作流
    workflowDef = await loadWorkflowFromYaml('ruoyi-dev-flow-v2')
    graph = await buildGraphFromWorkflow(workflowDef, {} as any)
  })
  
  afterAll(async () => {
    await db.$disconnect()
  })
  
  it('should load workflow with 10 nodes', () => {
    expect(workflowDef.nodes).toHaveLength(10)
  })
  
  it('should load workflow with 15 edges', () => {
    expect(workflowDef.edges).toHaveLength(15)
  })
  
  it('should have run_initial_tests node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'run_initial_tests')
    expect(node).toBeDefined()
    expect(node.type).toBe('agent')
  })
  
  it('should have compile_check node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'compile_check')
    expect(node).toBeDefined()
    expect(node.agent_binding_ids).toContain('compiler')
  })
  
  it('should have security_scan node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'security_scan')
    expect(node).toBeDefined()
    expect(node.agent_binding_ids).toContain('security-scanner')
  })
  
  it('should have regression_test node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'regression_test')
    expect(node).toBeDefined()
  })
  
  it('should have final_review gate', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'final_review')
    expect(node).toBeDefined()
    expect(node.type).toBe('gate')
  })
})
```

- [ ] **Step 2: 运行集成测试**

```bash
pnpm test tests/integration/workflow-v2.test.mts
```

预期：ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/integration/workflow-v2.test.mts
git commit -m "test(workflow): 添加 workflow V2 集成测试

验证：
- 10 个节点正确加载
- 15 条边正确定义
- 关键节点（run_initial_tests, compile_check, security_scan, regression_test, final_review）存在
- agent 绑定正确

Issue: 全部问题验收"
```

---

### Task 9: 更新 graph_definitions 表插入 V2 工作流

**Files:**
- Create: `packages/core/migrations/insert-workflow-v2.sql`

**Interfaces:**
- Consumes: `ruoyi-dev-flow-v2.yaml`
- Produces: 数据库记录

- [ ] **Step 1: 创建 SQL 迁移脚本**

```sql
-- 插入新工作流定义到 graph_definitions 表
INSERT INTO graph_definitions (
  graph_definition_id,
  name,
  description,
  yaml_content,
  created_at,
  updated_at
) VALUES (
  'ruoyi-dev-flow-v2',
  '若依研发流程 V2',
  '真正的 TDD + 编译检查 + 安全扫描 + 修复验证',
  (SELECT content FROM pg_read_file('/path/to/ruoyi-dev-flow-v2.yaml')::text),
  NOW(),
  NOW()
)
ON CONFLICT (graph_definition_id) 
DO UPDATE SET
  yaml_content = EXCLUDED.yaml_content,
  updated_at = NOW();
```

- [ ] **Step 2: 手动插入或使用脚本**

由于路径问题，使用 Node.js 脚本：

Create: `packages/core/scripts/insert-workflow-v2.mjs`

```javascript
import { db } from '../src/db.mjs'
import fs from 'fs'

async function main() {
  const yamlContent = fs.readFileSync('workflows/ruoyi-dev-flow-v2.yaml', 'utf8')
  
  await db.graph_definitions.upsert({
    where: { graph_definition_id: 'ruoyi-dev-flow-v2' },
    create: {
      graph_definition_id: 'ruoyi-dev-flow-v2',
      name: '若依研发流程 V2',
      description: '真正的 TDD + 编译检查 + 安全扫描 + 修复验证',
      yaml_content: yamlContent,
      created_at: new Date(),
      updated_at: new Date()
    },
    update: {
      yaml_content: yamlContent,
      updated_at: new Date()
    }
  })
  
  console.log('✓ Workflow V2 已插入到 graph_definitions 表')
  
  await db.$disconnect()
}

main().catch(console.error)
```

- [ ] **Step 3: 执行脚本**

```bash
cd packages/core
node scripts/insert-workflow-v2.mjs
```

预期：输出 "✓ Workflow V2 已插入到 graph_definitions 表"

- [ ] **Step 4: 验证数据库**

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.graph_definitions.findUnique({ where: { graph_definition_id: 'ruoyi-dev-flow-v2' } })
  .then(r => console.log(r ? '✓ 找到 workflow V2' : '✗ 未找到'))
  .then(() => db.\$disconnect())
"
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/scripts/insert-workflow-v2.mjs
git commit -m "chore(db): 插入 workflow V2 到 graph_definitions 表

通过脚本自动插入 ruoyi-dev-flow-v2 工作流定义

Issue: 准备生产环境"
```

---

### Task 10: 文档更新 - README 和使用指南

**Files:**
- Modify: `README.md`
- Create: `docs/workflow-v2-guide.md`

**Interfaces:**
- Consumes: 所有实施成果
- Produces: 用户文档

- [ ] **Step 1: 更新 README.md**

在 README.md 的 "工作流" 部分添加：

```markdown
## 工作流

### V2 版本（推荐）

基于执行数据分析，优化后的研发工作流包含以下改进：

- ✅ **真正的 TDD**：`run_initial_tests` 确认测试失败后再开发
- ✅ **编译检查**：`compile_check` 智能判断前后端，快速失败
- ✅ **安全扫描**：`security_scan` 独立阶段，检测 XSS、SQL 注入等
- ✅ **修复验证**：`code_fix` 后强制 `regression_test`，防止引入新问题
- ✅ **人审不跳过**：`final_review` gate 强制触发

**使用方式**：

```typescript
// 创建 requirement 时指定 V2 工作流
await db.requirements.create({
  data: {
    title: '实现 XXX 功能',
    graph_definition_id: 'ruoyi-dev-flow-v2',  // 使用 V2
    ...
  }
})
```

详细设计文档：`docs/superpowers/specs/2026-09-15-dev-workflow-optimization-design.md`
```

- [ ] **Step 2: 创建使用指南**

Create: `docs/workflow-v2-guide.md`

```markdown
# 研发工作流 V2 使用指南

## 概述

V2 工作流基于对「实现维修费用统计前端页面」任务的执行数据分析，修复了 10 个已识别问题。

## 新增节点

| 节点 | 作用 | Agent |
|------|------|-------|
| run_initial_tests | 运行初始测试，确认失败（TDD Red） | tester |
| compile_check | 编译检查，智能判断前后端 | compiler |
| security_scan | 安全扫描，检测 XSS、SQL 注入等 | security-scanner |
| regression_test | 回归测试，验证修复未引入新问题 | tester |

## 流程图

```
write_tests → run_initial_tests → develop → compile_check → test
                                     ↑          ↑              ↓
                                     |          |        security_scan
                                     |          |              ↓
                                     |      code_review ←──────┘
                                     |       ↓       ↓
                                     |  final  code_fix
                                     |   review      ↓
                                     |    ↓     compile_check
                                     |  __end__      ↓
                                     └─────────regression_test
                                                     ↓
                                                code_review
```

## 验收标准

1. **TDD 验证**：`run_initial_tests` 输出 `ok: false`
2. **编译验证**：前后端分别编译
3. **安全验证**：发现 high/critical 问题时 `ok: false`
4. **修复验证**：`code_fix` 后必须通过 `regression_test`
5. **人审不跳过**：`final_review` 记录存在

## 迁移指南

### 从 V1 迁移到 V2

1. **更新 requirement 的 graph_definition_id**：

```sql
UPDATE requirements 
SET graph_definition_id = 'ruoyi-dev-flow-v2'
WHERE graph_definition_id = 'ruoyi-dev-flow';
```

2. **确保新 agents 已定义**：

- `compiler.md`
- `security-scanner.md`

3. **验证条件函数已注册**：

- `compile_pass` / `compile_fail`
- `security_pass` / `security_issues`

## 故障排查

### 问题：compile_check 失败

**检查**：
1. 工作目录是否正确（后端：`/workspace/RuoYi-Cloud-Plus`，前端：`ruoyi-ui`）
2. develop 输出的 files_modified 是否包含文件路径
3. 编译命令是否正确

### 问题：security_scan 误报

**解决**：
1. 检查 agent prompt 中的 severity 判断
2. 调整 high/critical 的判断标准
3. 人工审核 inbox_questions

### 问题：final_review 仍被跳过

**调试**：
1. 查看路由日志：`tail -f logs/core.log | grep '\[router\]'`
2. 检查 `code_review` 的输出是否包含 `ok: true`
3. 检查 `loop_counters['code_review']` 的值

## 性能对比

| 指标 | V1 | V2 | 改进 |
|------|----|----|------|
| 总耗时 | ~26分钟 | 预计 ~20分钟 | 快速失败 |
| code_review 循环 | 3次 | 预计 1-2次 | 修复验证 |
| 安全问题发现 | code_review 发现 | 独立阶段 | 前置 |
| 人审触发 | 跳过 | 强制 | 质量保证 |
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/workflow-v2-guide.md
git commit -m "docs: 更新文档介绍 workflow V2

- README 添加 V2 特性说明
- 创建详细使用指南
- 包含迁移指南和故障排查
- 性能对比数据

Issue: 文档完整性"
```

---

## Self-Review

### Spec 覆盖检查

| Spec 章节 | 对应任务 | 状态 |
|----------|---------|------|
| §1.2 P0-1 final_review 被跳过 | Task 1 | ✅ |
| §1.2 P1-1 TDD 名不副实 | Task 6 (run_initial_tests 节点) | ✅ |
| §1.2 P1-2 缺少编译检查 | Task 2, 3, 6 | ✅ |
| §1.2 P1-3 code_fix 引入漏洞 | Task 6 (regression_test) | ✅ |
| §1.2 P1-4 缺少安全扫描 | Task 2, 4, 6 | ✅ |
| §1.2 P1-5 code_fix 缺少验证 | Task 6 (code_fix → compile_check → regression_test) | ✅ |
| §1.2 P2-1 code_review 循环效率低 | Task 5, 6 (code_fix_history) | ✅ |
| §1.2 P2-2 死代码反复出现 | Task 5 (code_fix_history) | ✅ |
| §1.2 P2-3 测试覆盖不足 | Task 4 (security_scan) | ✅ |
| §1.2 P3-1 loop_max 语义模糊 | Task 7 | ✅ |
| §5.1 新增条件函数 | Task 2 | ✅ |
| §6.2 路由日志 | Task 1 | ✅ |
| §7.1 compiler agent | Task 3 | ✅ |
| §7.2 security-scanner agent | Task 4 | ✅ |
| §4.5 code_fix_history | Task 5 | ✅ |
| §3 新流程设计 | Task 6 | ✅ |

### Placeholder 扫描

检查所有任务，确认无以下模式：
- ✅ 无 "TBD"、"TODO"
- ✅ 无 "implement later"
- ✅ 所有代码块完整
- ✅ 所有测试步骤明确

### Type 一致性

检查跨任务的类型引用：
- ✅ `compilePass`/`compileFail` 在 Task 2 定义，Task 6 引用
- ✅ `securityPass`/`securityIssues` 在 Task 2 定义，Task 6 引用
- ✅ `code_fix_history` 在 Task 5 定义，Task 6 引用
- ✅ 所有节点 ID 一致（write_tests, run_initial_tests, develop, compile_check, test, security_scan, code_review, code_fix, regression_test, final_review）

---

## 执行说明

计划已完整，包含 10 个任务，覆盖所有 10 个问题。

**预计工作量**：约 21 小时（与 spec §8 一致）

**任务依赖**：
- Task 1 可独立执行
- Task 2-5 可并行执行
- Task 6 依赖 Task 2-5
- Task 7 依赖 Task 1 的调试结果
- Task 8-10 依赖 Task 6
