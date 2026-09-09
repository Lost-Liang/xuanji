# 人机交互状态持久化设计

> 设计日期：2026-09-08
> 状态：Draft
> 作者：Claude

## 概述

### 问题背景

当前人机交互状态存储在进程内 `pendingAnswers` Map，存在以下问题：

1. **服务重启后状态丢失**：等待人类回答的问题变成"孤儿"
2. **执行状态不一致**：显示"已完成"但实际还在等待人类回答
3. **回答无法投递**：人类回答后 Agent 无法收到，因为等待的 Promise 已丢失

### 目标

- 人机交互状态持久化到数据库，支持服务重启恢复
- 执行状态与人机交互状态保持同步
- 孤儿问题自动检测和恢复

### 方案选择

经过对比分析，选择 **数据库轮询方案**：

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 数据库轮询 | 改动小，无需新依赖 | 轮询 I/O，响应延迟 | **选择** |
| LangGraph Interrupt | 原生支持进程重启 | 改动范围大 | 备选 |
| Redis Pub/Sub | 实时响应，多实例支持 | 新依赖，运维复杂 | 单实例不需要 |

## 数据模型

### inbox_questions 表扩展

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `waiting_since` | DateTime? | 开始等待时间（用于超时检测） |
| `process_id` | String? | 等待该回答的进程 ID（用于孤儿检测） |
| `timeout_ms` | Int? | 超时毫秒数（默认 24h = 86400000） |

Prisma schema 变更：

```prisma
model InboxQuestion {
  id            String    @id
  executionId   String
  sessionId     String?
  body          String
  choices       Json?
  status        String    // 'pending' | 'answered' | 'timeout'
  answer        String?
  answeredAt    DateTime?

  // 新增字段
  waitingSince  DateTime?  // 开始等待时间
  processId     String?    // 等待进程 ID
  timeoutMs     Int?       // 超时毫秒数

  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  execution     TaskExecution @relation(fields: [executionId], references: [executionId])
}
```

### task_executions 状态扩展

新增状态值：

| 状态 | 说明 |
|------|------|
| `waiting` | 等待人类回答（介于 running 和 paused 之间） |

状态机变更：

```
running → waiting (收到 inbox_ask)
waiting → running (收到 inbox_answer)
waiting → completed (正常完成)
waiting → timeout (超时)
```

## 核心流程

### 旧流程（进程内 Map）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Agent 调用 inbox_ask 工具                                            │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. MCP Bridge 处理                                                      │
│    POST /api/internal/inbox-ask                                        │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. waitForHumanAnswer(questionId)                                       │
│    - 写入 inbox_questions 表                                            │
│    - 创建 Promise 存入 pendingAnswers Map                              │
│    - Promise 阻塞（最长 24h）                                           │
│    ⚠️ 服务重启后 Map 丢失                                                │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. 人类在 Dashboard 回答                                                 │
│    POST /api/inbox/:id/answer                                          │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. notifyHumanAnswered(questionId, answer)                              │
│    - 从 pendingAnswers Map 取出 resolve                               │
│    - resolve(answer) 解除 Promise 阻塞                                 │
│    ⚠️ 若服务已重启，Map 为空，无法解除阻塞                              │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Agent 收到回答继续执行                                               │
│    ⚠️ 若服务重启过，Agent 永远等待                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 新流程（长轮询分片模式）

