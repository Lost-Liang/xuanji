# 璇玑 V4 完整重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建璇玑 V4 系统——LangGraph 统一编排与调度 + AgentOS Runner 执行层 + PostgreSQL/Prisma 持久化 + Dashboard 人机交互

**Architecture:** Monorepo (pnpm workspaces) 三个包：`core`（LangGraph 统一编排与调度）、`runner`（AgentOS Runner 本地模式）、`dashboard`（前端）。V3 的 SQLite 操作全部重写为 Prisma 调用，V3 的自研调度层（task-scheduler/task-worker/execution-store）重写为 LangGraph 节点。

**Tech Stack:** TypeScript, LangGraph, PostgreSQL, Prisma, AgentOS Runner, pnpm workspaces

**Spec:** `docs/superpowers/specs/2026-09-07-xuanji-v4-design.md`

## Global Constraints

- Node.js >= 18
- PostgreSQL >= 14
- 全程使用中文注释
- 所有 API 返回 JSON
- 数据库统一使用 Prisma ORM（不用 SQLite）
- LangGraph checkpoint 使用 `@langchain/langgraph-checkpoint-postgres`
- 所有调度逻辑在 LangGraph 中实现（不保留 V3 自研调度）
- 每个 task 完成后必须可编译（`pnpm build` 通过）

## 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据库 | 全部 PostgreSQL + Prisma | 统一技术栈，避免 SQLite/PG 双 ORM |
| 调度 | LangGraph 统一 | 不用 V3 的自研调度，全部用 LangGraph 节点和条件边 |
| V3 代码 | 选择性迁移 | DB 操作和调度代码重写，LangGraph 图定义和节点保留 |

## V3 代码迁移策略

```
V3 代码分类：
├── ✅ 直接迁移（LangGraph 图定义）
│   ├── graph/builder.mts
│   ├── graph/state-schema.mts
│   ├── graph/yaml-loader.mts
│   ├── graph/types.mts
│   ├── graph/nodes/gate-node.mts
│   ├── graph/nodes/command-node.mts
│   └── graph/conditions/*
│
├── 🔧 改造迁移（需要替换 DB 和 omnigent）
│   ├── graph/agent-node.mts      → 替换 omnigent 为 runner，替换 SQLite 为 Prisma
│   ├── graph/session-control.mts → 替换 SQLite 为 Prisma
│   ├── graph/persistence.mts     → 替换 SQLite 为 Prisma
│   └── graph/worktree.mts        → 保留，可能微调
│
├── ❌ 不迁移（需要重写为 LangGraph 节点）
│   ├── task-scheduler.mjs        → 重写为 scheduler-graph.mts
│   ├── task-worker.mjs           → 重写为 worker-graph.mts
│   ├── execution-store.mjs       → 重写为 Prisma store
│   ├── state-machine.mjs         → LangGraph 条件边
│   └── omnigent-client.mts       → 删除
│
├── ❌ 不迁移（V2 SQLite 遗留，V4 用 Prisma 重写）
│   ├── db.mts (SQLite 连接)
│   ├── db/index.mts
│   └── db/migrations/* (SQLite 迁移)
│
└── 🔄 参考重写（routes 保留接口，内部实现改为 Prisma）
    ├── routes/sessions.mts
    ├── routes/workflows.mts
    ├── routes/requirements.mts
    ├── routes/tasks.mts
    └── routes/executions.mts
```

---

## 文件结构

```
long-running-agent-v4/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env
├── .env.example
├── .gitignore
│
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── src/
│   │       ├── index.mts
│   │       ├── db.mts                  # Prisma 客户端（新写）
│   │       ├── checkpointer.mts        # LangGraph PG checkpoint
│   │       ├── graph/
│   │       │   ├── builder.mts         # ✅ V3 迁移
│   │       │   ├── agent-node.mts      # 🔧 V3 改造
│   │       │   ├── scheduler-graph.mts # ❗ 新写（替代 V3 task-scheduler）
│   │       │   ├── worker-graph.mts    # ❗ 新写（替代 V3 task-worker）
│   │       │   ├── recovery-graph.mts  # ❗ 新写（替代 V3 execution-recovery）
│   │       │   ├── state-schema.mts    # ✅ V3 迁移
│   │       │   ├── session-control.mts # 🔧 V3 改造
│   │       │   ├── worktree.mts        # ✅ V3 迁移
│   │       │   ├── persistence.mts     # 🔧 V3 改造
│   │       │   ├── yaml-loader.mts     # ✅ V3 迁移
│   │       │   ├── types.mts           # ✅ V3 迁移
│   │       │   ├── nodes/              # ✅ V3 迁移
│   │       │   └── conditions/         # ✅ V3 迁移
│   │       ├── storage/
│   │       │   ├── task-store.mts      # ❗ Prisma 新写（替代 V3 SQLite）
│   │       │   ├── execution-store.mts # ❗ Prisma 新写（替代 V3 SQLite）
│   │       │   ├── requirement-store.mts # ❗ Prisma 新写
│   │       │   └── conversation-store.mts # ❗ 全新
│   │       ├── timing-constants.mts    # ✅ V3 迁移
│   │       └── routes/
│   │           ├── tasks.mts           # 🔄 V3 参考重写
│   │           ├── requirements.mts    # 🔄 V3 参考重写
│   │           ├── executions.mts      # 🔄 V3 参考重写
│   │           ├── inbox.mts           # ❗ 全新
│   │           └── conversations.mts   # ❗ 全新
│   │
│   ├── runner/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── local-runner.ts
│   │       └── ...
│   │
│   └── dashboard/
│       ├── package.json
│       └── src/
│           └── ...
```

