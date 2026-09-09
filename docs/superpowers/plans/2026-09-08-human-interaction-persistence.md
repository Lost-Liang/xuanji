# 人机交互状态持久化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将人机交互状态从进程内 Map 持久化到数据库，支持服务重启恢复

**Architecture:** 使用长轮询分片模式，单次 HTTP 请求最多 30 秒，MCP Bridge 循环调用直到收到回答。保留 pendingAnswers Map 作为内存缓存加速响应。

**Tech Stack:** PostgreSQL + Prisma, TypeScript, Express, SSE

**Spec:** `docs/superpowers/specs/2026-09-08-human-interaction-persistence-design.md`

## Global Constraints

- 轮询间隔：1 秒
- 单次 HTTP 轮询超时：30 秒（nginx 默认 60s 超时，留余量）
- 总超时：24 小时
- 孤儿检测：服务启动时自动运行
- 执行状态：新增 'waiting' 状态
- 语言：中文注释

---

## File Structure

| 文件 | 责任 |
|------|------|
| `prisma/schema.prisma` | 数据模型定义，inbox_questions 表扩展 |
| `session-control-v2.mts` | pollForAnswer 函数，状态轮询核心逻辑 |
| `routes/internal.mts` | inbox-ask 端点，支持创建/轮询两种模式 |
| `mcp-bridge.ts` | MCP Bridge 循环调用逻辑 |
| `routes/executions.mts` | SSE 修复，waiting 状态处理 |
| `graph-runner.mts` | 执行状态与人机交互状态同步 |
| `orphan-detection.mts` | 孤儿问题检测和恢复服务 |
| `index.mts` | 启动入口，调用孤儿检测 |

---

### Task 1: 数据模型扩展

**Files:**
- Modify: `packages/core/prisma/schema.prisma`

**Interfaces:**
- Produces: `InboxQuestion` 模型新增 `waitingSince`, `processId`, `timeoutMs` 字段

- [ ] **Step 1: 修改 Prisma schema**

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

- [ ] **Step 2: 运行 Prisma 迁移**

```bash
cd packages/core
pnpm prisma migrate dev --name add_inbox_waiting_fields
```

- [ ] **Step 3: 验证数据库**

```bash
pnpm prisma db push
pnpm prisma studio
# 检查 inbox_questions 表是否有新字段
```

- [ ] **Step 4: 提交**

```bash
git add packages/core/prisma/schema.prisma packages/core/prisma/migrations/
git commit -m "feat: inbox_questions 表添加 waiting_since, process_id, timeout_ms 字段"
```

---

### Task 2: pollForAnswer 函数实现

**Files:**
- Modify: `packages/core/src/graph/session-control-v2.mts`

**Interfaces:**
- Produces: `pollForAnswer(questionId, timeoutMs): Promise<PollResult>`

- [ ] **Step 1: 添加 PollResult 类型定义**

```typescript
// 添加到 session-control-v2.mts 顶部

interface PollResult {
  status: 'answered' | 'pending' | 'timeout';
  answer?: string;
  continue?: boolean;  // true = 需要继续轮询
}
```

- [ ] **Step 2: 添加 sleep 辅助函数**

```typescript
// 添加到文件末尾

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

- [ ] **Step 3: 实现 pollForAnswer 函数**

```typescript
// 添加到 waitForHumanAnswer 函数之前

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
  timeoutMs: number = 30_000
): Promise<PollResult> {
  // 快速路径：先检查内存缓存
  const cached = pendingAnswers.get(questionId);
  if (cached && (cached as any).answer) {
    return { status: 'answered', answer: (cached as any).answer };
  }

  const startTime = Date.now();
  const pollInterval = 1000; // 1秒轮询间隔

  while (Date.now() - startTime < timeoutMs) {
    const question = await db.inboxQuestion.findUnique({
      where: { id: questionId },
      select: { status: true, answer: true },
    });

    if (!question) {
      return { status: 'timeout' };
    }

    if (question.status === 'answered' && question.answer) {
      // 更新内存缓存
      const existing = pendingAnswers.get(questionId);
      if (existing) {
        (existing as any).answer = question.answer;
      }
      return { status: 'answered', answer: question.answer };
    }

    if (question.status === 'timeout') {
      return { status: 'timeout' };
    }

    await sleep(pollInterval);
  }

  return { status: 'pending', continue: true };
}
```

- [ ] **Step 4: 添加 db 导入**

```typescript
// 确保文件顶部有 db 导入
import { db } from '../db.mjs';
```

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/graph/session-control-v2.mts
git commit -m "feat: 添加 pollForAnswer 函数，支持长轮询分片模式"
```

