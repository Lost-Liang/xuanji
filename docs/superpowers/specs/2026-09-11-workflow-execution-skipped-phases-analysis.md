# 工作流执行跳过阶段问题分析

**日期**: 2026-09-11  
**问题**: 任务 728fbb58-bd42-4492-9424-38500eaa4532 执行过程中跳过了 code_review 和 final_review 阶段

---

## 问题现象

### 预期行为

根据 `ruoyi-dev-flow.yaml` 定义，完整的执行流程应该是：

```
write_tests → develop → test → code_review → code_fix(条件) → final_review
```

- test 阶段完成后，根据 `state.results.test?.passed` 的值：
  - 如果 `passed === true` → 进入 code_review
  - 如果 `passed === false` → 回到 develop（最多循环 2 次）

### 实际行为

实际只执行了 3 个阶段：

```
write_tests → develop → test → (直接结束)
```

跳过了 code_review 和 final_review 阶段。

---

## 根本原因

### 1. 条件类型不匹配

**YAML 定义的条件类型**:

```yaml
# ruoyi-dev-flow.yaml 第 75-88 行
- source: test
  target: code_review
  condition:
    type: expression
    config:
      expression: "state.results.test?.passed === true"
```

**Builder 支持的条件类型**:

```typescript
// packages/core/src/graph/builder.mts 第 85-92 行
for (const e of nonDefault) {
  if (!e.condition) continue
  if (e.condition.type === 'keyword') {
    if (evaluateKeywordCondition(sourceText(state, meta.source), e.condition.config)) return e.target
  } else if (e.condition.type === 'function') {
    const fn = getCondition(e.condition.config.name!)
    if (fn(state)) return e.target
  }
  // ❌ 没有处理 type === 'expression' 的情况！
}
```

**问题**: Builder 的 `routeFromSource` 函数只支持 `keyword` 和 `function` 两种条件类型，**不支持 `expression` 类型**。

### 2. 条件评估失败时的默认行为

```typescript
// builder.mts 第 113-114 行
const d = meta.edges.find((e) => e.is_default)
return d ? d.target : '__end__'
```

当条件评估失败（没有匹配的条件）时：
1. 查找标记为 `is_default: true` 的边
2. 如果没有默认边，直接返回 `'__end__'`（结束工作流）

**结果**: test 阶段完成后，由于 `expression` 类型的条件无法评估，所有条件边都被跳过，工作流直接结束。

### 3. 数据格式不匹配

即使实现了 `expression` 类型的支持，还有一个问题：

**YAML 中的表达式**:
```javascript
state.results.test?.passed === true
```

**实际的数据结构**:

```typescript
// agent-node.mts 的 buildReturn 函数返回的格式
return {
  results: [{ node_id: nodeId, output, phase_instance_id: phaseInstanceId }],
  session_refs,
}
```

**问题分析**:
- `state.results` 是一个**数组**，不是对象
- 应该访问 `state.results[0].output` 而不是 `state.results.test`
- 即使改为 `state.results[0].output`，output 是**字符串**（markdown 文本），不是包含 `passed` 字段的对象

---

## 影响范围

### 受影响的执行

所有使用 `ruoyi-dev-flow.yaml` 的工作流都会受到影响：
- test 阶段完成后无法进入 code_review
- 代码审查环节被完全跳过
- 质量问题无法被发现

### 潜在风险

1. **代码质量无法保证**: 缺少 code_review 环节，代码问题无法被发现
2. **人工审查被跳过**: final_review 是人工 Gate，跳过意味着缺少人工确认
3. **TDD 流程不完整**: 测试 → 审查 → 修复的循环被破坏

---

## 解决方案

### 方案 1: 实现 expression 条件类型（推荐）

在 `builder.mts` 中添加对 `expression` 类型的支持：

```typescript
// packages/core/src/graph/builder.mts
import { evaluateExpression } from './conditions/expression-evaluator.mjs'

export function routeFromSource(state: any, meta: RouteMeta, DEFAULT_MAX: number = 3): string {
  const nonDefault = meta.edges.filter((e) => !e.is_default && !e.loop_back)
  const loopBack = meta.edges.find((e) => e.loop_back)

  // 评估非回环条件边
  for (const e of nonDefault) {
    if (!e.condition) continue
    if (e.condition.type === 'keyword') {
      if (evaluateKeywordCondition(sourceText(state, meta.source), e.condition.config)) return e.target
    } else if (e.condition.type === 'function') {
      const fn = getCondition(e.condition.config.name!)
      if (fn(state)) return e.target
    } else if (e.condition.type === 'expression') {
      // ✅ 新增：支持 expression 类型
      if (evaluateExpression(state, e.condition.config.expression)) return e.target
    }
  }
  
  // ... 其余代码
}
```

**实现 expression-evaluator.mts**:

