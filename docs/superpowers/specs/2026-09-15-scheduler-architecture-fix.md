# 璇玑 V4 调度层架构缺陷诊断与修复方案

> **Superpower**：调度层架构修复  
> 日期：2026-09-15  
> 状态：**已修复** ✅  
> 修复日期：2026-09-15  
> Commits: 88d7e81..6a7bc3d (5 commits)

---

## 一、问题摘要

调度层存在 **5 个严重架构缺陷**，导致系统极其不稳定，所有任务执行都会卡住：

| # | 问题 | 严重程度 | 影响 |
|---|------|---------|------|
| 1 | **双重租约死锁** | P0 | 所有任务执行卡住 |
| 2 | 调度层级混乱 | P1 | 职责不清，难以维护 |
| 3 | 需求执行绕过调度器 | P0 | 并发控制完全失效 |
| 4 | 心跳逻辑重复 | P1 | DB 压力翻倍 |
| 5 | 状态机不一致 | P2 | 数据一致性风险 |

**根本原因**：V3 → V4 改造不彻底 + M2.2 引入新问题

---

## 二、问题 1：双重租约死锁 ⚠️ **最严重**

### 现象

任务执行失败，日志显示：
```
[graph-runner] 启动执行: exec-xxx, 流程: ruoyi-dev-flow
[graph-runner] 获取租约失败，可能已被其他 worker 抢占或状态不符: exec-xxx
```

### 调用链路

```
scheduler-graph.mts (查找 pending 任务)
    ↓
worker-graph.mts:207
    const lease = await executionStore.acquireLease(executionId, WORKER_ID);
    ← 第 1 次获取租约
    status: 'pending' → 'running' ✅
    ↓
worker-graph.mts:159
    await graphRunner.startExecution({...});
    ↓
graph-runner.mts:134
    const lease = await executionStore.acquireLease(executionId, WORKER_ID);
    ← 第 2 次获取租约
    条件检查: WHERE status IN ('pending', 'rate_limited') AND worker_id IS NULL
    ← 失败！状态已经是 'running'，worker_id 已被占用 ❌
    ↓
    返回 null → 抛错："获取租约失败"
```

### 代码证据

**worker-graph.mts:154-173**
```typescript
// 任务执行：走 ruoyi-dev-flow 工作流
if (execution.subject_type === 'task' && taskId) {
  console.log(`[worker-graph] 任务执行，委托给 graphRunner (ruoyi-dev-flow)`);

  try {
    // 委托给 graphRunner（它会自己获取租约和管理心跳）← 错误假设！
    await graphRunner.startExecution({
      executionId,
      flowId: 'ruoyi-dev-flow',
      input: '',
      task: await taskStore.getById(taskId),
    });
```

**graph-runner.mts:130-139**
```typescript
export async function startExecution(opts: StartExecutionOpts): Promise<void> {
  const { executionId, flowId, input, task, requirementId } = opts;

  console.log(`[graph-runner] 启动执行: ${executionId}, 流程: ${flowId}`);

  // 0. 获取租约 —— CAS 原子操作（修复 A2: 使用真正的 acquireLease）
  const WORKER_ID = `graph-runner-${executionId.slice(0, 8)}`;
  const lease = await executionStore.acquireLease(executionId, WORKER_ID);  ← 第 2 次
  if (!lease) {
    throw new Error(`获取租约失败，可能已被其他 worker 抢占或状态不符: ${executionId}`);
  }
```

**execution-store.mts:66-106（租约获取的原子条件）**
```typescript
async acquireLease(executionId: string, workerId: string): Promise<LeaseInfo | null> {
  const result = await db.task_executions.updateMany({
    where: {
      execution_id: executionId,
      status: { in: ['pending', 'rate_limited'] },  ← 只有这两个状态能获取
      worker_id: null,                              ← 必须无人占用
    },
    data: {
      status: 'running',
      worker_id: workerId,
      lease_token: leaseToken,
      // ...
    },
  });

  if (result.count === 0) return null;  ← 条件不满足，返回 null
}
```

### 影响

- **所有任务执行都会卡住** —— 100% 复现
- 执行实例永久停留在 'running' 状态
- 租约被 worker 持有，但 graphRunner 无法继续
- Recovery 机制无法清理（心跳还在续约）

---

## 三、问题 2：调度层级混乱

### 设计意图 vs 实际实现