**关键设计决策**：使用**长轮询分片**而非单次 24h 阻塞，避免反向代理超时。

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Agent 调用 inbox_ask 工具                                            │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. MCP Bridge 处理                                                      │
│    循环调用 POST /api/internal/inbox-ask 直到收到回答                   │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. 首次请求：创建问题                                                    │
│    POST /api/internal/inbox-ask (create=true)                          │
│    - 写入 inbox_questions 表                                            │
│    - status = 'pending'                                                 │
│    - waiting_since = now()                                              │
│    - process_id = process.pid                                           │
│    返回: { questionId, status: 'pending', continue: true }              │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. 轮询请求：等待回答（单次最多 30 秒）                                   │
│    POST /api/internal/inbox-ask (questionId=xxx)                       │
│    - pollForAnswer(questionId, timeoutMs=30000)                         │
│    - 若 30 秒内收到回答：返回 answer                                      │
│    - 若 30 秒超时：返回 { status: 'pending', continue: true }            │
│    ✅ 单次 HTTP 请求短，不会被代理超时                                    │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
         ┌──────────────────┴──────────────────┐
         │ MCP Bridge 循环调用直到收到回答      │
         └──────────────────┬──────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. 人类在 Dashboard 回答                                                 │
│    POST /api/inbox/:id/answer                                          │
│    - 更新 inbox_questions: status='answered', answer=..., answered_at  │
│    - 可选：通知内存缓存（pendingAnswers Map）                           │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. 下次轮询检测到 status='answered'                                      │
│    返回 answer 给 MCP Bridge                                            │
│    ✅ 即使服务重启，数据库状态仍在，可继续轮询                           │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. Agent 收到回答继续执行                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

**为什么使用长轮询分片？**

| 方案 | 问题 | 解决 |
|------|------|------|
| 单次 24h 阻塞 | nginx 默认 60s 超时 | 分片为 30s 单次请求 |
| WebSocket | 需要新端点，复杂度高 | 复用现有 HTTP 端点 |
| 纯轮询 | 延迟高，浪费资源 | 长轮询，有数据才返回 |

## 组件设计

### 1. pollForAnswer 函数

**位置**：`packages/core/src/graph/session-control-v2.mts`

**关键设计**：
- 使用**长轮询分片**：单次调用最多阻塞 30 秒
- 保留 `pendingAnswers` Map 作为**内存缓存**（快速路径）
- 返回结构支持分片继续

```typescript
interface PollResult {
  status: 'answered' | 'pending' | 'timeout';
  answer?: string;
  continue?: boolean;  // true = 需要继续轮询
}

/**
 * 轮询数据库等待人类回答（长轮询分片模式）
 *
 * 单次调用最多阻塞 timeoutMs（默认 30s），避免反向代理超时。
 * 调用方需要循环调用直到 status !== 'pending'。
 *
 * @param questionId - inbox_questions 表主键
 * @param timeoutMs - 单次轮询超时毫秒数，默认 30s
 * @returns PollResult 包含状态和答案
 */
export async function pollForAnswer(
  questionId: string,
  timeoutMs: number = 30_000  // 默认 30 秒（nginx 默认 60s 超时，留余量）
): Promise<PollResult> {
  // 快速路径：先检查内存缓存
  const cached = pendingAnswers.get(questionId);
  if (cached?.answer) {
    return { status: 'answered', answer: cached.answer };
  }

  const startTime = Date.now();
  const pollInterval = 1000; // 1秒轮询间隔

  while (Date.now() - startTime < timeoutMs) {
    const question = await db.inboxQuestion.findUnique({
      where: { id: questionId },
      select: { status: true, answer: true },
    });

    if (!question) {
      return { status: 'timeout' };  // 问题不存在
    }

    if (question.status === 'answered' && question.answer) {
      // 更新内存缓存（供后续快速访问）
      pendingAnswers.set(questionId, { resolve: () => {}, reject: () => {}, answer: question.answer });
      return { status: 'answered', answer: question.answer };
    }

    if (question.status === 'timeout') {
      return { status: 'timeout' };
    }

    await sleep(pollInterval);
  }

  // 单次轮询超时，告诉调用方继续
  return { status: 'pending', continue: true };
}

// 辅助函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 2. internal.mts 端点修改

**位置**：`packages/core/src/routes/internal.mts`

**关键设计**：支持两种请求模式
1. **创建问题**：`{ create: true, question, executionId }` → 创建问题并开始轮询
2. **继续轮询**：`{ questionId }` → 继续等待回答

```typescript
/**
 * POST /api/internal/inbox-ask
 *
 * 请求体：
 * - 创建模式：{ create: true, executionId, question, choices? }
 * - 轮询模式：{ questionId }
 */
