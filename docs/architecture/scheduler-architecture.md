# 璇玑 V4 调度器架构文档

> 最后更新：2026-09-15  
> 状态：稳定

## 一、架构概览

### 1.1 调度层级

```
API 层 (requirements.mts, tasks.mts)
    ↓ 设置 status='pending'
scheduler-graph (轮询发现待执行任务)
    ↓ 触发 worker
worker-graph (获取租约 + 路由)
    ↓ 传递 lease
graphRunner (接收 lease + 执行工作流 + 心跳)
    ↓ 调用
Runner (Claude Code / Codex CLI)
```

### 1.2 关键设计原则

| 原则 | 说明 |
|------|------|
| **统一入口** | 所有执行都设置 status='pending'，由调度器统一分发 |
| **租约传递** | worker 获取租约后传递给 graphRunner（不重复获取） |
| **单一心跳** | 只在 graphRunner 中维护心跳循环（5 秒间隔） |
| **原子性** | 租约获取使用 CAS（Compare-And-Set）保证原子性 |
| **隔离性** | 每个任务在独立的 git worktree 中执行 |

## 二、核心组件

### 2.1 scheduler-graph

**文件**：`packages/core/src/graph/scheduler-graph.mts`

**职责**：
- 轮询发现 status='pending' 的任务执行
- 检查并发限制（max_concurrent_tasks）
- 触发 worker-graph 执行

**核心逻辑**：
```typescript
async function schedulerNode(state: SchedulerState) {
  // 1. 获取当前运行数
  const runningCount = await executionStore.countRunning(requirementId);
  
  // 2. 检查并发限制
  if (runningCount >= requirement.maxConcurrentTasks) {
    return { action: 'wait' };
  }
  
  // 3. 查找待执行任务
  const pendingExec = await executionStore.findPendingExecution(requirementId);
  
  if (pendingExec) {
    return { action: 'schedule', executionId: pendingExec.id };
  }
  
  return { action: 'wait' };
}
```

**工作流程**：
```
start → scheduler → [wait 或 schedule]
  ↓ wait                ↓ schedule
  ↓                     ↓
  └─(等待)             worker
```

### 2.2 worker-graph

**文件**：`packages/core/src/graph/worker-graph.mts`

**职责**：
- 获取任务租约（CAS 原子操作）
- 根据执行类型路由到不同的工作流
- 传递租约给 graphRunner

**核心逻辑**：
```typescript
async function workerNode(state: WorkerState) {
  const { executionId } = state;
  
  // 1. 获取租约（原子操作）
  const lease = await executionStore.acquireLease(executionId, WORKER_ID);
  
  if (!lease) {
    return { status: 'lease_failed' };
  }
  
  // 2. 读取执行实例
  const execution = await executionStore.getById(executionId);
  
  // 3. 路由到对应的工作流
  const graphDefId = execution.graphDefinitionId;
  const graphDef = await graphDefStore.getById(graphDefId);
  
  // 4. 传递租约给 graphRunner
  const result = await graphRunner.startExecution({
    executionId,
    graphDefinition: graphDef,
    lease,  // ← 关键：传递租约，不再自己获取
  });
  
  return { status: 'completed', result };
}
```

### 2.3 graphRunner

**文件**：`packages/core/src/graph/graph-runner.mts`

**职责**：
- 接收租约（不再自己获取）
- 构建并执行 LangGraph 工作流
- 维护心跳循环（每 5 秒刷新租约）
- 处理进程管理（暂停/恢复/取消）

**核心逻辑**：
```typescript
async function startExecution(options: {
  executionId: string;
  graphDefinition: GraphDefinition;
  lease: LeaseInfo;  // ← 接收租约参数
}) {
  const { executionId, graphDefinition, lease } = options;
  
  // 1. 设置租约（不再自己获取）
  currentLease = lease;
  
  // 2. 启动心跳循环
  startHeartbeat(executionId);
  
  // 3. 构建工作流
  const graph = await buildGraphFromDefinition(graphDefinition);
  
  // 4. 执行工作流
  const result = await graph.invoke(initialState, {
    configurable: { thread_id: executionId }
  });
  
  // 5. 停止心跳
  stopHeartbeat();
  
  // 6. 释放租约
  await executionStore.releaseLeaseKeepStatus(executionId);
  
  return result;
}

function startHeartbeat(executionId: string) {
  heartbeatTimer = setInterval(async () => {
    // 1. 检查进程管理状态
    const execution = await executionStore.getById(executionId);
    if (execution.controlStatus === 'pause_requested') {
      // 暂停逻辑
    }
    
    // 2. 刷新租约
    await executionStore.refreshLease(executionId, WORKER_ID);
  }, HEARTBEAT_INTERVAL_MS);
}
```

### 2.4 租约机制

**表结构**：
```sql
CREATE TABLE task_executions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,  -- 'pending', 'running', 'completed', 'failed'
  lease_holder TEXT,     -- worker ID
  lease_acquired_at TIMESTAMP,
  lease_expires_at TIMESTAMP,
  control_status TEXT    -- 'none', 'pause_requested', 'paused', 'resume_requested', 'cancel_requested'
);
```

**获取租约（CAS）**：
```typescript
async function acquireLease(executionId: string, workerId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  
  // 原子更新：只有 status='pending' 时才能获取
  const result = await prisma.taskExecution.updateMany({
    where: {
      id: executionId,
      status: 'pending',  // ← CAS 条件
    },
    data: {
      status: 'running',
      leaseHolder: workerId,
      leaseAcquiredAt: now,
      leaseExpiresAt: expiresAt,
    },
  });
  
  return result.count > 0 ? { workerId, expiresAt } : null;
}
```