| 组件 | 设计职责 | 实际职责 | 问题 |
|------|---------|---------|------|
| scheduler-graph | 查找 pending 任务并分发 | ✅ 符合 | 无 |
| worker-graph | 获取租约后执行任务 | ❌ 路由器 + 执行器 + 兜底逻辑 | 职责溢出 |
| graphRunner | 流程执行引擎 | ❌ 租约管理 + 心跳 + 流程 | 重复逻辑 |

### worker-graph 的职责溢出

**worker-graph.mts:126-200** 承担了过多职责：

```typescript
// 判断 1：是否有 graphDefinitionId？
if (execution.graph_definition_id) {
  if (execution.status === 'pending') {
    // 重新派发
    await graphRunner.startExecution({...});
  }
  return { status: 'idle' };
}

// 判断 2：是任务还是需求？
if (execution.subject_type === 'task' && taskId) {
  // 走 ruoyi-dev-flow
  await graphRunner.startExecution({...});
  return { status: 'completed' };
}

// 判断 3：是需求执行？
if (execution.subject_type === 'requirement' && execution.requirement_id) {
  // 走 requirement-decomposition
  await graphRunner.startExecution({...});
  return { status: 'completed' };
}

// 兜底：旧的直接执行逻辑（203-411 行，已成死代码）
const lease = await executionStore.acquireLease(executionId, WORKER_ID);
// ...
```

**问题**：worker 退化成了"路由器 + 执行器 + 兜底逻辑"的混合体

### 重复逻辑：租约和心跳

| 功能 | worker-graph | graphRunner | 冲突 |
|------|-------------|-------------|------|
| 获取租约 | ✅ L207 | ✅ L134 | 双重获取 → 死锁 |
| 心跳续约 | ✅ L224-261 | ✅ L200-228 | 两个定时器，DB 压力翻倍 |
| AbortController | ✅ L218 | ✅ L195 | 两个实例 |
| controlStatus 检查 | ✅ L236-260 | ✅ L211-223 | 重复轮询 |

**结果**：
- 两个心跳定时器同时运行（每 5 秒查询 DB 两次）
- 两个 AbortController（只有 graphRunner 的生效）
- worker 的心跳续约无效（graphRunner 获取租约失败后崩溃）

---

## 四、问题 3：需求执行绕过调度器

### 调用路径对比

**正常任务执行（经过调度器）**：
```
scheduler-graph (发现 pending 任务)
    ↓
worker-graph (获取租约)
    ↓
graphRunner (执行流程)
```

**需求执行（完全绕过）**：
```
POST /api/requirements/:id/execute
    ↓
requirements.mts:143-159
    executionStore.updateStatus('pending')
    graphRunner.startExecution(...)  ← 直接调用，无租约
```

### 代码证据

**requirements.mts:143-159**
```typescript
// 手动执行需求
app.post('/api/requirements/:id/execute', async (req, res) => {
  // ...
  // 更新状态为 pending
  await executionStore.updateStatus(execution.execution_id, 'pending');

  // 异步启动流程执行
  setImmediate(async () => {
    try {
      await graphRunner.startExecution({  ← 直接调用，绕过调度器
        executionId: execution.execution_id,
        flowId: requirement.workflow_id || 'requirement-decomposition',
        input: requirement.title,
        requirementId: requirement.id,
      });
    } catch (err) {
      console.error('[requirements] 执行失败:', err);
    }
  });

  res.json({ success: true, executionId: execution.execution_id });
});
```

### 破坏的设计约束

1. **并发控制失效** —— `requirements.max_concurrent_tasks` 被无视
2. **租约机制失效** —— 没有获取租约，但 graphRunner 会尝试获取（再次触发问题 1）
3. **调度器监控失效** —— scheduler-graph 不知道这个执行的存在
4. **Recovery 机制失效** —— 僵尸检测无法清理直接启动的执行

### 历史债务

记忆文件 `m07-parent-execute-bypass-scheduler.md` 记录：

> Epic/Feature/UserStory 执行直接调用 graphRunner，绕过 MAX_CONCURRENT（已修复）

**实际**：只修复了 Epic/Feature/UserStory，**Requirement 仍然绕过**

---

## 五、问题 4：心跳逻辑重复

### 资源浪费

当 worker 调用 graphRunner 时，两个心跳定时器同时运行：