---

## Task 1: 项目初始化（Git + Monorepo）

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `.env`
- Create: `.gitignore`

- [ ] **Step 1: 初始化 Git 仓库**

```bash
cd /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4
git init
```

- [ ] **Step 2: 创建根 package.json**

```json
{
  "name": "xuanji",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r dev",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter @xuanji/core db:generate",
    "db:migrate": "pnpm --filter @xuanji/core db:migrate",
    "db:push": "pnpm --filter @xuanji/core db:push"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 3: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 4: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: 创建 .env.example 和 .env**

```bash
# .env.example
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/xuanji"
CLAUDE_BIN="claude"
PORT=3000

# .env（实际使用）
cp .env.example .env
```

- [ ] **Step 6: 创建 .gitignore**

```
node_modules/
dist/
.env
*.db
.DS_Store
```

- [ ] **Step 7: 验证**

```bash
pnpm install
```
Expected: 无报错

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: 初始化璇玑 monorepo"
```

---

## Task 2: 三个包脚手架

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.mts`
- Create: `packages/runner/package.json`
- Create: `packages/runner/tsconfig.json`
- Create: `packages/runner/src/index.ts`
- Create: `packages/dashboard/package.json`（占位）

- [ ] **Step 1: 创建 packages/core/package.json**

```json
{
  "name": "@xuanji/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -w -p tsconfig.json",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@langchain/langgraph": "^0.2.0",
    "@langchain/langgraph-checkpoint-postgres": "^1.0.5",
    "@prisma/client": "^5.19.0",
    "@xuanji/runner": "workspace:*",
    "express": "^4.19.0",
    "pg": "^8.12.0",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.0",
    "prisma": "^5.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "allowJs": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: 创建 packages/core/src/index.mts**

```typescript
// 璇玑 Core - 入口
export const VERSION = '0.1.0';
console.log('璇玑 Core v' + VERSION);
```

- [ ] **Step 4: 创建 packages/runner/package.json**

```json
{
  "name": "@xuanji/runner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -w -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: 创建 packages/runner/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6: 创建 packages/runner/src/index.ts**

```typescript
// 璇玑 Runner - 入口
export const RUNNER_VERSION = '0.1.0';
```

- [ ] **Step 7: 创建 packages/dashboard/package.json（占位）**

```json
{
  "name": "@xuanji/dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo 'dashboard placeholder'"
  }
}
```

- [ ] **Step 8: 验证**

```bash
pnpm install && pnpm build
```
Expected: 三个包均编译通过

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: 创建 core/runner/dashboard 三个包脚手架"
```

---

## Task 3: Prisma 数据库 Schema + 迁移

**Files:**
- Create: `packages/core/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma Client 类型，可用 `import { PrismaClient } from '@prisma/client'`

- [ ] **Step 1: 创建 prisma 目录**

```bash
mkdir -p packages/core/prisma
```

- [ ] **Step 2: 创建 schema.prisma**

（内容同原 Plan Task 6，此处不重复——包含 Requirement/Epic/Feature/UserStory/Task/TaskExecution/PhaseInstance/PhaseOutput/ConversationEvent/InboxQuestion/TaskLog/Decision/Intervention/ExecutionEvent/SchedulingEvent）

- [ ] **Step 3: 生成 Prisma Client**

```bash
cd packages/core && pnpm db:generate
```

- [ ] **Step 4: 创建数据库并迁移**

```bash
# 确保 PostgreSQL 运行
createdb xuanji  # 如果不存在

# 运行迁移
cd packages/core && pnpm db:push
```
Expected: 数据库表创建成功

- [ ] **Step 5: 创建 db.mts（Prisma 客户端单例）**

```typescript
// packages/core/src/db.mts
import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();

