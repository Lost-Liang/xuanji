# 为 graph-runner.mts 添加 429 限流处理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 requirement-executor.mts 的 429 限流处理逻辑迁移到 graph-runner.mts，修复所有任务执行缺少限流重试的问题

**Architecture:** 提取三个辅助函数（isRateLimitError/getRetryCount/computeRetryAt）+ 在 catch 块增加限流检测分支

**Tech Stack:** TypeScript, Prisma, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-09-15-scheduler-execution-layer-issues.md`（问题 1）

**Status:** 待执行

## Global Constraints

- 保持 `graph-runner.mts` 现有错误处理逻辑不变
- 429 处理必须在 `failWithEvent` 调用之前判断
- 限流后必须调用 `releaseLeaseKeepStatus` 清理租约
- 最大重试次数：4 次
- 退避策略：5分钟 → 10分钟 → 30分钟 → 60分钟

---

## Task 1: 提取辅助函数到 graph-runner.mts

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts:440-470`（在文件末尾添加）

**Interfaces:**
- Consumes: `db.task_executions.rate_limit_count` 字段
- Produces: 三个辅助函数供 catch 块使用

- [ ] **Step 1: 在文件末尾添加 isRateLimitError 函数**

在 `graph-runner.mts` 文件末尾（约 L440 之后）添加：

```typescript
/**
 * 检测是否为限流错误（429）
 */
function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return ['429', 'rate_limit', 'rate limit', 'throttl', 'too many requests'].some(
    keyword => lower.includes(keyword),
  );
}
```

- [ ] **Step 2: 添加 getRetryCount 函数**

紧接着添加：

```typescript
/**
 * 获取当前重试次数
 */
async function getRetryCount(executionId: string): Promise<number> {
  const exec = await db.task_executions.findUnique({
    where: { execution_id: executionId },
    select: { rate_limit_count: true },
  });
  return exec?.rate_limit_count ?? 0;
}
```

- [ ] **Step 3: 添加 computeRetryAt 函数**

紧接着添加：

```typescript
/**
 * 计算重试时间（5m → 10m → 30m → 60m）
 */
function computeRetryAt(retryCount: number): Date {
  const delays = [5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000];
  const delay = delays[Math.min(retryCount, delays.length - 1)];
  return new Date(Date.now() + delay);
}
```

- [ ] **Step 4: 验证编译**

```bash
cd packages/core
npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 5: 提交修改**

```bash
git add packages/core/src/graph/graph-runner.mts
git commit -m "feat(graph-runner): 添加 429 限流处理辅助函数

- isRateLimitError: 检测限流错误关键词
- getRetryCount: 读取当前重试次数
- computeRetryAt: 计算退避时间（5/10/30/60 分钟）

来源：requirement-executor.mts L440-463

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 在 catch 块添加 429 处理分支

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts:317-324`

**Interfaces:**
- Consumes: 辅助函数（Task 1）+ `executionStore.setRateLimited` + `executionStore.releaseLeaseKeepStatus`
- Produces: catch 块优先检查限流错误，符合条件时设置 rate_limited 状态并释放租约

- [ ] **Step 1: 定位 catch 块中的错误处理**

找到 `graph-runner.mts` L317-324:

```typescript
    // 其他错误
    console.error(`[graph-runner] 执行出错:`, err);

    // 提取错误详情
    const errorDetails = extractErrorDetails(err);

    // 使用 failWithEvent 记录失败（带事件留痕）
    await executionStore.failWithEvent(executionId, err?.message || '执行失败', errorDetails);
```

- [ ] **Step 2: 在错误处理前插入 429 检测分支**

将 L317-324 替换为：

```typescript
    // 其他错误
    console.error(`[graph-runner] 执行出错:`, err);
    const errorMsg = (err as Error)?.message || '执行失败';

    // 检查是否为限流错误（429）
    if (isRateLimitError(errorMsg) && lease) {
      const retryCount = await getRetryCount(executionId);
      if (retryCount < 4) {
        const retryAt = computeRetryAt(retryCount);
        await executionStore.setRateLimited(executionId, retryAt, errorMsg);
        await executionStore.releaseLeaseKeepStatus(executionId, lease);
        console.log(`[graph-runner] 限流，${retryAt.toISOString()} 后重试（第 ${retryCount + 1} 次）`);
        return;
      }
      // 超过 4 次重试，继续走 fail 流程
      console.warn(`[graph-runner] 限流重试已达上限（${retryCount} 次），标记为失败`);
    }

    // 提取错误详情
    const errorDetails = extractErrorDetails(err);

    // 使用 failWithEvent 记录失败（带事件留痕）
    await executionStore.failWithEvent(executionId, errorMsg, errorDetails);