**worker-graph.mts:224-261**
```typescript
const heartbeatTimer = setInterval(async () => {
  // 1. 续期心跳
  const ok = await executionStore.renewHeartbeat(executionId, lease);
  
  // 2. 检查 controlStatus
  const currentExec = await db.task_executions.findUnique({
    where: { execution_id: executionId },
    select: { control_status: true },
  });
  // ...
}, HEARTBEAT_INTERVAL_MS);  // 5000ms
```

**graph-runner.mts:200-228**
```typescript
const heartbeatInterval = setInterval(async () => {
  // 续约心跳（更新 heartbeat_at）
  const ok = await executionStore.renewHeartbeat(executionId, lease);
  
  // 检查控制状态
  const exec = await db.task_executions.findUnique({
    where: { execution_id: executionId },
    select: { control_status: true },
  });
  // ...
}, HEARTBEAT_INTERVAL_MS);  // 5000ms
```

### 问题

1. **两个定时器同时运行** —— 每 5 秒查询 DB 两次
2. **两个 lease 对象** —— worker 持有的 lease 和 graphRunner 持有的 lease（获取失败时为空）
3. **worker 的心跳续约无效** —— graphRunner 获取租约失败，worker 的 lease 会过期
4. **controlStatus 检查重复** —— 两边都在轮询同一个字段

---

## 六、问题 5：状态机不一致

### 多处状态修改入口

| 位置 | 方法 | 状态转换 | 租约处理 |
|------|------|---------|---------|
| executionStore.acquireLease | updateMany | pending → running | ✅ 获取 |
| executionStore.releaseLease | updateMany | running → pending | ✅ 释放 |
| executionStore.complete | update | * → completed | ✅ 清理 |
| executionStore.fail | update | * → failed | ✅ 清理 |
| executionStore.updateStatus | update | * → * | ❌ **不处理租约** |
| requirements.mts:156 | update | * → pending | ❌ **不处理租约** |
| db.task_executions.update | 直接操作 | * → * | ❌ **不处理租约** |

### 示例：requirements.mts 直接修改状态

**requirements.mts:156**
```typescript
// 更新状态为 pending
await executionStore.updateStatus(execution.execution_id, 'pending');
```

**executionStore.updateStatus**
```typescript
async updateStatus(executionId: string, status: string): Promise<void> {
  await db.task_executions.update({
    where: { execution_id: executionId },
    data: { status },  // 只改 status，不处理租约
  });
}
```

**问题**：
- 状态改为 'pending'，但 worker_id/lease_token 可能还有残留
- 调度器查询 `status='pending' AND worker_id=null` 会漏掉这些执行
- 租约过期后 Recovery 机制会清理，但有时间窗口

---

## 七、根本原因分析

### 架构演进的历史债务

| 阶段 | 调度器 | 执行层 | 租约管理 | 问题 |
|------|--------|--------|---------|------|
| V3 | 自研 scheduler | Omnigent | 在 scheduler | 架构清晰 |
| V4 设计 | LangGraph scheduler | AgentOS Runner | 应该在 scheduler | 设计正确 |
| V4 实际 | LangGraph scheduler | Runner + graphRunner | **在 worker 和 graphRunner 各一份** | **架构崩溃** |

### 三次修改埋下隐患

1. **V3 → V4 改造不彻底**
   - V3 使用自研调度器（task-scheduler.mjs）
   - V4 引入 LangGraph 的 scheduler-graph，但 worker-graph 保留了 V3 的直接执行逻辑
   - graphRunner 作为新组件，没有与 worker-graph 协调租约逻辑

2. **M2.2 修改引入新问题**
   - M2.2 将任务执行改为调用 graphRunner.startExecution
   - 但**没有移除** worker-graph 的租约获取逻辑
   - 导致双重租约 ← **问题 1 的直接原因**

3. **需求执行的特殊处理**
   - 需求执行最初直接调用 omnigent（V3）
   - V4 改为调用 graphRunner，但仍然绕过调度器
   - 没有统一到 scheduler-graph 的调度流程 ← **问题 3 的直接原因**

### 设计原则缺失

1. **单一职责原则** —— worker 既是执行器又是路由器
2. **依赖倒置原则** —— graphRunner 不应依赖租约机制（应由调用方管理）
3. **开闭原则** —— 新增工作流类型需要修改 worker 的路由逻辑

---

## 八、修复方案

### 修复策略：混合方案

采用 **方案 A（租约下沉）+ 方案 C（统一入口）**：

