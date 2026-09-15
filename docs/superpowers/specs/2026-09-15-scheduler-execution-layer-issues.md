# 璇玑 V4 调度-执行层问题诊断

> **Superpower**：调度-执行层问题诊断
> 日期：2026-09-15
> 状态：**诊断完成，待修复**
> 前置：调度层架构修复（2026-09-15）

---

## 一、问题摘要

在调度层架构修复（双重租约死锁、需求执行绕过调度器）完成后，对调度-执行层进行全面代码审查，发现 **8 个问题**：

| # | 问题 | 严重程度 | 影响 | 状态 |
|---|------|---------|------|------|
| 1 | **429 限流处理缺失** | P0 | 任务执行遇到 429 直接失败，不重试 | 待修复 |
| 2 | **worker-graph 错误处理未释放租约** | P0 | 异常退出时租约泄漏 | 待修复 |
| 3 | **phase_instances 利用不足** | P1 | 阶段进度不可见，恢复定位不准 | 待优化 |
| 4 | **LangGraph Checkpoint 使用 MemorySaver** | P1 | 进程重启后无法恢复 | 待修复 |
| 5 | **重复的 pending 查询** | P2 | DB 负载浪费，架构混乱 | 待优化 |
| 6 | **DB 用户工作流不支持** | P2 | 无法执行用户自定义工作流 | 待实现 |
| 7 | **requirement-executor.mts 死代码** | P2 | 包含唯一完整的 429 逻辑，但未被使用 | 待清理 |
| 8 | **waiting 恢复缺少 session 上下文** | P3 | 恢复后从起点重新执行，可能重复工作 | 待修复 |

---

## 二、问题 1：429 限流处理缺失 ⚠️ **最严重**

### 现象

任务执行遇到 API 429 限流时，直接标记为 `failed`，不会自动重试。而需求执行有完整的退避重试机制。

### 根因分析

**代码路径对比：**

| 执行类型 | 入口 | 429 处理 | 结果 |
|---------|------|---------|------|
| 需求执行 | `requirement-executor.mts` | ✅ 完整（5m→10m→30m→60m 退避） | 自动重试 |
| 任务执行 | `graph-runner.mts` | ❌ 无 | 直接失败 |

**requirement-executor.mts:172-182（完整的 429 处理）：**
```typescript
// 检查是否为限流错误
if (isRateLimitError(errorMsg) && lease) {
  const retryCount = await getRetryCount(executionId);
  if (retryCount < 4) {
    const retryAt = computeRetryAt(retryCount);
    await executionStore.setRateLimited(executionId, retryAt, errorMsg);
    await executionStore.releaseLeaseKeepStatus(executionId, lease);
    console.log(`[requirement-executor] 限流，${retryAt} 后重试（第 ${retryCount + 1} 次）`);
    return;
  }
}
await executionStore.fail(executionId, errorMsg);
```

**graph-runner.mts:317-324（无 429 处理）：**
```typescript
// 其他错误
console.error(`[graph-runner] 执行出错:`, err);

// 提取错误详情
const errorDetails = extractErrorDetails(err);

// 使用 failWithEvent 记录失败（带事件留痕）
await executionStore.failWithEvent(executionId, err?.message || '执行失败', errorDetails);
```

**worker-graph.mts:112-117（无 429 处理）：**
```typescript
} catch (err) {
  const errorMsg = (err as Error).message || '工作流执行失败';
  console.error(`[worker-graph] graphRunner 执行失败:`, err);
  await executionStore.failWithEvent(executionId, errorMsg);
  return { status: 'failed', error: errorMsg };
}
```

### 影响范围

- 所有任务执行（`subject_type === 'task'`）遇到 429 都会失败
- 需要人工重新触发执行
- 设计目标中的"429 重试"对任务执行不生效

### 修复方案

**方案 A：在 graph-runner 中增加 429 检测**

