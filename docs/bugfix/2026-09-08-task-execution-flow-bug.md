# 任务执行流程 Bug

> 日期：2026-09-08
> 状态：**已修复**

## 问题现象

1. 任务 `eb895d4e-749c-4dc2-b164-e7033ffd0a61` 执行流程异常：
   - 预期：develop → compile_check → test_check → quality_review → security_review → final_review
   - 实际：develop → quality_review → security_review（跳过 compile_check、test_check、final_review）

2. 点击"确认执行"后再点击"开始执行"报错"只能执行 pending 状态的任务"

## 根因分析

### 根因 1：tasks.mts 传参错误（最高优先级）

**文件**：`packages/core/src/routes/tasks.mts:217`

```typescript
// ❌ 错误：传的是 taskId 字符串
await graphRunner.startExecution({
  executionId,
  flowId: 'default-dev-flow',
  input: `执行任务 ${execution.taskId}`,  // 仅字符串
  task: execution.taskId,  // ❌ 字符串，不是对象！
});
```

**正确模式**（参考 worker-graph.mts:139-144）：

```typescript
// ✅ 正确：传完整任务对象
await graphRunner.startExecution({
  executionId,
  flowId: 'default-dev-flow',
  input: '',
  task: await taskStore.getById(taskId),  // ✅ 完整对象
});
```

### 根因 2：command-node 不创建 phase_instance

**文件**：`packages/core/src/graph/nodes/command-node.mts`

command-node 只返回 state 更新，不创建 phase_instance 记录。
导致 compile_check、test_check 在数据库中无记录。

### 根因 3：条件函数空状态处理

**文件**：`packages/core/src/graph/conditions/default-conditions.mts`

```typescript
export const compilePass: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'compile_check'))?.ok) === true }
  catch { return false }  // 空状态 → 解析失败 → false
}
export const compileFail: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'compile_check'))?.ok) === false }
  catch { return false }  // 空状态 → 解析失败 → false（不是 true！）
}
```

当 `node_outputs.compile_check` 为空时，两个条件都返回 false，
`routeFromSource` 找不到匹配的条件，返回 `__end__`。

### 根因 4：前端 TypeScript 类型缺失

**文件**：`packages/dashboard/src/api/tasks.ts`

TaskDetail 接口缺少 `title` 字段定义，导致 TypeScript 编译错误。

### 根因 5：execute API 竞态条件

**文件**：`packages/core/src/routes/tasks.mts:204-206`

**问题**：confirm 后调度器立即拾取任务变为 running，但前端还没刷新，用户点击"开始执行"时报错。

**流程**：
1. 用户点击"确认执行" → confirm API 把 draft → pending
2. 调度器立即拾取 pending 任务 → pending → running
3. 前端还没刷新，仍显示"开始执行"按钮
4. 用户点击"开始执行" → execute API 检查 status
5. 此时 status 已是 running → 报错"只能执行 pending 状态的任务"

## 修复方案（已实施）

### 修复 1：tasks.mts 传入完整 task 对象 ✅

```typescript
// packages/core/src/routes/tasks.mts

// 获取完整的任务对象（参考 worker-graph.mts 的正确模式）
const task = execution.taskId ? await taskStore.getById(execution.taskId) : null;
if (!task) {
  res.status(400).json({ error: '任务数据不存在', taskId: execution.taskId });
  return;
}

// 异步启动任务执行
setImmediate(async () => {
  try {
    const { graphRunner } = await import('../graph/graph-runner.mjs');
    await graphRunner.startExecution({
      executionId,
      flowId: 'default-dev-flow',
      input: '', // 任务上下文由 agent-node 从 task 对象读取
      task, // 传入完整的任务对象，而非 taskId 字符串
    });
  }
  // ...
});
```

### 修复 2：command-node.mts 创建 phase_instance ✅