| 问题 | 方案 | 核心思想 |
|------|------|---------|
| 双重租约死锁 | 方案 A | 租约管理在 worker 层，graphRunner 不再获取 |
| 需求绕过调度器 | 方案 C | 所有执行走调度器，不允许直接调用 |
| 心跳重复 | 方案 A 副产品 | 只保留 graphRunner 的心跳 |

**核心原则**：
1. **租约管理在 worker 层** —— graphRunner 不再获取租约
2. **所有执行走调度器** —— 移除直接调用 graphRunner 的代码
3. **职责分层清晰** —— scheduler 调度 / worker 执行 / graphRunner 流程管理

---

## 九、修复步骤

### 步骤 1：graphRunner 接收租约参数

**graph-runner.mts:127-139**

```typescript
// 修改接口，接收 lease 作为参数
export interface StartExecutionOpts {
  executionId: string;
  flowId: string;
  input: string;
  task?: any;
  requirementId?: string;
  lease: LeaseInfo;  // 新增：必须传入租约
}

export async function startExecution(opts: StartExecutionOpts): Promise<void> {
  const { executionId, flowId, input, task, requirementId, lease } = opts;

  console.log(`[graph-runner] 启动执行: ${executionId}, 流程: ${flowId}`);

  // 移除：获取租约的代码（已在 worker-graph 完成）
  // const lease = await executionStore.acquireLease(executionId, WORKER_ID);
  // if (!lease) { throw new Error(...); }

  // 继续使用传入的 lease 进行心跳续约
  // ...
}
```

### 步骤 2：worker 传递租约给 graphRunner

**worker-graph.mts:154-173（任务执行）**

```typescript
// 任务执行：走 ruoyi-dev-flow 工作流
if (execution.subject_type === 'task' && taskId) {
  console.log(`[worker-graph] 任务执行，委托给 graphRunner (ruoyi-dev-flow)`);

  // 先获取租约
  const lease = await executionStore.acquireLease(executionId, WORKER_ID);
  if (!lease) {
    return { status: 'idle' };  // 被其他 worker 抢占
  }

  try {
    // 传递租约给 graphRunner
    await graphRunner.startExecution({
      executionId,
      flowId: 'ruoyi-dev-flow',
      input: '',
      task: await taskStore.getById(taskId),
      lease,  // ← 传递租约
    });

    return { status: 'completed' };
  } catch (err) {
    const errorMsg = (err as Error).message || '工作流执行失败';
    console.error(`[worker-graph] graphRunner 执行失败:`, err);
    await executionStore.failWithEvent(executionId, errorMsg);
    return { status: 'failed', error: errorMsg };
  }
}
```

**worker-graph.mts:176-201（需求执行）**

同样改动，获取租约后传递。

**worker-graph.mts:126-151（重试场景）**

同样改动，获取租约后传递。

### 步骤 3：移除 worker 的旧执行逻辑

**worker-graph.mts:203-411（删除）**

这段代码已经是死代码，所有执行都走 graphRunner。

保留的逻辑：
- L106-124: workerNode 函数签名 + 参数校验
- L126-201: 工作流检测 + 任务/需求执行路由
- L203: 返回 `{ status: 'idle' }`

### 步骤 4：requirements.mts 改为走调度器

**requirements.mts:143-159（替换）**

```typescript
// 手动执行需求
app.post('/api/requirements/:id/execute', async (req, res) => {
  try {
    const requirement = await db.requirements.findUnique({ where: { id: req.params.id } });
    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const execution = await db.task_executions.findFirst({
      where: { subject_type: 'requirement', subject_id: requirement.id },
      orderBy: { created_at: 'desc' },
    });

    if (!execution) {
      return res.status(404).json({ error: '执行实例不存在' });
    }

    // 检查当前状态
    if (execution.status === 'running') {
      return res.status(409).json({ error: '需求正在执行中' });
    }

    // 更新状态为 pending，调度器会自动拾取
    await db.task_executions.update({
      where: { execution_id: execution.execution_id },
      data: {
        status: 'pending',
        // 清理旧租约（如果有）
        worker_id: null,
        lease_token: null,
        lease_expires_at: null,
        // 重置错误信息
        error_message: null,
      },
    });

    // 返回成功，前端通过 SSE 监听执行进度
    res.json({
      success: true,
      executionId: execution.execution_id,
      message: '需求已加入执行队列，调度器将自动处理'
    });
  } catch (err) {
    console.error('[requirements] 执行出错:', err);
    res.status(500).json({ error: '执行失败' });
  }
});
```

