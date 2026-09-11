# 璇玑 V4 核心问题修复设计文档

> 日期：2026-09-11
> 当前版本：v1
> 状态：待用户 review
> 影响范围：`packages/runner/src/local-runner.ts`、`packages/core/src/graph/agent-node.mts`、`packages/core/src/graph/shared-agent-utils.mts`、`packages/core/src/graph/conditions/default-conditions.mts`、`packages/core/workflows/ruoyi-dev-flow.yaml`

---

## 背景

从任务 `728fbb58-bd42-4492-9424-38500eaa4532` 的执行过程分析中，发现三个核心问题：

1. **Agent 输出未结构化**：Agent 输出是 markdown 文本，下游无法解析，导致角色越界
2. **条件评估机制不完整**：YAML 定义了 expression 类型条件，但 Builder 不支持，导致 code_review 等阶段被跳过
3. **事件记录 Bug**：conversation_events 表记录了 18,043 条重复的 model_started 事件

这三个问题共同导致研发流程执行不完整、Agent 协作失效、监控失真。

---

## 1. Agent 输出结构化

### 1.1 问题

当前每个 Agent 输出 markdown 文本，存储到 `phase_outputs.value`。下游 Agent 和条件评估函数无法直接在 markdown 中读取结构化字段（如 `test.passed`）。

### 1.2 设计

要求所有 Agent 输出结构化的 JSON 对象，包含统一的 **base output** 和阶段特定的字段。

**基础输出（所有 Agent 共用）**：
```typescript
interface BaseOutput {
  ok: boolean          // 阶段是否成功完成
  summary: string      // 一句话总结
}
```

**阶段特定输出**：

- write_tests（测试工程师）
```typescript
interface WriteTestsOutput extends BaseOutput {
  test_files: string[]
  test_count: number
}
```

- develop（全栈开发）
```typescript
interface DevelopOutput extends BaseOutput {
  files_created: string[]
  files_modified: string[]
  compilation_ok: boolean
}
```

- test（测试验证员）
```typescript
interface TestOutput extends BaseOutput {
  passed: boolean        // 条件评估用这个字段
  passed_count: number
  total_count: number
  compilation_ok: boolean
}
```

- code_review（代码审查员）
```typescript
interface CodeReviewOutput extends BaseOutput {
  approved: boolean      // 条件评估用这个字段
  issues: string[]
}
```

- code_fix（代码修复工程师）
```typescript
interface CodeFixOutput extends BaseOutput {
  files_modified: string[]
  issues_resolved: string[]
}
```

### 1.3 实现方案

Agent 的 Prompt 定义在 `agent-node.mts` 的 `buildSystemPrompt` 函数中。在每个 Agent 的 Prompt 尾部追加输出格式要求。以 test agent 为例：

```
输出格式要求：
- 你的所有分析和思考过程写在普通文本中
- 在你的最终回答末尾，输出一个 JSON 代码块，包含以下字段：
  {
    "ok": boolean,          // 测试是否全部通过
    "summary": string,      // 一句话总结
    "passed": boolean,      // 测试是否全部通过
    "passed_count": number, // 通过的测试数
    "total_count": number   // 测试总数
  }
```

在 `agent-node.mts` 中解析 Agent 输出的最终回答末尾的 JSON 代码块，分别存储：
- `phase_outputs.value`：Agent 的完整输出（含分析和思考过程）
- `phase_instances.result_payload`（JSONB 字段）：解析出的 JSON 对象（结构化数据）

### 1.4 错误处理

解析失败时（Agent 没有输出 JSON 或格式不符）：
- 记录警告日志，不中断流程
- `result_payload` 设置为 `null`
- 条件评估时，`ok` 视为 `false`（Fail fast）

---

## 2. 条件评估机制

### 2.1 问题

`ruoyi-dev-flow.yaml` 定义了条件边：

```yaml
- from: test
  to: code_review
  condition:
    type: expression
    config:
      expression: "state.results.test?.passed === true"
```

但 `builder.mts` 的 `routeFromSource` 函数只支持 `keyword` 和 `function` 两种条件类型，**不支持 `expression` 类型**。导致条件评估失败，工作流直接结束。

### 2.2 设计

改为使用 `default-conditions.mts` 中已注册的 **function 类型** 条件函数。

需要两个改动：

**改动 1：修改 `parseNodeOutput` 函数，支持从 markdown 中提取 JSON 代码块**

当前 `parseNodeOutput` 只能解析纯 JSON 字符串。Agent 输出变为 markdown+JSON 后，需要先提取 JSON 代码块再解析：

```typescript
// default-conditions.mts 修改 parseNodeOutput
function parseNodeOutput(state: any, sourceId: string): { ok: boolean } | null {
  const text = sourceText(state, sourceId)
  if (!text || text === '') return null

  // 尝试从 ```json 代码块提取
  const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1])
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

