# 璇玑 V4 执行状态机

> 文档日期：2026-09-10  
> 适用范围：`task_executions` 表（需求执行、任务执行）

---

## 1. 状态定义

| 状态 | 含义 | 允许转换 |
|---|---|---|
| **draft** | 草稿状态，未加入调度队列 | → pending（手动触发） |
| **pending** | 等待调度器拾取 | → running（调度器拾取）<br>→ cancelled（手动取消） |
| **running** | 正在执行 | → completed / failed / waiting / paused<br>→ rate_limited（429 限流） |
| **waiting** | 执行暂停，等待人类回答 inbox 问题 | → pending（所有问题已回答，自动恢复） |
| **paused** | 执行暂停，等待 gate 人工审核 | → running（审核通过，恢复执行） |
| **rate_limited** | 429 限流，等待退避重试 | → pending（退避到期，重新拾取） |
| **completed** | 执行成功完成 | （终态） |
| **failed** | 执行失败 | （终态） |
| **cancelled** | 执行被取消 | （终态） |

---

## 2. 状态转换图

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
┌─────┐    ┌─────────┐    ┌─────────┐    ┌─────────────┐  │
│draft│───▶│ pending │───▶│ running │───▶│  completed  │  │
└─────┘    └─────────┘    └─────────┘    └─────────────┘  │
                    │          │                            │
                    │          ├──────────────────────┐     │
                    │          │                      │     │
                    │          ▼                      ▼     │
                    │    ┌──────────┐          ┌─────────┐  │
                    │    │ waiting  │          │ failed  │  │
                    │    └──────────┘          └─────────┘  │
                    │          │                             │
                    │          │ (所有问题已回答)              │
                    │          └─────────────────────────────┘
                    │
                    │          ┌──────────┐
                    │          │  paused  │ (gate 审核)
                    │          └──────────┘
                    │                │
                    │                │ (审核通过)
                    │                └──────────────┐
                    │                               │
                    │          ┌──────────────────┐ │
                    │          │  rate_limited    │ │
                    │          └──────────────────┘ │
                    │                    │          │
                    │                    │ (退避到期) │
                    └────────────────────┴──────────┘
```

---

## 3. 状态转换触发条件

### 3.1 draft → pending

**触发方式**：
- 用户在 Dashboard 手动触发：`POST /api/tasks/:id/execute`
- 用户在 Dashboard 批量确认：`POST /api/requirements/:id/confirm-all-tasks`

**触发条件**：
- 当前状态为 `draft`
- 用户有权限触发

**代码位置**：
- `routes/tasks.mts:213-225`
- `routes/requirements.mts:411-432`

---

### 3.2 pending → running

**触发方式**：
- 调度器自动拾取（`scheduler-controller.mts`）

**触发条件**：
- 当前状态为 `pending`
- `retry_at` 为空或已过期
- 当前运行数 < `MAX_CONCURRENT_EXECUTIONS`

**代码位置**：
- `scheduler-controller.mts:107-127`
- `graph-runner.mts:121-126`（acquireLease）

---

### 3.3 running → waiting

**触发方式**：
- Agent 执行完成后检查 inbox 问题（`graph-runner.mts:215-224`）

**触发条件**：
- Agent 执行完成（`graph.invoke` 返回）
- 存在 `status='pending'` 的 inbox 问题

**代码位置**：
- `graph-runner.mts:215-224`

---

### 3.4 waiting → pending（自动恢复）

**触发方式**：
- `recovery-graph` 定时检查（每 5 分钟）

**触发条件**：
- 当前状态为 `waiting`
- 所有 inbox 问题都已回答（`pending` 数量 = 0）

**代码位置**：
- `recovery-graph.mts:recoverWaitingNode`

---

### 3.5 running → rate_limited

**触发方式**：
- Agent 执行过程中遇到 429 错误

**触发条件**：
- 错误消息包含 `429` / `rate_limit` / `throttl` 等关键字
- 重试次数未超过 `MAX_RATE_LIMIT_RETRIES`（默认 4 次）

**代码位置**：
- `worker-graph.mts:344-379`

---

### 3.6 rate_limited → pending

**触发方式**：
- 调度器自动拾取（退避到期后）

**触发条件**：
- 当前状态为 `rate_limited`
- `retry_at` 已过期

**退避策略**：
- 第 1 次：5 分钟
- 第 2 次：10 分钟
- 第 3 次：30 分钟
- 第 4 次：60 分钟

**代码位置**：
- `timing-constants.mts:computeRateLimitBackoff`

---

### 3.7 running → paused

**触发方式**：
- Gate 节点中断（`GraphInterrupt`）

**触发条件**：
- 流程图包含 gate 节点
- Gate 条件不满足，抛出 `GraphInterrupt`

**代码位置**：
- `graph-runner.mts:228-253`

---

### 3.8 paused → running

**触发方式**：
- 用户在 Dashboard 审核通过：`POST /api/executions/:id/resume`

**触发条件**：
- 当前状态为 `paused`
- 用户决策：`approve` / `reject`

**代码位置**：
- `graph-runner.mts:resumeExecution`

---

### 3.9 running → completed

**触发方式**：
- Agent 执行成功完成

**触发条件**：
- `graph.invoke` 正常返回
- 无 pending inbox 问题

**代码位置**：
- `graph-runner.mts:208-224`

---

### 3.10 running → failed

**触发方式**：
- Agent 执行失败
- 用户手动取消

**触发条件**：
- `graph.invoke` 抛出异常
- 或 `control_status = 'cancel_requested'`

**代码位置**：
- `graph-runner.mts:226-257`

---

## 4. 并发控制

### 4.1 并发配置

通过环境变量 `MAX_CONCURRENT_EXECUTIONS` 配置：

```bash
# 默认并发 1（串行执行）
node dist/index.mjs