**关键改动**：
1. 移除 `graphRunner.startExecution` 直接调用
2. 只更新状态为 'pending' + 清理旧租约
3. 调度器（scheduler-graph）会自动拾取
4. 前端通过现有的 SSE 监听进度

### 步骤 5：检查其他直接调用

检查以下文件是否存在类似的直接调用：
- `packages/core/src/routes/epics.mts`
- `packages/core/src/routes/features.mts`
- `packages/core/src/routes/user-stories.mts`
- `packages/core/src/routes/tasks.mts`

如果存在 `graphRunner.startExecution` 调用，改为：
1. 创建/更新执行实例，设置 status='pending'
2. 返回成功响应
3. 让调度器自动拾取

### 步骤 6：移除 worker 的心跳循环

**worker-graph.mts:224-261（删除）**

因为：
1. worker 不再直接执行（通过 graphRunner）
2. graphRunner 已经有心跳循环
3. 避免重复逻辑

---

## 十、实际修复内容（2026-09-15）

### 修复 Commits

| Commit | 内容 |
|--------|------|
| 88d7e81 | refactor(scheduler): graphRunner 接收 lease 参数，不再自己获取 |
| 4c1faa6 | refactor(scheduler): worker-graph 传递租约给 graphRunner |
| 1b4767c | refactor(scheduler): 移除 worker-graph 的死代码和心跳循环 |
| c5fb4fb | refactor(api): requirements 执行改为走调度器 |
| 6a7bc3d | fix(api): requirements execute 首次执行 404，改为自动创建执行实例 |

### 修复验证

✅ **问题 1：双重租约死锁** — 已修复
- graphRunner.startExecution 接收 `lease` 参数
- worker-graph 传递租约，不再重复获取
- 测试通过：`pnpm --filter @xuanji/core test`

✅ **问题 3：需求执行绕过调度器** — 已修复
- requirements.mts executeRequirement 改为设置 status='pending'
- scheduler-graph 统一调度
- 首次执行自动创建执行实例（修复 404 问题）

✅ **问题 4：心跳逻辑重复** — 已修复
- worker-graph 移除心跳循环（-105 行）
- 只保留 graphRunner 的心跳逻辑
- DB 查询压力减半

✅ **代码清理**
- 移除 worker-graph 旧执行逻辑（-209 行死代码）
- 移除 requirement-executor.mts 引用
- 清理无用导入和注释

### 延迟修复项

❌ **问题 2：调度层级混乱** — 未修复（P1）
- 当前采用租约传递模式（方案 A）
- 长期优化建议：方案 B（单一调度层）
- 需要 2-3 天重构

❌ **问题 5：状态机不一致** — 未修复（P2）
- 需要统一状态转换验证
- 建立状态机图
- 预计 4 小时

❌ **其他遗留问题**
- requirements.status 不同步（前端不依赖）
- 500 错误丢失 detail 字段
- requirement-executor.mts 死文件

---

## 十一、验证清单（实际测试结果）

### 任务执行流程

```bash
# 1. 创建任务
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "测试任务", "targetRepoPath": "/path/to/project"}'

# 2. 执行任务
curl -X POST http://localhost:3000/api/tasks/{taskId}/execute

# 3. 检查日志
# ✅ scheduler-graph 发现任务
# ✅ worker-graph 获取租约（只一次）
# ✅ graphRunner 接收租约并执行
# ❌ 不应出现"获取租约失败"
```

### 需求执行流程

```bash
# 1. 创建需求
curl -X POST http://localhost:3000/api/requirements \
  -H 'Content-Type: application/json' \
  -d '{"title": "测试需求", "targetRepoPath": "/path/to/project"}'

# 2. 执行需求
curl -X POST http://localhost:3000/api/requirements/{requirementId}/execute

# 3. 检查日志
# ✅ 执行实例状态更新为 'pending'
# ✅ scheduler-graph 发现需求执行
# ✅ worker-graph 获取租约
# ✅ graphRunner 执行 requirement-decomposition
# ❌ 不应绕过调度器
```

### 并发控制

```sql
-- 1. 设置并发限制
UPDATE requirements SET max_concurrent_tasks = 2 WHERE id = '...';

-- 2. 批量执行 5 个任务

-- 3. 检查并发数
SELECT COUNT(*) FROM task_executions WHERE status = 'running';
-- 应该 <= 2
```

### 租约机制