```typescript
// graph-runner.mts catch 块中
const errorMsg = err?.message || '执行失败';

if (isRateLimitError(errorMsg) && lease) {
  const retryCount = await getRetryCount(executionId);
  if (retryCount < 4) {
    const retryAt = computeRetryAt(retryCount);
    await executionStore.setRateLimited(executionId, retryAt, errorMsg);
    // lease 由 setRateLimited 内部处理
    console.log(`[graph-runner] 限流，${retryAt} 后重试（第 ${retryCount + 1} 次）`);
    return;
  }
}

await executionStore.failWithEvent(executionId, errorMsg, errorDetails);
```

**方案 B：提取 429 处理到 executionStore**

将 429 检测和重试逻辑封装到 `executionStore.handleRateLimitOrFailure(executionId, errorMsg, lease)`。

---

## 三、问题 2：worker-graph 错误处理未释放租约

### 现象

`worker-graph.mts` 的 3 个 catch 块调用 `failWithEvent` 后，没有调用 `releaseLeaseKeepStatus`。异常退出时租约字段（worker_id、lease_token）残留。

### 代码证据

**worker-graph.mts:79-84（重试分支）：**
```typescript
} catch (err) {
  const errorMsg = (err as Error).message || '工作流重新派发失败';
  console.error(`[worker-graph] graphRunner 重新派发失败:`, err);
  await executionStore.failWithEvent(executionId, errorMsg);
  // ← 缺少 releaseLeaseKeepStatus
  return { status: 'failed', error: errorMsg };
}
```

**worker-graph.mts:112-117（任务执行分支）：**
```typescript
} catch (err) {
  const errorMsg = (err as Error).message || '工作流执行失败';
  console.error(`[worker-graph] graphRunner 执行失败:`, err);
  await executionStore.failWithEvent(executionId, errorMsg);
  // ← 缺少 releaseLeaseKeepStatus
  return { status: 'failed', error: errorMsg };
}
```

**worker-graph.mts:147-152（需求执行分支）：**
```typescript
} catch (err) {
  const errorMsg = (err as Error).message || '需求执行失败';
  console.error(`[worker-graph] graphRunner 执行失败:`, err);
  await executionStore.failWithEvent(executionId, errorMsg);
  // ← 缺少 releaseLeaseKeepStatus
  return { status: 'failed', error: errorMsg };
}
```

### 影响

- 租约字段残留：`worker_id = 'worker-1'`, `lease_token` 非空
- 僵尸检测可能漏判（`findZombies` 检查 `heartbeat_at`，但如果心跳未启动则无法检测）
- 后续重试时 `acquireLease` 的 `worker_id: null` 条件不满足

### 修复方案

在 `failWithEvent` 后增加租约清理：

```typescript
} catch (err) {
  const errorMsg = (err as Error).message || '工作流执行失败';
  console.error(`[worker-graph] graphRunner 执行失败:`, err);
  await executionStore.failWithEvent(executionId, errorMsg);
  await executionStore.releaseLeaseKeepStatus(executionId, lease);  // ← 新增
  return { status: 'failed', error: errorMsg };
}
```

**注意**：`failWithEvent` 已设置 `status = 'failed'`，`releaseLeaseKeepStatus` 保持该状态不变。

---

## 四、问题 3：phase_instances 利用不足

### 现象

`phase_instances` 表只被写入，不被消费：
- `agent-node.mts` 和 `command-node.mts` 创建/更新记录
- `graph-runner.mts` 不读取用于阶段进度
- Dashboard 不展示阶段详情
- Resume 不使用定位断点

### 代码证据

**agent-node.mts:522-553（写入）：**
```typescript
// 创建/更新 phase_instance
await db.phase_instances.upsert({
  where: { id: phaseInstanceId },
  create: { ... },
  update: { ... },
});
```

**graph-runner.mts（不读取）：**
- 不查询 `phase_instances`
- 阶段进度依赖 `stage` 字段（字符串，精度低）

**Dashboard TaskDetail.vue:137（硬编码阶段列表）：**
```typescript
const phaseOrder = ['breakdown', 'planning', 'develop', 'code', 'compile_check', ...];
```

### 影响

- 阶段进度不可见（用户不知道当前在哪个具体步骤）
- 恢复执行无法定位到精确断点
- 设计目标中的"研发流程可视化"部分失效

### 修复方案