# 并发 2（同时执行 2 个任务）
MAX_CONCURRENT_EXECUTIONS=2 node dist/index.mjs
```

### 4.2 Worker Pool 架构

调度器维护 `currentRunning: Set<executionId>`：

```typescript
while (schedulerRunning) {
  if (currentRunning.size < MAX_CONCURRENT) {
    const pending = pickPendingTask();
    if (pending) {
      currentRunning.add(pending.execution_id);
      executeTask(pending).finally(() => {
        currentRunning.delete(pending.execution_id);
      });
    }
  }
  await sleep(5000);
}
```

### 4.3 租约机制（CAS）

通过 `acquireLease` 实现原子抢占：

```sql
UPDATE task_executions
SET worker_id = $1,
    lease_token = $2,
    heartbeat_at = NOW(),
    status = 'running',
    started_at = NOW()
WHERE execution_id = $3
  AND status = 'pending'
  AND worker_id IS NULL
RETURNING *;
```

**代码位置**：
- `execution-store.mts:acquireLease`

---

## 5. 僵尸检测与恢复

### 5.1 僵尸定义

`status = 'running'` 且满足以下任一条件：
- `heartbeat_at < now() - 10 minutes`
- `heartbeat_at IS NULL AND started_at < now() - 10 minutes`

### 5.2 僵尸清理

`recovery-graph` 每 5 分钟检测一次：

1. 查找僵尸执行
2. 强制释放租约（`forceReleaseZombie`）
3. 重置状态为 `pending`
4. 写入审计事件（`zombie_cleaned`）

**代码位置**：
- `recovery-graph.mts:cleanupZombiesNode`

---

## 6. 审计事件

所有状态转换写入 `execution_events` 表：

| event_type | from_status | to_status | 说明 |
|---|---|---|---|
| `zombie_cleaned` | running | pending | 僵尸执行被清理 |
| `waiting_recovered` | waiting | pending | waiting 执行被恢复 |

**代码位置**：
- `recovery-graph.mts`

---

## 7. API 参考

### 7.1 调度器控制

```bash
# 查询状态
GET /api/scheduler/status
# 返回：{ running, startedAt, maxConcurrent, currentRunningCount, currentRunning }

# 停止调度器
POST /api/scheduler/stop

# 启动调度器
POST /api/scheduler/start
```

### 7.2 任务执行

```bash
# 手动触发任务执行（draft → pending）
POST /api/tasks/:id/execute

# 批量确认需求下所有任务（draft → pending）
POST /api/requirements/:id/confirm-all-tasks

# 恢复 paused 执行（paused → running）
POST /api/executions/:id/resume
```

---

## 8. 常见问题

### Q1: 任务卡在 pending 不动？

**可能原因**：
1. 调度器已停止
2. 当前运行数已达上限
3. `retry_at` 未到期（限流重试）

**排查方法**：
```bash
curl http://localhost:3000/api/scheduler/status
# 检查 running / currentRunningCount / maxConcurrent
```

### Q2: 任务卡在 waiting 不动？

**可能原因**：
1. 有 pending 的 inbox 问题未回答
2. `recovery-graph` 未检测到（5 分钟间隔）

**排查方法**：
```sql
SELECT * FROM inbox_questions
WHERE execution_id = 'xxx' AND status = 'pending';
```

### Q3: 任务卡在 running 但无进程？

**可能原因**：
1. 僵尸执行（进程被 kill）
2. `heartbeat_at` 未更新

**排查方法**：
```sql
SELECT execution_id, status, heartbeat_at, started_at
FROM task_executions
WHERE status = 'running'
ORDER BY heartbeat_at NULLS FIRST;
```

---

## 9. 参考文档

- `CLAUDE.md` — 项目设计目标
- `docs/bugfix/concurrency-and-zombie-issues.md` — 并发控制与僵尸问题修复
- `docs/superpowers/specs/2026-09-07-xuanji-v4-design.md` — V4 架构设计

---

**文档结束**
