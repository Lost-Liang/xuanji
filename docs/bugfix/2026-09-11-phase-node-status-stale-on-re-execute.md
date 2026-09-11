# 重新执行任务时画布节点状态残留旧失败信息

## 问题描述

当 Execution 在某个阶段（如 write_tests）失败后，用户重新执行该 Execution，画布上的阶段节点仍然显示"失败"，而不是"执行中"。

**影响：**
- 用户无法通过画布判断当前执行的真实进度
- 画布状态与右侧实时信息流不同步

## 根因分析

三个层面的问题共同导致该 bug：

### 根因 1：Execute API 不允许 failed→pending

`packages/core/src/routes/tasks.mts` — `POST /api/tasks/:id/execute`

```
draft → pending    ✓
pending → pending  ✓
running/waiting    ✓
failed/completed   ❌ 返回 400
```

用户点击"执行"时 API 直接返回 400，状态转换未生效。旧 `error_message` 和 `completed_at` 也不会清除。

### 根因 2：Agent 节点复用旧 phase_instance 不重置状态

`packages/core/src/graph/agent-node.mts` — phase_instance 复用逻辑

```typescript
const existing = await db.phase_instances.findFirst({
  where: { execution_id: execId, phase_id: opts.nodeId, attempt: iteration + 1 },
});
if (existing) {
  // 直接复用，status='failed' 保留不变 ❌
  phaseInstance = { id: existing.id, sessionId: existing.session_id };
}
```

即使 Execution 被重新执行，Agent 节点找到上次失败的 phase_instance（attempt 1, status='failed'）后直接复用，**不会重置状态**。画布通过 `/api/executions/:id` 轮询时，`phase_nodes` 中 write_tests 始终返回 'failed'。

### 根因 3：phase_nodes 聚合未按 attempt 排序

`packages/core/src/routes/executions.mts` — `toExecutionListItem`

```typescript
const phases = await db.phase_instances.findMany({
  where: { execution_id: e.execution_id },
  // 无 orderBy，无法保证最新 attempt 覆盖旧状态
  select: { phase_id: true, status: true },
});
phaseNodes = phases.reduce((acc, p) => {
  acc[p.phase_id] = p.status;  // 后遍历到的覆盖前面的
  return acc;
}, {});
```

没有 `orderBy` 排序，如果同一个 phase 有多个 attempt，reduce 无法保证取到最新一次的状态。

## 修复方案

### 修复 1：Execute API 允许终态→pending

**文件：** `packages/core/src/routes/tasks.mts`

将原来返回 400 的分支改为：

```typescript
// failed/completed/cancelled → 重置为 pending，允许重新执行
// 同时清空旧的 phase_instances，避免画布显示旧的失败状态
await db.phase_instances.deleteMany({
  where: { execution_id },
});
await db.task_executions.update({
  where: { execution_id },
  data: {
    status: 'pending',
    error_message: null,
    completed_at: null,
    stage: 'planning',
  },
});
res.json({
  ok: true,
  message: '任务已重置并加入调度队列',
  status: 'pending',
});
```

**效果：** failed/completed/cancelled 状态的 Execution 可以通过点击"执行"重新加入调度队列，旧 phase_instances 被清除，画布不再显示旧失败状态。

### 修复 2：复用旧 phase_instance 时重置状态

**文件：** `packages/core/src/graph/agent-node.mts`

在复用旧 phase_instance 逻辑中增加状态重置：

```typescript
if (existing) {
  // 复用旧 phase_instance 时，如果状态是终态（failed/completed），重置为 running
  if (existing.status === 'failed' || existing.status === 'completed') {
    await db.phase_instances.update({
      where: { id: existing.id },
      data: {
        status: 'running',
        error_message: null,
        completed_at: null,
        started_at: new Date(),
      },
    });
  }
  phaseInstance = { id: existing.id, sessionId: existing.session_id };
}
```

**效果：** 当 Agent 节点开始执行时，如果复用了旧的 phase_instance，会在执行前将状态重置为 running。画布轮询时立即看到"执行中"，而不是 wait 到执行完成才更新。

### 修复 3：phase_nodes 聚合按 attempt 降序取最新值

**文件：** `packages/core/src/routes/executions.mts`

```typescript
const phases = await db.phase_instances.findMany({
  where: { execution_id: e.execution_id },
  orderBy: { attempt: 'desc' },         // 最新 attempt 排前面
  select: { phase_id: true, status: true },
});
// 每个 phase_id 只取第一次（最新）出现的状态
const seen = new Set<string>();
for (const p of phases) {
  if (!seen.has(p.phase_id)) {
    phaseNodes[p.phase_id] = p.status;
    seen.add(p.phase_id);
  }
}
```

**效果：** 即使旧 phase_instances 未被清理（如通过调度器直接拾取），API 返回的 phase_nodes 也只包含最新 attempt 的状态，不会用旧 attempt 覆盖新状态。

## 修复验证

1. 将 failed Execution 恢复为 pending：`curl -X POST /api/tasks/:id/execute` → 返回 `status: 'pending'`
2. 查看画布：`GET /api/executions/:id` → `phase_nodes` 应为 `{}`（phase_instances 已清理）
3. Agent 开始执行后：`GET /api/executions/:id` → `phase_nodes` 应为 `{ write_tests: 'running' }`
4. 画布节点显示"执行中"而非"失败"