internalRouter.post('/inbox-ask', async (req, res) => {
  const { create, executionId, question, choices, questionId } = req.body;

  let currentQuestionId = questionId;

  // 创建模式：写入新问题
  if (create) {
    currentQuestionId = randomUUID();
    const now = new Date();

    await db.inboxQuestion.create({
      data: {
        id: currentQuestionId,
        executionId,
        body: question,
        choices: choices ?? null,
        status: 'pending',
        waitingSince: now,
        processId: process.pid.toString(),
        timeoutMs: 24 * 60 * 60 * 1000,
      },
    });

    // 保存对话事件
    await db.conversationEvent.create({
      data: {
        id: randomUUID(),
        executionId,
        eventType: 'inbox_ask',
        payload: { questionId: currentQuestionId, body: question, choices },
      },
    });

    // 更新执行状态为 waiting
    await db.taskExecution.update({
      where: { executionId },
      data: { status: 'waiting' },
    });
  }

  // 单次轮询（最多 30 秒）
  const result = await pollForAnswer(currentQuestionId, 30_000);

  if (result.status === 'answered') {
    // 记录回答事件
    await db.conversationEvent.create({
      data: {
        id: randomUUID(),
        executionId,
        eventType: 'inbox_answer',
        payload: { questionId: currentQuestionId, answer: result.answer },
      },
    });

    // 恢复执行状态
    await db.taskExecution.update({
      where: { executionId },
      data: { status: 'running' },
    });

    res.json({ questionId: currentQuestionId, status: 'answered', answer: result.answer });
  } else if (result.status === 'pending') {
    // 未收到回答，告诉 MCP Bridge 继续轮询
    res.json({ questionId: currentQuestionId, status: 'pending', continue: true });
  } else {
    // 超时或错误
    res.status(504).json({ questionId: currentQuestionId, status: 'timeout', error: '等待人类回答超时' });
  }
});
```

### 3. MCP Bridge 修改

**位置**：`packages/runner/src/mcp-bridge.ts`

修改 `handleInboxAskViaHttp` 使用循环调用：

```typescript
/**
 * 通过 HTTP 长轮询分片等待人类回答
 */