---

### Task 3: internal.mts 端点修改

**Files:**
- Modify: `packages/core/src/routes/internal.mts`

**Interfaces:**
- Consumes: `pollForAnswer(questionId, timeoutMs)`
- Produces: `POST /api/internal/inbox-ask` 支持创建/轮询两种模式

- [ ] **Step 1: 修改 /inbox-ask 端点**

找到现有的 `internalRouter.post('/inbox-ask', ...)` 并替换为：

```typescript
/**
 * POST /api/internal/inbox-ask
 *
 * 请求体：
 * - 创建模式：{ create: true, executionId, question, choices? }
 * - 轮询模式：{ questionId }
 */
internalRouter.post('/inbox-ask', async (req, res) => {
  try {
    const { create, executionId, question, choices, questionId } = req.body as {
      create?: boolean;
      executionId?: string;
      question?: string;
      choices?: string[];
      questionId?: string;
    };

    let currentQuestionId = questionId;
    let execId = executionId;

    // 创建模式：写入新问题
    if (create) {
      if (!executionId || !question) {
        res.status(400).json({ error: '创建模式需要 executionId 和 question' });
        return;
      }

      currentQuestionId = randomUUID();
      const now = new Date();

      await db.inboxQuestion.create({
        data: {
          id: currentQuestionId,
          executionId,
          body: question,
          choices: choices ? choices : Prisma.JsonNull,
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
          payload: {
            questionId: currentQuestionId,
            body: question,
            choices: choices ?? null,
            source: 'mcp-bridge',
          } as Prisma.InputJsonValue,
        },
      });

      // 更新执行状态为 waiting
      await db.taskExecution.update({
        where: { executionId },
        data: { status: 'waiting' },
      }).catch(() => { /* 忽略更新失败 */ });
    }

    if (!currentQuestionId) {
      res.status(400).json({ error: '缺少 questionId' });
      return;
    }

    // 单次轮询（最多 30 秒）
    const result = await pollForAnswer(currentQuestionId, 30_000);

    if (result.status === 'answered' && result.answer) {
      // 获取 executionId（轮询模式下需要查询）
      if (!execId) {
        const q = await db.inboxQuestion.findUnique({
          where: { id: currentQuestionId },
          select: { executionId: true },
        });
        execId = q?.executionId;
      }

      if (execId) {
        // 记录回答事件
        await db.conversationEvent.create({
          data: {
            id: randomUUID(),
            executionId: execId,
            eventType: 'inbox_answer',
            payload: {
              questionId: currentQuestionId,
              answer: result.answer,
              source: 'mcp-bridge',
            } as Prisma.InputJsonValue,
          },
        });

        // 恢复执行状态
        await db.taskExecution.update({
          where: { executionId: execId },
          data: { status: 'running' },
        }).catch(() => { /* 忽略更新失败 */ });
      }

      res.json({ questionId: currentQuestionId, status: 'answered', answer: result.answer });
    } else if (result.status === 'pending') {
      res.json({ questionId: currentQuestionId, status: 'pending', continue: true });
    } else {
      res.status(504).json({
        questionId: currentQuestionId,
        status: 'timeout',
        error: '等待人类回答超时'
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: '处理 inbox_ask 失败', detail: errorMsg });
  }
});
```

- [ ] **Step 2: 添加导入**

确保文件顶部有：

```typescript
import { pollForAnswer } from '../graph/session-control-v2.mjs';
```

- [ ] **Step 3: 验证编译**

```bash
cd packages/core
pnpm build
```

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/routes/internal.mts
git commit -m "feat: internal/inbox-ask 端点支持长轮询分片模式"
```

---

### Task 4: MCP Bridge 修改

**Files:**
- Modify: `packages/runner/src/mcp-bridge.ts`

**Interfaces:**
- Produces: `handleInboxAskViaHttp` 使用循环调用

- [ ] **Step 1: 修改 handleInboxAskViaHttp 函数**

找到现有的 `handleInboxAskViaHttp` 函数并替换为：

```typescript
/**
 * 通过 HTTP 长轮询分片等待人类回答
 */