**刷新租约**：
```typescript
async function refreshLease(executionId: string, workerId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  
  await prisma.taskExecution.update({
    where: {
      id: executionId,
      leaseHolder: workerId,  // 验证持有者
    },
    data: {
      leaseExpiresAt: expiresAt,
    },
  });
}
```

## 三、执行流程

### 3.1 任务执行完整流程

```
1. 用户调用 API
   POST /api/tasks/:id/execute
   
2. API 层设置状态
   executionStore.updateStatus(execId, 'pending')
   
3. scheduler-graph 发现任务
   - 每次轮询检查 countRunning < maxConcurrent
   - 找到 status='pending' 的执行
   - 返回 { action: 'schedule', executionId }
   
4. worker-graph 获取租约
   - lease = acquireLease(executionId, workerId)
   - 租约获取成功，status → 'running'
   
5. worker-graph 传递租约给 graphRunner
   - graphRunner.startExecution({ executionId, graphDef, lease })
   
6. graphRunner 执行工作流
   - 启动心跳循环（每 5 秒）
   - 构建 LangGraph 并执行
   - 处理 interrupt（人机交互）
   - 监控 controlStatus（暂停/取消）
   
7. 执行完成
   - 停止心跳循环
   - releaseLeaseKeepStatus(executionId)
   - 返回结果给 worker
   
8. worker 返回给 scheduler
   - scheduler 继续轮询下一个任务
```

### 3.2 需求执行流程（树形拆解）

```
1. POST /api/requirements/:id/execute
   - 创建或更新执行实例，设置 status='pending'
   
2. scheduler-graph 发现需求执行
   - 找到 taskableType='Requirement' 的待执行实例
   
3. worker-graph 获取租约并执行
   - graphDefId = 'requirement-decomposition'
   - 传递租约给 graphRunner
   
4. graphRunner 执行需求拆解工作流
   - 调用 Agent 生成 Epic/Feature/UserStory/Task
   - 拆解结果保存到数据库
   
5. Epic/Feature/UserStory 自动触发
   - 每个子任务创建执行实例，status='pending'
   - 回到步骤 2（scheduler 发现并调度）
   
6. 最终所有 Task 执行完成
   - 需求执行状态更新为 'completed'
```

## 四、已修复的架构问题（2026-09-15）

### 4.1 问题 1：双重租约死锁 ⚠️

**症状**：所有任务执行卡住，日志显示"获取租约失败"

**根因**：
- worker-graph 获取租约后，status → 'running'
- graphRunner 再次尝试 acquireLease，但 CAS 条件 status='pending' 不满足
- 租约获取失败，任务无法执行

**修复**（Commit 88d7e81, 4c1faa6）：
- graphRunner.startExecution 接收 `lease` 参数
- worker-graph 传递租约给 graphRunner
- 移除 graphRunner 内部的 acquireLease 调用

### 4.2 问题 2：需求执行绕过调度器

**症状**：并发控制失效，max_concurrent_tasks 不生效

**根因**：
- `POST /api/requirements/:id/execute` 直接调用 graphRunner
- 绕过 scheduler-graph 的并发检查
- 租约机制完全失效

**修复**（Commit c5fb4fb, 6a7bc3d）：
- requirements.mts executeRequirement 改为设置 status='pending'
- 统一走调度器
- 首次执行自动创建执行实例（修复 404）

### 4.3 问题 3：心跳逻辑重复

**症状**：每 5 秒查询 DB 两次，资源浪费

**根因**：
- worker-graph 有一个心跳定时器
- graphRunner 也有一个心跳定时器
- 两个 AbortController，逻辑重复

**修复**（Commit 1b4767c）：
- 移除 worker-graph 的心跳循环（-105 行）
- 只保留 graphRunner 的心跳逻辑
- DB 查询压力减半

### 4.4 问题 4：死代码堆积

**症状**：worker-graph 保留了 209 行旧执行逻辑

**根因**：
- M2.2 修改后，任务执行改为调用 graphRunner
- 但没有移除 worker 的旧执行逻辑
- 导致代码难以维护

**修复**（Commit 1b4767c）：
- 移除所有死代码和无用导入
- 清理注释和 TODO
- 代码量减少 314 行

## 五、延迟修复项（非阻塞）

### 5.1 调度层级重构（P1）

**问题**：scheduler/worker/graphRunner 三层职责不清

**建议**：
- 方案 B（单一调度层）：合并 scheduler + worker
- 预计工作量：2-3 天
- 收益：代码更简洁，职责更清晰

### 5.2 状态机一致性验证（P2）

**问题**：多处直接修改状态，缺少统一验证

**建议**：
- 建立状态机图（pending → running → completed/failed）
- 所有状态转换经过 executionStore 的验证方法
- 预计工作量：4 小时

### 5.3 requirements.status 同步（P3）

**问题**：requirements.status 不同步到执行实例的 status

**影响**：前端不依赖此字段，低优先级

## 六、参考文档

- 问题诊断：`docs/superpowers/specs/2026-09-15-scheduler-architecture-fix.md`
- 实施计划：`docs/superpowers/plans/2026-09-15-scheduler-architecture-fix.md`
- V4 架构设计：`docs/superpowers/specs/2026-09-07-xuanji-v4-design.md`
- 架构问题分析：`docs/superpowers/specs/2026-09-09-xuanji-architectural-issues.md`