1. **graph-runner 阶段进度**：每次节点执行完成后更新 `stage` 字段
2. **Dashboard 动态阶段**：从 YAML 工作流定义读取节点列表
3. **Resume 断点定位**：读取最后一个 `phase_instance` 确定 resume 起点

---

## 五、问题 4：LangGraph Checkpoint 使用 MemorySaver

### 现象

`builder.mts` 使用 `MemorySaver` 作为 LangGraph checkpointer，状态只保存在内存中。进程重启后无法恢复中断的执行。

### 代码证据

**builder.mts:**
```typescript
const checkpointer = new MemorySaver()
// TODO 接入 Prisma checkpoint
```

### 影响

- 服务重启后，所有 `paused` 状态的执行无法恢复
- interrupt/resume 机制依赖进程存活
- 设计目标中的"进程管理"不完整

### 修复方案

实现 `PrismaSaver`（继承 `BaseCheckpointSaver`）：

```typescript
class PrismaSaver extends BaseCheckpointSaver {
  async put(config, checkpoint) {
    await db.langgraph_checkpoints.upsert({
      where: { thread_id: config.configurable.thread_id },
      create: { thread_id, checkpoint_json: JSON.stringify(checkpoint) },
      update: { checkpoint_json: JSON.stringify(checkpoint) },
    });
  }

  async get(config) {
    const row = await db.langgraph_checkpoints.findUnique({
      where: { thread_id: config.configurable.thread_id },
    });
    return row ? JSON.parse(row.checkpoint_json) : null;
  }
}
```

---

## 六、问题 5：重复的 pending 查询

### 现象

`scheduler-controller.mts` 和 `scheduler-graph.mts` 都查询 pending 任务，使用相同的条件。

### 代码证据

**scheduler-controller.mts:99-116：**
```typescript
const pending = await db.task_executions.findFirst({
  where: {
    OR: [
      {
        status: 'pending',
        OR: [
          { retry_at: null },
          { retry_at: { lte: new Date() } },
        ],
      },
      {
        status: 'rate_limited',
        retry_at: { lte: new Date() },
      },
    ],
  },
  orderBy: { created_at: 'asc' },
});
```

**scheduler-graph.mts scheduleNode（类似查询）：**
```typescript
// 同样的 OR 条件查询
```

### 影响

- 每 5 秒执行 2 次 DB 查询（一次在 controller，一次在 graph）
- 架构混乱：职责边界不清

### 修复方案

**方案 A：scheduler-controller 直接传递 executionId**

controller 查询到 pending 后，直接传递给 `schedulerGraph.invoke({ executionId })`，scheduler-graph 不再重复查询。

**方案 B：合并为单一调度层**

将 scheduler-controller 和 scheduler-graph 合并，只保留一套查询逻辑。

---

## 七、问题 6：DB 用户工作流不支持

### 现象

`loadFlow()` 返回 `null` 对于 DB 存储的工作流定义（`graph_definitions.definition_json`）。

### 代码证据

**graph-runner.mts loadFlow():**
```typescript
// TODO: 支持 DB 用户流执行
if (isPresetFlowId) {
  // 从文件加载
} else {
  return null;  // ← DB 工作流不支持
}
```

### 影响

- 无法执行用户自定义工作流
- 所有执行都使用预置 YAML 文件

### 修复方案

```typescript
if (!isPresetFlowId) {
  const graphDef = await db.graph_definitions.findUnique({
    where: { id: flowId },
  });
  if (graphDef?.definition_json) {
    return {
      id: flowId,
      yamlContent: graphDef.definition_json,
      isPreset: false,
    };
  }
}
```

---

## 八、问题 7：requirement-executor.mts 死代码

### 现象

架构修复后，需求执行改为走 `worker-graph.mts` → `graphRunner.startExecution(flowId: 'requirement-decomposition')`。`requirement-executor.mts` 不再被导入使用。

### 代码证据

```bash
$ grep -r "requirement-executor" packages/core/src/
# 无结果（文件未被导入）
```

### 影响

- 463 行死代码残留
- 包含唯一完整的 429 处理逻辑（应提取复用）
- 代码维护负担