async function handleInboxAskViaHttp(question: string, choices?: string[]): Promise<string> {
  const apiUrl = process.env.XUANJI_API_URL || 'http://localhost:3000';
  const executionId = process.env.XUANJI_EXECUTION_ID;

  if (!executionId) {
    throw new Error('XUANJI_EXECUTION_ID 环境变量未设置');
  }

  let questionId: string | null = null;
  let isFirst = true;
  const maxAttempts = 24 * 60 * 2; // 24小时 / 30秒 = 2880 次
  let attempts = 0;

  // 循环调用直到收到回答
  while (attempts < maxAttempts) {
    attempts++;

    const body: Record<string, any> = isFirst
      ? { create: true, executionId, question, choices }
      : { questionId };

    try {
      const response = await fetch(`${apiUrl}/api/internal/inbox-ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // 单次请求超时 35 秒（略大于服务端 30 秒）
        signal: AbortSignal.timeout(35_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`inbox-ask 请求失败: ${response.status} ${errorText}`);
      }

      const result = await response.json() as {
        questionId: string;
        status: 'answered' | 'pending' | 'timeout';
        answer?: string;
        continue?: boolean;
        error?: string;
      };

      if (result.status === 'answered' && result.answer) {
        return result.answer;
      }

      if (result.status === 'timeout') {
        throw new Error(result.error || '等待人类回答超时');
      }

      // 继续轮询
      questionId = result.questionId;
      isFirst = false;

    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        // 单次请求超时，继续重试
        console.warn('[mcp-bridge] 单次轮询超时，继续重试...');
        continue;
      }
      throw err;
    }
  }

  throw new Error('等待人类回答超时（超过 24 小时）');
}
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/runner
pnpm build
```

- [ ] **Step 3: 提交**

```bash
git add packages/runner/src/mcp-bridge.ts
git commit -m "feat: MCP Bridge 使用长轮询分片模式"
```

---

### Task 5: 孤儿检测服务

**Files:**
- Create: `packages/core/src/graph/orphan-detection.mts`

**Interfaces:**
- Produces: `recoverOrphanedQuestions()`, `startPeriodicCleanup()`

- [ ] **Step 1: 创建孤儿检测模块**

```typescript
// packages/core/src/graph/orphan-detection.mts
// 孤儿问题检测和恢复服务
//
// 服务启动时运行，检测超时未回答的问题并恢复状态。
// 支持定期清理任务。

import { db } from '../db.mjs';

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * 孤儿问题检测和恢复
 *
 * 服务启动时运行，检测超时未回答的问题并恢复状态。
 */
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

    if (!exec) {
      // 无关联执行，标记为 timeout
      await db.inboxQuestion.update({
        where: { id: orphan.id },
        data: { status: 'timeout' },
      });
      console.log(`[orphan-detection] 问题 ${orphan.id} 标记为 timeout（无关联执行）`);
      continue;
    }

    if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled') {
      // 执行已完成但问题仍 pending，标记为 timeout
      await db.inboxQuestion.update({
        where: { id: orphan.id },
        data: { status: 'timeout' },
      });
      console.log(`[orphan-detection] 问题 ${orphan.id} 标记为 timeout（执行已${exec.status}）`);
    } else if (exec.status === 'running') {
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
 * 定期清理任务
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

- [ ] **Step 2: 验证编译**

```bash
cd packages/core
pnpm build
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/graph/orphan-detection.mts
git commit -m "feat: 添加孤儿问题检测和恢复服务"
```

---

### Task 6: 启动入口集成

**Files:**
- Modify: `packages/core/src/index.mts`

**Interfaces:**
- Consumes: `recoverOrphanedQuestions()`, `startPeriodicCleanup()`

- [ ] **Step 1: 添加孤儿检测调用**

在 `index.mts` 的启动逻辑中添加（在服务器启动后）：

```typescript
// 导入孤儿检测模块
import { recoverOrphanedQuestions, startPeriodicCleanup } from './graph/orphan-detection.mjs';

// 在服务器启动后添加
// 启动时运行孤儿检测
recoverOrphanedQuestions().catch(err => {
  console.error('[startup] 孤儿检测失败:', err);
});

// 启动定期清理
startPeriodicCleanup();
```

- [ ] **Step 2: 验证编译和启动**

```bash
cd packages/core
pnpm build
pnpm start
# 检查日志是否有 "[orphan-detection] 开始检测孤儿问题..."
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/index.mts
git commit -m "feat: 启动时调用孤儿检测服务"
```

---

### Task 7: graph-runner 状态同步

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts`

**Interfaces:**
- Produces: 执行完成前检查 pending 问题

- [ ] **Step 1: 添加 checkPendingQuestions 函数**

在 `startExecution` 函数中，找到执行完成的部分，添加检查逻辑：

```typescript
// 在 onFlowComplete 函数附近添加

/**
 * 检查执行是否有待回答的问题
 */
async function checkPendingQuestions(executionId: string): Promise<boolean> {
  const count = await db.inboxQuestion.count({
    where: { executionId, status: 'pending' },
  });
  return count > 0;
}
```

- [ ] **Step 2: 修改执行完成逻辑**

找到 `await executionStore.complete(executionId, '流程执行完成');` 这一行，修改为：

```typescript
// 在标记完成前检查是否有 pending 问题
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

- [ ] **Step 3: 验证编译**

```bash
cd packages/core
pnpm build
```

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/graph/graph-runner.mts
git commit -m "feat: 执行完成前检查 pending 问题，状态同步"
```

---

### Task 8: SSE 状态处理

**Files:**
- Modify: `packages/core/src/routes/executions.mts`

**Interfaces:**
- Produces: SSE 正确处理 waiting 状态

- [ ] **Step 1: 修改 SSE 轮询逻辑**

找到 `executionsRouter.get('/:id/stream', ...)` 中的状态检查部分，确保 `waiting` 状态不关闭 SSE：

```typescript
// 在 pollInterval 的回调中，找到状态检查部分

if (!exec || exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled') {
  // 只有这四种状态才关闭 SSE
  res.write(`data: {"type":"execution_done","status":"${exec?.status || 'unknown'}"}\n\n`);
  clearInterval(pollInterval);
  res.end();
  return;
}

// waiting 和 running 状态继续轮询
```

- [ ] **Step 2: 添加 waiting 状态到 SSE 推送**

确保 `waiting` 状态触发 fetchElicitations：

```typescript
// 在 execution_done 事件处理中
if (d.type === 'execution_done') {
  setState('open');
  if (d.status === 'waiting' || d.status === 'paused') {
    fetchElicitations();
  }
  return;
}
```

- [ ] **Step 3: 验证编译**

```bash
cd packages/core
pnpm build
```

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/routes/executions.mts
git commit -m "fix: SSE 正确处理 waiting 状态"
```

---

### Task 9: 端到端测试

**Files:**
- 无新建文件，手动测试

**Interfaces:**
- 验证整体功能

- [ ] **Step 1: 启动服务**

```bash
# 终端 1: PostgreSQL
docker start <postgres-container>

# 终端 2: Core API
cd packages/core
pnpm start

# 终端 3: Dashboard
cd packages/dashboard
pnpm dev
```

- [ ] **Step 2: 测试服务重启恢复**

1. 创建需求执行，触发 inbox_ask
2. 在数据库中验证 `inbox_questions` 表有 `status='pending'` 记录
3. 重启 Core 服务
4. 验证孤儿检测日志
5. 在 Dashboard 回答问题
6. 验证 Agent 收到回答

- [ ] **Step 3: 测试执行状态一致性**

1. 创建需求执行，触发 inbox_ask
2. 验证执行状态为 'waiting'
3. 回答问题后验证状态恢复为 'running'

- [ ] **Step 4: 测试 SSE 实时推送**

1. 打开 Canvas 页面
2. 触发 inbox_ask
3. 在另一个标签页回答问题
4. 验证 UI 自动更新

- [ ] **Step 5: 提交测试结果**

```bash
# 如果测试通过
git add -A
git commit -m "test: 人机交互状态持久化端到端测试通过"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| 需求 | 任务 | 状态 |
|------|------|------|
| inbox_questions 表扩展 | Task 1 | ✅ |
| pollForAnswer 函数 | Task 2 | ✅ |
| internal.mts 长轮询分片 | Task 3 | ✅ |
| MCP Bridge 循环调用 | Task 4 | ✅ |
| 孤儿检测服务 | Task 5 | ✅ |
| 启动入口集成 | Task 6 | ✅ |
| graph-runner 状态同步 | Task 7 | ✅ |
| SSE waiting 状态处理 | Task 8 | ✅ |
| 端到端测试 | Task 9 | ✅ |

### 2. Placeholder Scan

- 无 "TBD" 或 "TODO"
- 无 "implement later"
- 无 "similar to Task N"
- 所有代码步骤包含实际代码

### 3. Type Consistency

- `pollForAnswer` 返回 `PollResult` 在所有任务中一致
- `questionId` 类型为 `string` 在所有任务中一致
- 状态值 `'answered' | 'pending' | 'timeout'` 在所有任务中一致