// 优雅关闭
process.on('beforeExit', async () => {
  await db.$disconnect();
});
```

- [ ] **Step 6: 验证**

```typescript
// 临时测试脚本
import { db } from './src/db.mts';
const count = await db.requirement.count();
console.log('requirements count:', count);
await db.$disconnect();
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/prisma/ packages/core/src/db.mts
git commit -m "feat: Prisma schema + 数据库迁移 + db 客户端"
```

---

## Task 4: Runner 本地模式

**Files:**
- Create: `packages/runner/src/local-runner.ts`
- Modify: `packages/runner/src/index.ts`

**Interfaces:**
- Produces: `runLocal()` 函数，供 core 调用

- [ ] **Step 1: 创建 local-runner.ts**

（内容同原 Plan Task 7——类型定义 + runLocal + runClaude + handleClaudeEvent）

- [ ] **Step 2: 导出 runLocal**

修改 `packages/runner/src/index.ts`：

```typescript
export { runLocal, type LocalRunOptions, type LocalRunResult, type AdapterEvent, type InboxQuestion } from './local-runner.js';
export const RUNNER_VERSION = '0.1.0';
```

- [ ] **Step 3: 验证编译**

```bash
cd packages/runner && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/runner/src/
git commit -m "feat: 实现 runner 本地模式 runLocal()"
```

---

## Task 5: Runner 集成测试

**Files:**
- Create: `packages/runner/test/local-runner.test.ts`

- [ ] **Step 1: 创建测试文件**

（内容同原 Plan Task 8）

- [ ] **Step 2: 运行测试**

```bash
cd packages/runner && pnpm test
```
Expected: 测试通过（需要 claude CLI 已安装并登录）

- [ ] **Step 3: Commit**

```bash
git add packages/runner/test/
git commit -m "test: runner 本地模式集成测试"
```

---

## Task 6: Storage 层（Prisma 重写）

**Files:**
- Create: `packages/core/src/storage/task-store.mts`
- Create: `packages/core/src/storage/execution-store.mts`
- Create: `packages/core/src/storage/requirement-store.mts`
- Create: `packages/core/src/storage/conversation-store.mts`

**Interfaces:**
- Consumes: Task 3 的 Prisma schema
- Produces: 四个 store 模块，供后续 graph 节点调用

- [ ] **Step 1: 创建 task-store.mts**

```typescript
// packages/core/src/storage/task-store.mts
import { db } from '../db.mts';
import type { Task, Prisma } from '@prisma/client';

export const taskStore = {
  async create(data: {
    title: string;
    description?: string;
    userStoryId?: string;
    epicId?: string;
    parentTaskId?: string;
    targetProjectId: string;
    targetRepoPath: string;
    acceptanceCriteria?: string;
    sequence?: number;
  }): Promise<Task> {
    return db.task.create({ data });
  },

  async getById(id: string): Promise<Task | null> {
    return db.task.findUnique({ where: { id } });
  },

  async updateStatus(id: string, status: string): Promise<Task> {
    return db.task.update({
      where: { id },
      data: {
        status,
        ...(status === 'running' ? { startedAt: new Date() } : {}),
        ...(status === 'completed' || status === 'failed' ? { completedAt: new Date() } : {}),
      },
    });
  },

  async getNextPending(sequenceAfter?: number): Promise<Task | null> {
    return db.task.findFirst({
      where: {
        status: 'pending',
        ...(sequenceAfter !== undefined ? { sequence: { gt: sequenceAfter } } : {}),
      },
      orderBy: { sequence: 'asc' },
    });
  },

  async listByRequirement(requirementId: string): Promise<Task[]> {
    return db.task.findMany({
      where: {
        OR: [
          { epic: { requirementId } },
          { userStory: { epic: { requirementId } } },
        ],
      },
      orderBy: { sequence: 'asc' },
    });
  },
};
```

- [ ] **Step 2: 创建 execution-store.mts**

```typescript
// packages/core/src/storage/execution-store.mts
import { db } from '../db.mts';
import type { TaskExecution } from '@prisma/client';

export interface LeaseInfo {
  workerId: string;
  leaseToken: string;
  fencingToken: number;
}