**改动 2：新增 code_review 条件函数并注册**

```typescript
// default-conditions.mts 新增

export const codeReviewPass: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'code_review')
  return result?.ok === true
}

export const codeReviewIssues: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'code_review')
  return result === null || result.ok === false
}
```

注册这两个函数：
```typescript
// default-conditions.mts initDefaultConditions()
registerCondition('code_review_pass', codeReviewPass)
registerCondition('code_review_issues', codeReviewIssues)
```

### 2.3 YAML 修改

将 `ruoyi-dev-flow.yaml` 中的条件边从 `expression` 改为 `function`：

```yaml
# test → code_review（测试通过进入审查）
- from: test
  to: code_review
  condition:
    type: function
    config:
      name: test_pass

# test → develop（测试失败回到开发）
- from: test
  to: develop
  condition:
    type: function
    config:
      name: test_fail
  loop_max: 2

# code_review → final_review（审查通过进入终审）
- from: code_review
  to: final_review
  condition:
    type: function
    config:
      name: code_review_pass

# code_review → code_fix（审查发现问题进入修复）
- from: code_review
  to: code_fix
  condition:
    type: function
    config:
      name: code_review_issues
  loop_max: 3
```

---

## 3. 事件记录 Bug

### 3.1 问题

`mapAdapterEvent` 函数将所有 `system` 类型事件映射为 `model_started`。Runner 的 Adapter 在每个 streaming chunk 都发送 `system/init` 事件，导致每个 chunk 都创建一条 `model_started` 记录。

本次执行数据：**18,043 条 model_started 事件**（正常应只有 ~40 条）。

### 3.2 设计

`mapAdapterEvent` 只在会话初始化时记录 `model_started`，其他 `system` 事件不记录。

```typescript
// shared-agent-utils.mts 修改

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

调用端修改：

```typescript
// agent-node.mts onEvent 回调
onEvent: async (event: AdapterEvent) => {
  // ... 处理 sessionId 逻辑 ...

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

  // ... 累积 output 逻辑 ...
}
```

---

## 4. 测试验证

### 4.1 Agent 输出结构化验证

- [ ] 验证 Agent 输出包含 `ok` 和 `summary` 字段
- [ ] 验证 test agent 输出包含 `passed`、`passed_count`、`total_count` 字段
- [ ] 验证 code_review agent 输出包含 `approved`、`issues` 字段
- [ ] 验证解析失败时 `result_payload` 为 null，不中断流程

### 4.2 条件评估验证

- [ ] 执行完整工作流，验证 write_tests → develop → test → code_review → code_fix（条件）→ final_review 的流程
- [ ] 测试通过时正确进入 code_review
- [ ] 测试失败时正确回到 develop
- [ ] 审查通过时正确进入 final_review
- [ ] 审查发现问题时正确进入 code_fix
- [ ] 超过 loop_max 限制时正确终止循环

### 4.3 事件记录验证

- [ ] 验证 conversation_events 表中 model_started 的数量约等于 model_delta 的数量（而不是数量级差距）
- [ ] 验证 model_started 事件只包含 sessionId 字段
- [ ] 验证其他事件类型不受影响

---

## 5. 相关文件清单

| 文件 | 改动 |
|------|------|
| `packages/core/workflows/ruoyi-dev-flow.yaml` | 条件边改为 function 类型 |
| `packages/core/src/graph/conditions/default-conditions.mts` | 修改 parseNodeOutput 支持 JSON 代码块提取；新增 code_review_pass、code_review_issues 条件函数并注册 |
| `packages/core/src/graph/shared-agent-utils.mts` | mapAdapterEvent 返回类型改为可空，只在 init 时记录 |
| `packages/core/src/graph/agent-node.mts` | onEvent 回调只记录非空事件；解析 Agent 输出 JSON |
| `packages/core/src/graph/builder.mts` | 无需修改（function 类型已经支持） |

---

## 6. 不纳入范围

- Token 统计（LLM token tracking）：AgentOS 通过 PI 适配器实现，本项目未引入 PI CLI，暂不处理
- 数据库 schema 变更：不需要新的迁移
- Dashboard UI 改动：本次不涉及
- 需求管理层改动：需求管理层已完整实现

---

## 7. 风险

| 风险 | 缓解措施 |
|------|---------|
| Agent Prompt 修改后，Agent 不按要求输出 JSON | 解析失败时降级处理，不中断流程 |
| function 条件评估引用已删除的节点名 | 保留旧名称的兼容检查 |
| 事件记录修复后现有日志查询失效 | 只清理 model_started 重复事件，其他事件类型不变 |