```typescript
// packages/core/src/graph/conditions/expression-evaluator.mts
import { get } from 'lodash'

/**
 * 评估表达式条件
 * 支持简单的路径访问和比较操作
 * 
 * @param state 工作流状态
 * @param expression 表达式字符串，如 "state.results.test?.passed === true"
 * @returns 评估结果
 */
export function evaluateExpression(state: any, expression: string): boolean {
  try {
    // 简单的表达式解析（支持路径访问和 === 比较）
    const match = expression.match(/^([\w.\[\]?]+)\s*===\s*(.+)$/)
    if (!match) {
      console.warn(`无法解析表达式: ${expression}`)
      return false
    }
    
    const [, path, expectedStr] = match
    const actual = get(state, path.replace(/\?\./g, '.'))
    
    // 解析期望值
    let expected: any
    if (expectedStr === 'true') expected = true
    else if (expectedStr === 'false') expected = false
    else if (expectedStr === 'null') expected = null
    else if (/^\d+$/.test(expectedStr)) expected = parseInt(expectedStr, 10)
    else if (/^["'].*["']$/.test(expectedStr)) expected = expectedStr.slice(1, -1)
    else expected = expectedStr
    
    return actual === expected
  } catch (error) {
    console.error(`表达式评估失败: ${expression}`, error)
    return false
  }
}
```

### 方案 2: 修改 YAML 使用 function 条件类型

修改 `ruoyi-dev-flow.yaml`，使用已注册的函数条件：

```yaml
# ruoyi-dev-flow.yaml
- source: test
  target: code_review
  condition:
    type: function
    config:
      name: test_pass  # 使用已注册的 test_pass 条件函数

- source: test
  target: develop
  condition:
    type: function
    config:
      name: test_fail
  loop_max: 2
```

**需要修改 test 阶段的输出格式**:

```typescript
// agent-node.mts 或专门的 test agent
// 确保输出格式符合 test_pass 条件的期望
function buildTestResult(testPassed: boolean) {
  return JSON.stringify({ ok: testPassed })
}
```

### 方案 3: 统一数据格式（长期方案）

重新设计工作流状态的数据格式，使其更清晰：

```typescript
// 新的状态格式
interface WorkflowState {
  results: {
    [nodeId: string]: {
      output: string
      passed?: boolean  // 对于 test 节点
      approved?: boolean  // 对于 review 节点
      issues?: string[]  // 对于 review 节点
    }
  }
  session_refs: SessionRef[]
  loop_counters: Record<string, number>
}
```

**优点**:
- 数据结构更清晰
- 表达式更容易编写
- 类型安全

**缺点**:
- 需要大规模重构
- 向后兼容性问题

---

## 实施计划

### 阶段 1: 紧急修复（1-2 天）

1. **实现 expression 条件评估器**
   - 创建 `expression-evaluator.mts`
   - 支持基本的路径访问和比较操作
   - 添加单元测试

2. **修改 builder.mts**
   - 在 `routeFromSource` 中添加 `expression` 类型处理
   - 添加错误处理和日志

3. **验证修复**
   - 使用测试执行验证 code_review 是否被触发
   - 检查数据库中的 phase_instances 记录

### 阶段 2: 数据格式对齐（3-5 天）

1. **分析现有数据格式**
   - 梳理所有 agent 节点的输出格式
   - 确定统一的输出 schema

2. **修改 agent 节点**
   - 确保 test 节点输出包含 `passed` 字段
   - 确保 review 节点输出包含 `approved` 字段

3. **更新 YAML 定义**
   - 根据新的数据格式调整表达式
   - 添加文档说明

### 阶段 3: 长期优化（1-2 周）

1. **重构状态管理**
   - 统一工作流状态的数据格式
   - 添加类型定义和验证

2. **增强条件评估**
   - 支持更复杂的表达式（AND/OR/NOT）
   - 支持函数调用

3. **添加调试工具**
   - 条件评估日志
   - 工作流执行可视化
   - 断点调试支持

---

## 验证清单

### 功能验证

- [ ] test 阶段完成后能正确进入 code_review
- [ ] code_review 阶段完成后能正确进入 final_review
- [ ] 条件评估失败时有清晰的错误日志
- [ ] 循环次数限制正常工作（loop_max）

### 数据验证

- [ ] phase_instances 表中有 code_review 和 final_review 的记录
- [ ] phase_outputs 表中有对应的输出数据
- [ ] task_executions 的 status 字段正确反映最终状态

### 边界情况

- [ ] test 阶段失败时能正确回到 develop
- [ ] 达到循环次数限制后能正确结束
- [ ] 表达式语法错误时能优雅降级

---

## 相关文件

- `packages/core/src/graph/builder.mts` - 条件评估逻辑
- `packages/core/src/graph/conditions/default-conditions.mts` - 已注册的条件函数
- `packages/core/workflows/ruoyi-dev-flow.yaml` - 工作流定义
- `packages/core/src/graph/agent-node.mts` - Agent 节点输出格式

---

## 总结

工作流跳过阶段的根本原因是**条件类型不匹配**：YAML 定义使用 `expression` 类型，但 Builder 只支持 `keyword` 和 `function` 类型。这导致条件评估失败，工作流直接结束。

**紧急修复方案**是实现 `expression` 条件评估器，让工作流能够正确评估 YAML 中定义的条件表达式。

**长期方案**是统一数据格式，使工作流状态更清晰、更易于维护。