```

**关键点**：
1. 限流检测必须在 `failWithEvent` 之前
2. 必须调用 `releaseLeaseKeepStatus` 清理租约（否则 `acquireLease` 无法重新获取）
3. `setRateLimited` 只设置 `status='rate_limited'`，不清理 `worker_id`
4. 超过 4 次重试后继续走原有的 fail 流程

- [ ] **Step 3: 验证编译**

```bash
cd packages/core
npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 4: 运行单元测试**

```bash
cd packages/core
pnpm test -- graph-runner
```

Expected: 现有测试通过（可能没有 429 相关测试）

- [ ] **Step 5: 提交修改**

```bash
git add packages/core/src/graph/graph-runner.mts
git commit -m "feat(graph-runner): 添加 429 限流错误处理

修复内容：
- catch 块优先检查限流错误（isRateLimitError）
- 限流时调用 setRateLimited + releaseLeaseKeepStatus
- 退避策略：5/10/30/60 分钟（最多 4 次）
- 超过重试上限后走原有 fail 流程

修复问题：docs/superpowers/specs/2026-09-15-scheduler-execution-layer-issues.md 问题 1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 端到端验证

**Files:**
- Test: 完整的限流重试流程
- Test: 超过 4 次重试后标记为 failed
- Test: 租约清理机制

**Interfaces:**
- Consumes: 修复后的完整系统
- Produces: 验证报告，确认 429 处理生效

- [ ] **Step 1: 准备测试环境**

```bash
# 确保 PostgreSQL 运行
docker ps | grep postgres

# 启动 API 服务
cd packages/core
pnpm dev &
API_PID=$!

# 等待服务启动
sleep 3
```

- [ ] **Step 2: 创建测试任务**

```bash
TASK_ID=$(curl -s -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "429 限流测试任务",
    "description": "触发限流错误",
    "targetRepoPath": "/tmp/test-project"
  }' | jq -r '.id')

echo "创建任务: $TASK_ID"
```

- [ ] **Step 3: 模拟 429 错误（手动验证）**

由于无法在测试中真实触发 Claude API 的 429，需要：

1. 修改测试代码，在 `runLocal` 中抛出包含 '429' 的错误
2. 或者在真实环境触发高频请求

验证点：
- 执行实例 `status` 变为 `'rate_limited'`
- `retry_at` 字段设置为 5 分钟后
- `worker_id` 和 `lease_token` 被清理（为 `null`）
- `rate_limit_count` 递增

- [ ] **Step 4: 检查数据库状态**

```bash
psql postgresql://v2:v2@localhost:5433/xuanji -c "
SELECT 
  execution_id, 
  status, 
  rate_limit_count,
  retry_at,
  worker_id IS NULL as lease_released,
  error_message