```typescript
// packages/core/src/graph/nodes/command-node.mts

// 创建/复用 PhaseInstance（与 agent-node.mts 对齐）
let phaseInstance: { id: string } | null = null

if (execId) {
  // 查找已有的 phase instance（幂等续跑）
  const existing = await db.phaseInstance.findFirst({
    where: {
      executionId: execId,
      phaseId: nodeId,
      status: { in: ['running', 'completed'] },
    },
    orderBy: { attempt: 'desc' },
  })

  if (existing && existing.status === 'running') {
    phaseInstance = { id: existing.id }
  } else {
    const newPhase = await db.phaseInstance.create({
      data: {
        id: randomUUID(),
        executionId: execId,
        phaseId: nodeId,
        taskId: _state?.task?.id ?? null,
        attempt: (existing?.attempt ?? 0) + 1,
        status: 'running',
        startedAt: new Date(),
      },
    })
    phaseInstance = { id: newPhase.id }
  }
}

// ... 执行命令 ...

// 更新 PhaseInstance 状态
if (phaseInstance) {
  await db.phaseInstance.update({
    where: { id: phaseInstance.id },
    data: {
      status: compile_result.ok ? 'completed' : 'failed',
      completedAt: new Date(),
      resultSummary: JSON.stringify(compile_result),
    },
  })
}
```

### 修复 3：条件函数空状态防御 ✅

```typescript
// packages/core/src/graph/conditions/default-conditions.mts

function parseNodeOutput(state: any, sourceId: string): { ok: boolean } | null {
  try {
    const text = reading(state, sourceId)
    if (!text || text === '') return null  // 空状态
    const parsed = JSON.parse(text)
    if (typeof parsed?.ok === 'boolean') return parsed
    return null
  } catch {
    return null
  }
}

export const compilePass: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'compile_check')
  return result?.ok === true
}
export const compileFail: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'compile_check')
  // 防御性处理：没有输出或 ok=false 都视为失败
  return result === null || result.ok === false
}
```

**测试结果**：
```
=== 空状态测试 ===
compilePass(emptyState): false
compileFail(emptyState): true  ← 空状态视为失败，路由到 bug_fix

=== 成功状态测试 ===
compilePass(successState): true
compileFail(successState): false

=== 失败状态测试 ===
compilePass(failState): false
compileFail(failState): true
```

### 修复 4：前端 TypeScript 类型补全 ✅

```typescript
// packages/dashboard/src/api/tasks.ts

export interface TaskDetail {
  id: string
  title: string  // 任务标题（从 Task 表关联获取）
  status: string
  // ...
}
```

### 修复 5：execute API 竞态条件处理 ✅

```typescript
// packages/core/src/routes/tasks.mts

if (execution.status !== 'pending') {
  // 任务已经在执行中，返回成功（避免竞态条件导致的报错）
  if (execution.status === 'running' || execution.status === 'waiting') {
    res.json({ ok: true, message: '任务已在执行中', status: execution.status });
    return;
  }
  res.status(400).json({ error: '只能执行 pending 状态的任务', current_status: execution.status });
  return;
}
```

## 涉及文件

| 文件 | 修改 |
|------|------|
| `packages/core/src/routes/tasks.mts` | 传入完整 task 对象 + 竞态条件处理 |
| `packages/core/src/graph/nodes/command-node.mts` | 创建 phase_instance 记录 |
| `packages/core/src/graph/conditions/default-conditions.mts` | 空状态防御处理 |
| `packages/core/src/graph/builder.mts` | 移除 command-node 的 db 参数 |
| `packages/dashboard/src/api/tasks.ts` | 补全 title 字段类型 |
| `packages/core/workflows/default-dev-flow.yaml` | test_check 条件边修复 |

## 参考

- 正确模式：`packages/core/src/graph/worker-graph.mts:139-144`
- 正确模式：`packages/core/src/routes/requirements.mts:421-426`
- 调试脚本：`scripts/debug-flow.mjs`

## 提交

- `86e8c80` fix: 修复任务执行流程 - 传参错误 + command-node 不记录 + 条件函数空状态
- `6c104c9` fix: 修复 test_check 无条件边
- `52b69bc` fix: execute API 处理任务已在运行的情况