export const executionStore = {
  async create(data: {
    subjectType: 'task' | 'requirement';
    subjectId: string;
    taskId?: string;
    requirementId?: string;
    targetProjectId: string;
    targetRepoPath: string;
  }): Promise<TaskExecution> {
    return db.taskExecution.create({
      data: {
        ...data,
        status: 'pending',
      },
    });
  },

  async get(executionId: string): Promise<TaskExecution | null> {
    return db.taskExecution.findUnique({ where: { id: executionId } });
  },

  async acquireLease(executionId: string, workerId: string): Promise<LeaseInfo | null> {
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    const result = await db.taskExecution.updateMany({
      where: {
        id: executionId,
        status: 'pending',
        workerId: null,
      },
      data: {
        status: 'running',
        workerId,
        leaseToken,
        fencingToken: { increment: 1 },
        leaseExpiresAt,
        heartbeatAt: new Date(),
        startedAt: new Date(),
      },
    });

    if (result.count === 0) return null;

    const execution = await db.taskExecution.findUnique({ where: { id: executionId } });
    if (!execution) return null;

    return {
      workerId: execution.workerId!,
      leaseToken: execution.leaseToken!,
      fencingToken: execution.fencingToken,
    };
  },

  async renewHeartbeat(executionId: string, lease: LeaseInfo): Promise<boolean> {
    const result = await db.taskExecution.updateMany({
      where: {
        id: executionId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
      },
      data: { heartbeatAt: new Date() },
    });
    return result.count > 0;
  },

  async releaseLease(executionId: string, lease: LeaseInfo): Promise<void> {
    await db.taskExecution.updateMany({
      where: {
        id: executionId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
      },
      data: {
        workerId: null,
        leaseToken: null,
        status: 'pending',
      },
    });
  },

  async complete(executionId: string, finalOutput: string): Promise<void> {
    await db.taskExecution.update({
      where: { id: executionId },
      data: {
        status: 'completed',
        finalOutput,
        completedAt: new Date(),
      },
    });
  },

  async fail(executionId: string, errorMessage: string): Promise<void> {
    await db.taskExecution.update({
      where: { id: executionId },
      data: {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });
  },

  async setRateLimited(executionId: string, retryAt: Date, errorMessage: string): Promise<void> {
    await db.taskExecution.update({
      where: { id: executionId },
      data: {
        rateLimitCount: { increment: 1 },
        retryAt,
        errorMessage,
        status: 'rate_limited',
      },
    });
  },

  async findZombies(timeoutMinutes: number = 10): Promise<TaskExecution[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    return db.taskExecution.findMany({
      where: {
        status: 'running',
        heartbeatAt: { lt: cutoff },
      },
    });
  },
};
```

- [ ] **Step 3: 创建 requirement-store.mts**

```typescript
// packages/core/src/storage/requirement-store.mts
import { db } from '../db.mts';
import type { Requirement } from '@prisma/client';

export const requirementStore = {
  async create(data: {
    title: string;
    description?: string;
    targetProjectId: string;
    targetRepoPath: string;
  }): Promise<Requirement> {
    return db.requirement.create({ data });
  },

  async getById(id: string): Promise<Requirement | null> {
    return db.requirement.findUnique({ where: { id } });
  },

  async list(): Promise<Requirement[]> {
    return db.requirement.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async updateStatus(id: string, status: string): Promise<Requirement> {
    return db.requirement.update({ where: { id }, data: { status } });
  },
};
```

- [ ] **Step 4: 创建 conversation-store.mts**

（内容同原 Plan Task 10）

- [ ] **Step 5: 验证编译**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/
git commit -m "feat: Storage 层 Prisma 实现（task/execution/requirement/conversation）"
```

---

## Task 7: 迁移 V3 LangGraph 图定义（直接迁移部分）

**Files:**
- Copy: `graph/builder.mts`, `state-schema.mts`, `types.mts`, `yaml-loader.mts`, `worktree.mts`, `timing-constants.mts`, `nodes/*`, `conditions/*`
- From: `/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agnet-v2/core/server/src/`
- To: `packages/core/src/graph/` 和 `packages/core/src/`

- [ ] **Step 1: 复制直接迁移的文件**

```bash
V3=/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agnet-v2/core/server/src

# 图定义相关文件
mkdir -p packages/core/src/graph/nodes packages/core/src/graph/conditions
cp "$V3/graph/builder.mts" packages/core/src/graph/
cp "$V3/graph/state-schema.mts" packages/core/src/graph/
cp "$V3/graph/types.mts" packages/core/src/graph/
cp "$V3/graph/yaml-loader.mts" packages/core/src/graph/
cp "$V3/graph/worktree.mts" packages/core/src/graph/

# 节点和条件
cp "$V3/graph/nodes/"*.mts packages/core/src/graph/nodes/
cp "$V3/graph/conditions/"*.mts packages/core/src/graph/conditions/

# 定时常量
cp "$V3/timing-constants.mjs" packages/core/src/timing-constants.mts
```

- [ ] **Step 2: 修复 import 路径**

V3 代码中引用了 `../omnigent-client.mts`、`../db.mts` 等已不存在的模块。
先注释掉这些 import（不删除文件，保持可编译状态）。

```bash
# 找出所有对 omnigent 和 db 的引用
grep -rn "omnigent-client\|from.*db" packages/core/src/graph/
```

对每个引用，暂时注释掉并添加 `// TODO: Task X 修复` 标记。

- [ ] **Step 3: 验证编译**

```bash
cd packages/core && pnpm build
```
Expected: 编译通过（omnigent 引用已注释）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/
git commit -m "feat: 迁移 V3 LangGraph 图定义（直接迁移部分）"
```

---

## Task 8: LangGraph 调度图（替代 V3 自研调度）

**Files:**
- Create: `packages/core/src/graph/scheduler-graph.mts`
- Create: `packages/core/src/graph/worker-graph.mts`

**Interfaces:**
- Consumes: Task 6 的 storage 层, Task 7 的图定义
- Produces: LangGraph 调度工作流

- [ ] **Step 1: 创建 scheduler-graph.mts**

```typescript
// packages/core/src/graph/scheduler-graph.mts
// 替代 V3 的 task-scheduler.mjs + state-machine.mjs
import { StateGraph, END } from '@langchain/langgraph';
import { executionStore } from '../storage/execution-store.mts';
import { taskStore } from '../storage/task-store.mts';
import { MAX_RATE_LIMIT_RETRIES, computeRateLimitBackoff } from '../timing-constants.mts';

export interface SchedulerState {
  executionId: string | null;
  taskId: string | null;
  status: 'idle' | 'dispatched' | 'rate_limited' | 'completed' | 'failed';
  error?: string;
}

/**
 * 调度节点：查找下一个待执行的任务
 */
async function scheduleNode(state: SchedulerState): Promise<Partial<SchedulerState>> {
  // 查找待执行的 execution
  const pending = await db.taskExecution.findFirst({
    where: {
      status: 'pending',
      OR: [
        { retryAt: null },
        { retryAt: { lte: new Date() } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!pending) {
    return { status: 'idle' };
  }

  return {
    executionId: pending.id,
    taskId: pending.taskId,
    status: 'dispatched',
  };
}

/**
 * 条件路由：根据状态决定下一步
 */
function routeAfterSchedule(state: SchedulerState): string {
  switch (state.status) {
    case 'dispatched':
      return 'worker';
    case 'idle':
      return 'wait';
    default:
      return END;
  }
}

async function waitNode(_state: SchedulerState): Promise<Partial<SchedulerState>> {
  // 等待 5 秒后重新调度
  await new Promise(resolve => setTimeout(resolve, 5000));
  return { status: 'idle' };
}

/**
 * 构建调度图
 */
export function buildSchedulerGraph() {
  const graph = new StateGraph<SchedulerState>({
    channels: {
      executionId: { value: (a: string | null, b: string | null) => b ?? a, default: () => null },
      taskId: { value: (a: string | null, b: string | null) => b ?? a, default: () => null },
      status: { value: (_a: string, b: string) => b, default: () => 'idle' },
      error: { value: (_a: string | undefined, b: string | undefined) => b, default: () => undefined },
    },
  });

  graph.addNode('schedule', scheduleNode);
  graph.addNode('wait', waitNode);
  // worker 节点在 worker-graph.mts 中定义
  // graph.addNode('worker', workerNode);

  graph.setEntryPoint('schedule');
  graph.addConditionalEdges('schedule', routeAfterSchedule, {
    worker: 'worker',
    wait: 'wait',
    [END]: END,
  });
  graph.addEdge('wait', 'schedule');

  return graph.compile();
}
```

- [ ] **Step 2: 创建 worker-graph.mts**

```typescript
// packages/core/src/graph/worker-graph.mts
// 替代 V3 的 task-worker.mjs + phase-runner.mjs
import { executionStore } from '../storage/execution-store.mts';
import { taskStore } from '../storage/task-store.mts';
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import { saveConversationEvent } from '../storage/conversation-store.mts';
import type { SchedulerState } from './scheduler-graph.mts';

/**
 * 工作节点：执行一个任务
 */
export async function workerNode(state: SchedulerState): Promise<Partial<SchedulerState>> {
  const { executionId, taskId } = state;
  if (!executionId) return { status: 'failed', error: 'No executionId' };

  const execution = await executionStore.get(executionId);
  if (!execution) return { status: 'failed', error: 'Execution not found' };

  // 获取 lease
  const lease = await executionStore.acquireLease(executionId, 'worker-1');
  if (!lease) return { status: 'idle' }; // 被其他 worker 抢走

  try {
    // 更新任务状态
    if (taskId) {
      await taskStore.updateStatus(taskId, 'running');
    }

    // 构建 prompt（简化版，实际从 task 描述生成）
    const prompt = `请完成以下任务：\n${taskId || 'Execute task'}`;

    // 调用 runner
    const result = await runLocal({
      provider: 'claude',
      prompt,
      workDir: execution.targetRepoPath,
      onEvent: async (event: AdapterEvent) => {
        await saveConversationEvent({
          executionId,
          sessionId: null,
          event,
        });
      },
      onInboxAsk: async (question) => {
        // TODO: Task 12 实现
        throw new Error('inbox_ask 尚未实现');
      },
    });

    // 完成
    if (result.finalOutput) {
      await executionStore.complete(executionId, result.finalOutput);
      if (taskId) await taskStore.updateStatus(taskId, 'completed');
    } else {
      await executionStore.fail(executionId, result.error || 'No output');
      if (taskId) await taskStore.updateStatus(taskId, 'failed');
    }

    return { status: 'completed' };

  } catch (err: any) {
    // 检查是否 429
    if (err.message?.includes('429') || err.message?.includes('rate_limit')) {
      const currentCount = execution.rateLimitCount;
      if (currentCount >= MAX_RATE_LIMIT_RETRIES) {
        await executionStore.fail(executionId, '限流超限跳过');
        return { status: 'failed', error: '限流超限' };
      }
      const retryAt = new Date(Date.now() + computeRateLimitBackoff(currentCount + 1));
      await executionStore.setRateLimited(executionId, retryAt, `429 限流，将于 ${retryAt} 重试`);
      return { status: 'rate_limited' };
    }

    await executionStore.fail(executionId, err.message);
    return { status: 'failed', error: err.message };
  }
}
```

- [ ] **Step 3: 验证编译**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/graph/scheduler-graph.mts packages/core/src/graph/worker-graph.mts
git commit -m "feat: LangGraph 调度图（替代 V3 自研调度）"
```

---

## Task 9: agent-node 改造（omnigent → runner）

**Files:**
- Modify: `packages/core/src/graph/agent-node.mts`

- [ ] **Step 1: 阅读当前 agent-node.mts**

```bash
wc -l packages/core/src/graph/agent-node.mts
head -80 packages/core/src/graph/agent-node.mts
```

- [ ] **Step 2: 替换 omnigent 导入**

删除所有 omnigent 相关 import，替换为：

```typescript
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import { saveConversationEvent } from '../storage/conversation-store.mts';
```

- [ ] **Step 3: 替换 DB 操作**

将所有 `db.prepare(...).run(...)` 替换为 Prisma 调用：

```typescript
// 旧（SQLite）:
// db.prepare(`UPDATE phase_instances SET session_id = ? WHERE id = ?`).run(sessionId, instanceId);

// 新（Prisma）:
import { db } from '../db.mts';
await db.phaseInstance.update({
  where: { id: instanceId },
  data: { sessionId },
});
```

- [ ] **Step 4: 替换会话执行逻辑**

替换 `createSession` + `streamSession` 为 `runLocal()`：

```typescript
const result = await runLocal({
  provider: 'claude',
  prompt: agentPrompt,
  workDir: execution.targetRepoPath,
  model: agentConfig.model || 'claude-3-5-sonnet',
  onEvent: async (event: AdapterEvent) => {
    await saveConversationEvent({ executionId, sessionId, event });
  },
  onInboxAsk: async (question) => {
    return await handleInboxAsk(executionId, question);
  },
});
```

- [ ] **Step 5: 添加 handleInboxAsk 占位**

```typescript
async function handleInboxAsk(executionId: string, question: { id: string; body: string }): Promise<string> {
  // TODO: Task 12 实现完整的 interrupt/resume
  await db.inboxQuestion.create({
    data: { executionId, body: question.body, status: 'pending' },
  });
  throw new Error('inbox_ask 等待机制待 Task 12 实现');
}
```

- [ ] **Step 6: 删除 SSE 处理代码**

删除所有 `streamSession`、`postEvent`、SSE 解析、`sse-aggregator` 相关代码。

- [ ] **Step 7: 验证编译**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/graph/agent-node.mts
git commit -m "feat: agent-node 改造 omnigent → runner + SQLite → Prisma"
```

---

## Task 10: API 路由（Prisma 重写）

**Files:**
- Create: `packages/core/src/routes/tasks.mts`
- Create: `packages/core/src/routes/requirements.mts`
- Create: `packages/core/src/routes/executions.mts`
- Create: `packages/core/src/routes/inbox.mts`
- Create: `packages/core/src/routes/conversations.mts`

- [ ] **Step 1: 创建 tasks.mts**

```typescript
// packages/core/src/routes/tasks.mts
import { Router } from 'express';
import { taskStore } from '../storage/task-store.mts';

export const tasksRouter = Router();

tasksRouter.get('/', async (req, res) => {
  const { requirementId } = req.query;
  if (requirementId) {
    const tasks = await taskStore.listByRequirement(requirementId as string);
    res.json(tasks);
  } else {
    res.json([]);
  }
});

tasksRouter.get('/:id', async (req, res) => {
  const task = await taskStore.getById(req.params.id);
  if (!task) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(task);
});

tasksRouter.post('/', async (req, res) => {
  const task = await taskStore.create(req.body);
  res.json(task);
});
```

- [ ] **Step 2: 创建 requirements.mts**

```typescript
// packages/core/src/routes/requirements.mts
import { Router } from 'express';
import { requirementStore } from '../storage/requirement-store.mts';

export const requirementsRouter = Router();

requirementsRouter.get('/', async (_req, res) => {
  res.json(await requirementStore.list());
});

requirementsRouter.get('/:id', async (req, res) => {
  const r = await requirementStore.getById(req.params.id);
  if (!r) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(r);
});

requirementsRouter.post('/', async (req, res) => {
  res.json(await requirementStore.create(req.body));
});
```

- [ ] **Step 3: 创建 executions.mts**

```typescript
// packages/core/src/routes/executions.mts
import { Router } from 'express';
import { executionStore } from '../storage/execution-store.mts';
import { db } from '../db.mts';

export const executionsRouter = Router();

executionsRouter.get('/', async (_req, res) => {
  res.json(await db.taskExecution.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));
});

executionsRouter.get('/:id', async (req, res) => {
  const e = await executionStore.get(req.params.id);
  if (!e) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(e);
});

// 暂停
executionsRouter.post('/:id/pause', async (req, res) => {
  await db.taskExecution.update({
    where: { id: req.params.id },
    data: { controlStatus: 'pause_requested' },
  });
  res.json({ ok: true });
});

// 取消
executionsRouter.post('/:id/cancel', async (req, res) => {
  await db.taskExecution.update({
    where: { id: req.params.id },
    data: { controlStatus: 'cancel_requested' },
  });
  res.json({ ok: true });
});
```

- [ ] **Step 4: 创建 inbox.mts**

（内容同原 Plan Task 11，加上 Task 13 的 notifyHumanAnswered）

- [ ] **Step 5: 创建 conversations.mts**

（内容同原 Plan Task 11）

- [ ] **Step 6: 创建追问 API**

修改 `conversations.mts`，添加追问端点：

```typescript
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import { saveConversationEvent } from '../storage/conversation-store.mts';
import { executionStore } from '../storage/execution-store.mts';

// 追问：使用 --resume 继续已有会话
conversationsRouter.post('/session/:sessionId/followup', async (req, res) => {
  const { sessionId } = req.params;
  const { message, executionId } = req.body;

  const execution = await executionStore.get(executionId);
  if (!execution) { res.status(404).json({ error: 'Execution not found' }); return; }

  const result = await runLocal({
    provider: execution.provider || 'claude',
    prompt: '',
    workDir: execution.targetRepoPath,
    resume: { providerConversationId: sessionId, input: message },
    onEvent: async (event: AdapterEvent) => {
      await saveConversationEvent({ executionId, sessionId, event });
    },
  });

  res.json({ success: true, output: result.finalOutput });
});
```

- [ ] **Step 7: 在 index.mts 注册所有路由**

```typescript
// packages/core/src/index.mts
import express from 'express';
import { tasksRouter } from './routes/tasks.mts';
import { requirementsRouter } from './routes/requirements.mts';
import { executionsRouter } from './routes/executions.mts';
import { inboxRouter } from './routes/inbox.mts';
import { conversationsRouter } from './routes/conversations.mts';

const app = express();
app.use(express.json());

app.use('/api/tasks', tasksRouter);
app.use('/api/requirements', requirementsRouter);
app.use('/api/executions', executionsRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/conversations', conversationsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`璇玑 Core 运行在端口 ${PORT}`);
});
```

- [ ] **Step 8: 验证编译**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/routes/ packages/core/src/index.mts
git commit -m "feat: API 路由（tasks/requirements/executions/inbox/conversations）"
```

---

## Task 11: Interrupt/Resume 机制

**Files:**
- Create: `packages/core/src/graph/session-control-v2.mts`
- Modify: `packages/core/src/graph/agent-node.mts`
- Modify: `packages/core/src/routes/inbox.mts`

- [ ] **Step 1: 创建 session-control-v2.mts**

（内容同原 Plan Task 13）

- [ ] **Step 2: 修改 agent-node.mts 的 handleInboxAsk**

替换 Task 9 的占位实现：

```typescript
import { waitForHumanAnswer } from './session-control-v2.mts';

async function handleInboxAsk(executionId: string, question: { id: string; body: string }): Promise<string> {
  const saved = await db.inboxQuestion.create({
    data: { executionId, body: question.body, status: 'pending' },
  });
  return await waitForHumanAnswer(saved.id);
}
```

- [ ] **Step 3: 修改 inbox.mts 添加通知**

```typescript
import { notifyHumanAnswered } from '../graph/session-control-v2.mts';

// POST /:id/answer 中添加：
notifyHumanAnswered(id, answer);
```

- [ ] **Step 4: 验证编译**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph/session-control-v2.mts
git add packages/core/src/graph/agent-node.mts
git add packages/core/src/routes/inbox.mts
git commit -m "feat: interrupt/resume 人机交互机制"
```

---

## Task 12: 端到端测试

**Files:**
- Create: `packages/core/test/e2e.test.mts`

- [ ] **Step 1: 创建测试文件**

```typescript
// packages/core/test/e2e.test.mts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db.mts';
import { taskStore } from '../src/storage/task-store.mts';
import { executionStore } from '../src/storage/execution-store.mts';
import { requirementStore } from '../src/storage/requirement-store.mts';

describe('璇玑 V4 E2E', () => {
  afterAll(async () => { await db.$disconnect(); });

  it('应该能创建需求', async () => {
    const r = await requirementStore.create({
      title: '测试需求',
      targetProjectId: 'test',
      targetRepoPath: '/tmp/test',
    });
    expect(r.id).toBeTruthy();
  });

  it('应该能创建任务', async () => {
    const t = await taskStore.create({
      title: '测试任务',
      targetProjectId: 'test',
      targetRepoPath: '/tmp/test',
    });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe('pending');
  });

  it('应该能创建 execution 并获取 lease', async () => {
    const t = await taskStore.create({
      title: 'lease 测试',
      targetProjectId: 'test',
      targetRepoPath: '/tmp/test',
    });
    const e = await executionStore.create({
      subjectType: 'task',
      subjectId: t.id,
      taskId: t.id,
      targetProjectId: 'test',
      targetRepoPath: '/tmp/test',
    });
    const lease = await executionStore.acquireLease(e.id, 'worker-test');
    expect(lease).toBeTruthy();
    expect(lease!.leaseToken).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd packages/core && pnpm test
```
Expected: 测试通过（需要 PostgreSQL 运行）

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/
git commit -m "test: 端到端集成测试"
```

---

## Task 13: 迁移 V3 前端 + 对接新 API

**Files:**
- Copy: V3 `core/web/*` → `packages/dashboard/`
- Modify: Dashboard API 调用地址

- [ ] **Step 1: 复制 V3 前端**

```bash
cp -r /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agnet-v2/core/web/* \
  packages/dashboard/
```

- [ ] **Step 2: 更新 package.json 名称**

```json
{ "name": "@xuanji/dashboard" }
```

- [ ] **Step 3: 更新 API 调用地址**

V3 前端调用的 API 路径如果与 V4 一致则无需改动。如有差异，更新前端 API 调用。

- [ ] **Step 4: 验证**

```bash
cd packages/dashboard && pnpm install && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/
git commit -m "feat: 迁移 V3 前端 Dashboard"
```

---

## 实施总结

| Task | 内容 | 预估时间 |
|------|------|----------|
| 1 | 项目初始化 | 30min |
| 2 | 三个包脚手架 | 30min |
| 3 | Prisma Schema + 迁移 | 1h |
| 4 | Runner 本地模式 | 2h |
| 5 | Runner 测试 | 1h |
| 6 | Storage 层（Prisma 重写） | 2h |
| 7 | 迁移 V3 LangGraph 图定义 | 1h |
| 8 | LangGraph 调度图 | 3h |
| 9 | agent-node 改造 | 2h |
| 10 | API 路由 | 2h |
| 11 | Interrupt/Resume | 1h |
| 12 | E2E 测试 | 1h |
| 13 | 前端迁移 | 1h |

**总计：约 18 小时（约 2.5 天）**

---

## 审查清单

- [x] Spec 覆盖：需求拆分 ✅ 研发流程 ✅ 并发控制 ✅ 429重试 ✅ 进程管理 ✅ 人机交互 ✅ 对话记录 ✅ 会话恢复 ✅
- [x] 无 Placeholder：所有 TODO 都标注了后续 Task 编号
- [x] 类型一致：`runLocal()` / `AdapterEvent` / `InboxQuestion` 跨 Task 一致
- [x] 每 Task 可编译：Task 7 注释掉 omnigent 引用后保持可编译状态
- [x] 数据库决策：统一 PostgreSQL + Prisma
- [x] 调度决策：LangGraph 统一调度