async function handleInboxAskViaHttp(question: string, choices?: string[]): Promise<string> {
  const apiUrl = process.env.XUANJI_API_URL || 'http://localhost:3000';
  const executionId = process.env.XUANJI_EXECUTION_ID;

  let questionId: string | null = null;
  let isFirst = true;

  // 循环调用直到收到回答
  while (true) {
    const body: any = isFirst
      ? { create: true, executionId, question, choices }
      : { questionId };

    const response = await fetch(`${apiUrl}/api/internal/inbox-ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`inbox-ask 请求失败: ${response.status}`);
    }

    const result = await response.json();

    if (result.status === 'answered') {
      return result.answer;
    }

    if (result.status === 'timeout') {
      throw new Error('等待人类回答超时');
    }

    // 继续轮询
    questionId = result.questionId;
    isFirst = false;
  }
}
```

### 3. 孤儿检测服务

**位置**：`packages/core/src/graph/orphan-detection.mts`（新文件）

```typescript
/**
 * 孤儿问题检测和恢复
 *
 * 服务启动时运行，检测超时未回答的问题并恢复状态。
 */

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

export async function recoverOrphanedQuestions(): Promise<void> {
  console.log('[orphan-detection] 开始检测孤儿问题...');

  const timeoutThreshold = new Date(Date.now() - DEFAULT_TIMEOUT_MS);

  // 查找超时的 pending 问题
  const orphans = await db.inboxQuestion.findMany({
    where: {
      status: 'pending',
      waitingSince: { lt: timeoutThreshold },
    },
    include: {
      execution: {
        select: { status: true, executionId: true },
      },
    },
  });

  console.log(`[orphan-detection] 发现 ${orphans.length} 个孤儿问题`);

  for (const orphan of orphans) {
    const exec = orphan.execution;

    if (exec?.status === 'completed' || exec?.status === 'failed') {
      // 执行已完成但问题仍 pending，标记为 timeout
      await db.inboxQuestion.update({
        where: { id: orphan.id },
        data: { status: 'timeout' },
      });
      console.log(`[orphan-detection] 问题 ${orphan.id} 标记为 timeout（执行已完成）`);
    } else if (exec?.status === 'running') {
      // 执行仍在运行但问题超时，更新执行状态为 waiting
      await db.taskExecution.update({
        where: { executionId: orphan.executionId },
        data: { status: 'waiting' },
      });
      console.log(`[orphan-detection] 执行 ${orphan.executionId} 状态更新为 waiting`);
    }
  }

  console.log('[orphan-detection] 孤儿问题检测完成');
}

/**
 * 定期清理任务（可选）
 *
 * 每 5 分钟运行一次，检测并清理孤儿问题。
 */
export function startPeriodicCleanup(): void {
  const interval = setInterval(async () => {
    try {
      await recoverOrphanedQuestions();
    } catch (err) {
      console.error('[orphan-detection] 定期清理失败:', err);
    }
  }, 5 * 60 * 1000); // 5分钟

  interval.unref(); // 不阻止进程退出
  console.log('[orphan-detection] 定期清理任务已启动（每 5 分钟）');
}
```

### 4. graph-runner.mts 状态同步

**位置**：`packages/core/src/graph/graph-runner.mts`

在 `startExecution` 完成后检查是否有 pending 问题：

```typescript
// 在 onFlowComplete 后添加

async function checkPendingQuestions(executionId: string): Promise<boolean> {
  const count = await db.inboxQuestion.count({
    where: { executionId, status: 'pending' },
  });
  return count > 0;
}

// 在标记完成前检查
if (await checkPendingQuestions(executionId)) {
  // 有待回答的问题，不标记为 completed
  await db.taskExecution.update({
    where: { executionId },
    data: { status: 'waiting' },
  });
  console.log(`[graph-runner] 执行 ${executionId} 有待回答问题，状态更新为 waiting`);
} else {
  await executionStore.complete(executionId, '流程执行完成');
}
```

### 5. SSE 修复

**位置**：`packages/core/src/routes/executions.mts`

修改 SSE 轮询，正确处理 `waiting` 状态：

```typescript
executionsRouter.get('/:id/stream', async (req, res) => {
  // ... 现有代码 ...

  const pollInterval = setInterval(async () => {
    const exec = await db.taskExecution.findUnique({
      where: { executionId },
      select: { status: true },
    });

    // 新增：waiting 状态不关闭 SSE
    if (!exec || exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled') {
      res.write(`data: {"type":"execution_done","status":"${exec?.status || 'unknown'}"}\n\n`);
      clearInterval(pollInterval);
      res.end();
      return;
    }

    // waiting 状态继续轮询，不关闭连接
    // ...

  }, 500);
});
```

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `prisma/schema.prisma` | 修改 | 添加 waiting_since, process_id, timeout_ms 字段 |
| `session-control-v2.mts` | 修改 | 新增 pollForAnswer 函数，保留 pendingAnswers Map 作为缓存 |
| `routes/internal.mts` | 修改 | 支持创建/轮询两种模式，长轮询分片 |
| `mcp-bridge.ts` | 修改 | 循环调用 inbox-ask 端点直到收到回答 |
| `routes/executions.mts` | 修改 | SSE 修复，新增 waiting 状态处理 |
| `graph-runner.mts` | 修改 | 执行状态与人机交互状态同步 |
| `orphan-detection.mts` | 新增 | 孤儿检测服务 |
| `index.mts` | 修改 | 启动时调用孤儿检测 |

## 迁移计划

### 1. 数据库迁移

```bash
# 1. 修改 Prisma schema
# 2. 生成迁移
pnpm prisma migrate dev --name add_inbox_waiting_fields

# 3. 同步数据库
pnpm prisma db push
```

### 2. 代码部署

1. 修改 Prisma schema
2. 实现 pollForAnswer 函数
3. 修改 internal.mts 端点
4. 修改 executions.mts SSE
5. 实现孤儿检测服务
6. 修改 graph-runner.mts 状态同步
7. 修改启动入口

## 测试用例

### 1. 服务重启恢复测试

**步骤**：
1. 创建执行，触发 inbox_ask
2. 验证 inbox_questions 表有 pending 记录
3. 重启 Core 服务
4. 验证问题仍在等待
5. 在 Dashboard 回答问题
6. 验证 Agent 能收到回答

### 2. 执行状态一致性测试

**步骤**：
1. 创建执行，触发 inbox_ask
2. 验证执行状态为 'waiting'
3. 回答问题后验证状态恢复为 'running'
4. 执行完成后验证状态为 'completed'

### 3. 孤儿检测测试

**步骤**：
1. 创建执行，触发 inbox_ask
2. 手动修改 waiting_since 为 25 小时前
3. 重启 Core 服务
4. 验证孤儿检测正确识别并处理

### 4. SSE 实时推送测试

**步骤**：
1. 创建执行，触发 inbox_ask
2. 打开 Canvas 页面
3. 在另一个标签页回答问题
4. 验证 UI 自动更新（无需刷新）

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据库轮询增加 I/O 负载 | 中 | 1 秒轮询间隔可接受；可根据负载调整 |
| 超时检测不准确 | 低 | 使用 waiting_since 精确计算 |
| 并发回答竞态条件 | 低 | 数据库事务保护；幂等更新 |
| 服务重启时的短暂中断 | 低 | 孤儿检测在启动时自动恢复 |

## 后续优化

1. **可配置轮询间隔**：根据系统负载动态调整
2. **批量轮询优化**：多个问题批量查询，减少 I/O
3. **事件通知机制**：使用 PostgreSQL NOTIFY/LISTEN 替代轮询（长期优化）
4. **多实例支持**：若需多实例部署，考虑引入 Redis

## 过渡策略

### 现有代码处理

| 现有组件 | 处理方式 |
|----------|----------|
| `pendingAnswers` Map | 保留，作为内存缓存（快速路径） |
| `waitForHumanAnswer()` | 保留，但内部改用 pollForAnswer |
| `notifyHumanAnswered()` | 保留，更新内存缓存 |

### 向后兼容

```typescript
// session-control-v2.mts

// 保留现有接口，内部改用新实现
export async function waitForHumanAnswer(
  questionId: string,
  timeoutMs: number = 24 * 60 * 60 * 1000
): Promise<string> {
  // 使用长轮询分片，循环直到收到回答或超时
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await pollForAnswer(questionId, 30_000);

    if (result.status === 'answered') {
      return result.answer!;
    }

    if (result.status === 'timeout') {
      throw new Error('等待人类回答超时');
    }

    // 继续轮询
  }

  throw new Error('等待人类回答超时');
}

// 保留，用于更新内存缓存
export function notifyHumanAnswered(questionId: string, answer: string): boolean {
  const pending = pendingAnswers.get(questionId);
  if (pending) {
    // 更新缓存
    (pending as any).answer = answer;
    if (pending.resolve) {
      pending.resolve(answer);
    }
  }
  return !!pending;
}
```

### 迁移步骤

1. **阶段 1**：添加新字段和 pollForAnswer 函数
2. **阶段 2**：修改 internal.mts 端点，支持长轮询分片
3. **阶段 3**：修改 mcp-bridge.ts，使用循环调用
4. **阶段 4**：添加孤儿检测服务
5. **阶段 5**：更新现有 waitForHumanAnswer 使用新实现