### 修复方案

1. **提取 429 工具函数**：将 `isRateLimitError`、`computeRetryAt`、`getRetryCount` 移到 `timing-constants.mts` 或新建 `rate-limit-utils.mts`
2. **删除死文件**：确认无引用后删除

---

## 九、问题 8：waiting 恢复缺少 session 上下文

### 现象

`recovery-graph.mts` 的 `recoverWaitingNode` 检查 inbox 问题是否全部回答后，将 status 改为 `pending`，但不传递 session_id。

### 代码证据

**recovery-graph.mts:180-191：**
```typescript
// 重置状态为 pending，让调度器重新拾取
await db.task_executions.update({
  where: { execution_id: exec.execution_id },
  data: {
    status: 'pending',
    // 清除旧的租约信息
    worker_id: null,
    lease_token: null,
    lease_expires_at: null,
    // ← 缺少 session_id 传递
  },
});
```

### 影响

- 执行从起点重新开始，而不是从中断点继续
- Agent 可能重复已完成的工作
- 浪费 token 和时间

### 修复方案

```typescript
await db.task_executions.update({
  where: { execution_id: exec.execution_id },
  data: {
    status: 'pending',
    worker_id: null,
    lease_token: null,
    lease_expires_at: null,
    // session_id 保持不变，resume 时使用
  },
});
```

调度器拾取后，应检查 session_id 并调用 `resumeExecution` 而非 `startExecution`。

---

## 十、修复优先级

| 优先级 | 问题 | 预计工作量 | 阻塞影响 |
|--------|------|-----------|---------|
| **P0** | 429 限流处理缺失 | 4 小时 | 任务执行遇到 429 必失败 |
| **P0** | worker-graph 租约未释放 | 2 小时 | 异常退出后无法重试 |
| **P1** | Checkpoint 未持久化 | 8 小时 | 进程重启后无法恢复 |
| **P1** | phase_instances 利用 | 4 小时 | 阶段进度不可见 |
| **P2** | 重复 pending 查询 | 4 小时 | DB 负载浪费 |
| **P2** | DB 用户工作流支持 | 4 小时 | 功能缺失 |
| **P2** | requirement-executor 死代码 | 2 小时 | 代码维护负担 |
| **P3** | waiting 恢复上下文 | 2 小时 | 可能重复工作 |

**总计 P0 修复**：6 小时
**总计 P1 修复**：12 小时

---

## 十一、修复计划

### 阶段 1：P0 修复（建议立即执行）

**Task 1: 增加 429 限流处理**

1. 提取工具函数到 `rate-limit-utils.mts`：
   - `isRateLimitError(message: string): boolean`
   - `computeRetryAt(retryCount: number): Date`
   - `getRetryCount(executionId: string): Promise<number>`

2. 在 `graph-runner.mts` catch 块增加 429 检测：
   ```typescript
   if (isRateLimitError(errorMsg) && lease) {
     const retryCount = await getRetryCount(executionId);
     if (retryCount < 4) {
       const retryAt = computeRetryAt(retryCount);
       await executionStore.setRateLimited(executionId, retryAt, errorMsg);
       return;
     }
   }
   ```

3. 测试验证：模拟 429 错误，确认重试机制

**Task 2: worker-graph 租约释放**

1. 在 3 个 catch 块增加 `releaseLeaseKeepStatus`
2. 测试验证：模拟执行失败，确认租约字段清空

### 阶段 2：P1 修复（后续迭代）

**Task 3: 实现 PrismaSaver**

**Task 4: 完善 phase_instances 使用**

### 阶段 3：P2/P3 优化（可选）

- 清理死代码
- 合并重复查询
- 支持 DB 用户工作流

---

## 十二、参考

- [2026-09-15-scheduler-architecture-fix.md](./2026-09-15-scheduler-architecture-fix.md) —— 调度层架构修复
- [2026-09-07-xuanji-v4-design.md](./2026-09-07-xuanji-v4-design.md) —— V4 架构设计
- [2026-09-09-xuanji-architectural-issues.md](./2026-09-09-xuanji-architectural-issues.md) —— 已知架构问题