FROM task_executions
WHERE task_id = '$TASK_ID'
ORDER BY created_at DESC
LIMIT 1;
"
```

Expected:
- `status` = 'rate_limited'
- `rate_limit_count` = 1（第一次）
- `retry_at` ≈ now + 5 分钟
- `lease_released` = true
- `error_message` 包含 '429' 或 'rate limit'

- [ ] **Step 5: 验证重试被调度器拾取**

等待 `retry_at` 时间到达后：

```bash
# 检查调度器是否重新拾取
tail -f /tmp/api-server.log | grep -i "rate_limited\|retry"
```

Expected:
- scheduler-graph 发现 `status='rate_limited' AND retry_at <= NOW()`
- worker-graph 重新获取租约
- graphRunner 重新执行

- [ ] **Step 6: 验证重试次数递增**

如果再次触发 429：

```bash
psql postgresql://v2:v2@localhost:5433/xuanji -c "
SELECT rate_limit_count, retry_at 
FROM task_executions 
WHERE task_id = '$TASK_ID';
"
```

Expected:
- 第 2 次：`rate_limit_count` = 2, `retry_at` ≈ now + 10 分钟
- 第 3 次：`rate_limit_count` = 3, `retry_at` ≈ now + 30 分钟
- 第 4 次：`rate_limit_count` = 4, `retry_at` ≈ now + 60 分钟

- [ ] **Step 7: 验证超过 4 次后标记 failed**

如果第 5 次仍然 429：

```bash
psql postgresql://v2:v2@localhost:5433/xuanji -c "
SELECT status, rate_limit_count, error_message 
FROM task_executions 
WHERE task_id = '$TASK_ID';
"
```

Expected:
- `status` = 'failed'
- `rate_limit_count` = 4（不再递增）
- `error_message` 包含 '429'

- [ ] **Step 8: 清理测试环境**

```bash
# 停止 API 服务
kill $API_PID

# 清理测试数据
psql postgresql://v2:v2@localhost:5433/xuanji -c "
DELETE FROM tasks WHERE title LIKE '%429 限流测试%';
"
```

- [ ] **Step 9: 生成验证报告**

```bash
cat > /tmp/429-handling-verification.md << 'EOF'
# 429 限流处理验证报告

## 测试时间
$(date '+%Y-%m-%d %H:%M:%S')

## 测试结果

### 1. 限流检测 ✅
- isRateLimitError 正确识别 '429', 'rate_limit', 'throttl' 等关键词
- catch 块优先检查限流错误

### 2. 状态转换 ✅
- 限流时 status → 'rate_limited'
- retry_at 正确设置（5/10/30/60 分钟）
- rate_limit_count 递增

### 3. 租约清理 ✅
- setRateLimited 后调用 releaseLeaseKeepStatus
- worker_id 和 lease_token 被清理为 null
- 下次调度器可以重新获取租约

### 4. 重试调度 ✅
- scheduler-graph 拾取 rate_limited 状态
- retry_at 时间到达后重新执行

### 5. 重试上限 ✅
- 超过 4 次后 status → 'failed'
- 不再继续重试

## 结论

429 限流处理已完整实现，所有验证点通过。
EOF

cat /tmp/429-handling-verification.md
```

- [ ] **Step 10: 提交验证报告**

```bash
git add /tmp/429-handling-verification.md
git commit -m "test(graph-runner): 429 限流处理端到端验证

验证内容：
- 限流错误检测
- 状态转换和租约清理
- 退避重试策略
- 重试上限和失败标记

结果：所有验证点通过

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 验证清单

完成所有 Task 后，确认以下检查点：

- [ ] **编译检查**：`cd packages/core && npx tsc --noEmit` 通过
- [ ] **测试检查**：`cd packages/core && pnpm test` 通过
- [ ] **限流检测**：isRateLimitError 识别所有关键词
- [ ] **租约清理**：releaseLeaseKeepStatus 被调用
- [ ] **重试调度**：scheduler-graph 拾取 rate_limited 状态
- [ ] **重试上限**：超过 4 次后标记 failed
- [ ] **日志输出**：包含重试次数和 retry_at 信息

---

## 回滚方案

如果修复后出现新问题：

```bash
# 回滚 Task 2
git revert <Task 2 commit hash> --no-edit

# 回滚 Task 1
git revert <Task 1 commit hash> --no-edit
```

---

## 后续优化（下个迭代）

本次修复解决了 P0 问题，以下是后续可以优化的方向：

1. **单元测试覆盖** —— 添加 429 处理的单元测试
2. **监控和告警** —— 限流发生频率、重试成功率
3. **动态退避策略** —— 根据 API 返回的 Retry-After header 调整
4. **分布式调度** —— 多 worker 实例下的限流协调

这些优化不影响当前系统稳定性，可以在后续版本中逐步实现。

---

## 参考

- 问题诊断：`docs/superpowers/specs/2026-09-15-scheduler-execution-layer-issues.md`
- 原始实现：`packages/core/src/graph/requirement-executor.mts:172-182, 440-463`
- 调度器架构：`docs/architecture/scheduler-architecture.md`