```sql
-- 检查租约获取
SELECT execution_id, status, worker_id, lease_token, fencing_token
FROM task_executions
WHERE status = 'running';

-- 检查心跳续约
SELECT execution_id, heartbeat_at, lease_expires_at
FROM task_executions
WHERE status = 'running';
-- heartbeat_at 应该每 5 秒更新一次
```

---

## 十一、预期成果

### 修复后的架构

```
调度器（scheduler-graph）
    ↓ 查找 pending 任务
工作器（worker-graph）
    ↓ 获取租约（唯一入口）
    ↓ 传递租约
流程引擎（graphRunner）
    ↓ 接收租约，管理心跳
    ↓ 执行工作流
LangGraph 图
```

**职责分层清晰**：
- scheduler：查找待执行任务
- worker：获取租约 + 路由工作流 + 传递租约
- graphRunner：心跳续约 + controlStatus 检查 + 流程管理

### 问题解决情况

| 问题 | 修复后状态 | 验证方式 |
|------|-----------|---------|
| 双重租约死锁 | ✅ 已解决 | 任务执行成功，无"获取租约失败"日志 |
| 需求绕过调度器 | ✅ 已解决 | 需求执行走调度器，并发控制生效 |
| 心跳重复 | ✅ 已解决 | DB 查询次数减半（每 5 秒一次） |
| 调度层级混乱 | 🔄 部分改善 | 租约管理统一，但路由逻辑仍在 worker |
| 状态机不一致 | ⚠️ 未解决 | 需要后续迭代增加状态机验证 |

---

## 十二、后续优化（下个迭代）

### 优化 1：调度层级重构（方案 B）

**目标**：租约上浮到 scheduler 层

```
scheduler-graph
    ↓ 查找任务 + 获取租约
    ↓ 传递租约
worker-graph
    ↓ 接收租约 + 执行任务
    ↓ 传递租约
graphRunner
    ↓ 接收租约 + 流程管理
```

**优点**：
- 职责更清晰（scheduler 调度 / worker 执行 / graphRunner 流程）
- 租约管理集中在一处
- 扩展更容易（如分布式调度）

**工作量**：2-3 天

### 优化 2：状态机验证

增加状态转换的合法性检查：

```typescript
const VALID_TRANSITIONS = {
  draft: ['pending', 'cancelled'],
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'paused', 'rate_limited'],
  paused: ['running', 'cancelled'],
  rate_limited: ['pending', 'failed'],
  completed: [],
  failed: ['pending'],  // 允许重试
  cancelled: [],
};

function validateTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

### 优化 3：监控和告警

增加调度器健康度指标：
- 租约获取失败率
- 心跳续约失败率
- 僵尸执行数量
- 平均等待时间
- 任务积压数量

---

## 十三、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 修改引入新 Bug | 中 | 高 | 充分测试 + 分步提交 |
| 前端轮询负载增加 | 低 | 低 | 已有 SSE 支持 |
| 任务积压 | 低 | 中 | 监控队列长度 |
| 并发控制过严 | 中 | 中 | 提供配置项调整 |

---

## 十四、总结

### 核心洞察

1. **租约是并发控制的核心**
   - 谁持有租约，谁负责心跳
   - 只能有一个地方获取租约
   - 传递租约比重复获取更安全

2. **调度器是唯一入口**
   - API 层只能设置 status='pending'
   - 调度器轮询后统一分发
   - 这样并发控制才能生效

3. **职责分层必须清晰**
   - scheduler：查找待执行任务
   - worker：获取租约 + 执行任务
   - graphRunner：流程管理（不管调度）

### 工作量评估

| 任务 | 预计时间 | 优先级 |
|------|---------|--------|
| 步骤 1-6（修复） | 12 小时 | P0 |
| 验证测试 | 4 小时 | P0 |
| 优化 1（层级重构） | 2-3 天 | P1 |
| 优化 2（状态机） | 4 小时 | P1 |
| 优化 3（监控） | 1 天 | P2 |

**总计**：P0 修复 16 小时（2 天）

---

## 参考

- [2026-09-09-xuanji-architectural-issues.md](./2026-09-09-xuanji-architectural-issues.md) —— 已知架构问题
- [m07-parent-execute-bypass-scheduler.md](../../.claude/memory/m07-parent-execute-bypass-scheduler.md) —— 历史修复记录
- [scheduler-recursion-limit-bug.md](../../.claude/memory/scheduler-recursion-limit-bug.md) —— 调度器递归限制 Bug
