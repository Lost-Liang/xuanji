# 璇玑 (Xuanji) V4 架构设计

> "璇玑"取自古代天文仪器，运转有序、周而复始，象征编排调度之道。

## 1. 概述

璇玑是一个长时运行的 AI Agent 编排与调度系统。核心能力：

- **需求拆分**：Requirement → Epic → Feature → UserStory → Task
- **研发流程**：开发 → 编译验证 → 测试验证 → Bug修复 → 质量验证 → 安全审查 → 最终审查
- **并发控制**：可配置最大并发任务数
- **429 重试**：退避策略 5/10/30/60 分钟
- **进程管理**：暂停/恢复/取消
- **人机交互**：Agent 运行中可向人类提问，人类通过 Dashboard 回答

## 2. 版本演进

| 版本 | 编排层 | 执行层 | 状态 |
|------|--------|--------|------|
| V1 | 极简框架 | 直接 CLI | 已废弃 |
| V2 | 自研调度 | Omnigent | 已废弃 |
| V3 | LangGraph | Omnigent | Omnigent 灵活性不足 |
| V4 | LangGraph | AgentOS Runner | **当前** |

V4 的核心决策：保留 V3 的 LangGraph 在线编排，将 Omnigent 替换为 AgentOS Runner（代码级融合）。

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       璇玑 V4 架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐     ┌──────────────────────────┐     │
│  │    璇玑 Core      │     │  AgentOS Runner          │     │
│  │                    │     │  (修改后，本地模式)       │     │
│  │  ┌──────────────┐  │     │                          │     │
│  │  │  LangGraph   │  │     │  ┌────────────────────┐  │     │
│  │  │  编排层      │──┼────►│  │  CLI 适配器         │  │     │
│  │  │  - scheduler │  │     │  │  - claude.ts       │  │     │
│  │  │  - worker    │  │     │  │  - codex.ts        │  │     │
│  │  │  - recovery  │  │     │  └────────────────────┘  │     │
│  │  └──────────────┘  │     │                          │     │
│  │                    │     │  ┌────────────────────┐  │     │
│  │  ┌──────────────┐  │     │  │  MCP Server        │  │     │
│  │  │  PostgreSQL  │  │     │  │  - inbox_ask       │  │     │
│  │  │  状态持久化   │  │     │  │  - task_output     │  │     │
│  │  └──────────────┘  │     │  └────────────────────┘  │     │
│  │                    │     │                          │     │
│  │  ┌──────────────┐  │     │  Workspace / Lease       │     │
│  │  │  Dashboard   │  │     │  (本地模式简化)             │     │
│  │  │  人机交互    │◄───┼────│                          │     │
│  │  └──────────────┘  │     └──────────────────────────┘     │
│  └──────────────────┘                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 核心组件

| 组件 | 来源 | 职责 |
|------|------|------|
| LangGraph 编排层 | V3 保留 | 工作流定义、暂停/恢复（interrupt）、条件分支 |
| scheduler-graph | V4 新增 | 发现待执行任务，轮询并触发 worker |
| worker-graph | V4 新增 | 获取租约、传递给 graphRunner |
| recovery-graph | V4 新增 | 清理僵尸执行（超时/死锁） |
| PostgreSQL | V3 保留 | LangGraph checkpoint + 任务状态 + 对话事件 |
| Dashboard | V3 保留 | 人机交互界面、任务监控 |
| AgentOS Runner | 引入 + 修改 | CLI 进程管理、会话恢复、MCP 工具 |
| MCP Server | AgentOS 修改 | inbox_ask 回调到璇玑 Core |

### 3.2 调度层架构（2026-09-15 修复后）

**租约传递模式**：
```
scheduler-graph (发现任务)
    ↓
worker-graph (获取租约 + 传递)
    ↓
graphRunner (接收租约 + 执行 + 心跳)
```

**关键设计**：
- worker 获取租约后传递给 graphRunner（不再重复获取）
- graphRunner 负责心跳循环和租约刷新
- 所有执行统一走调度器（requirements/epics/features/tasks）
- 单一心跳循环（DB 查询压力减半）

**参考文档**：`docs/superpowers/specs/2026-09-15-scheduler-architecture-fix.md`

## 4. AgentOS Runner 集成

### 4.1 集成方式：修改 Runner 支持本地模式

AgentOS Runner 原本需要与 AgentOS API Server 通信（heartbeat、获取任务、汇报状态）。V4 修改 Runner，使其支持本地模式，可直接被璇玑 Core 调用。

| 文件 | 改动 |
|------|------|
| `packages/runner/src/index.ts` | 新增 `runLocal()` 接口，跳过 API 调用 |
| `packages/runner/src/lease.ts` | 本地模式返回 mock lease 或跳过 |
| `packages/runner/src/mcp-server.ts` | `inbox_ask` 回调改为调用璇玑提供的函数 |
| `packages/runner/src/workspace.ts` | 简化为接受已有的 worktree 路径 |

### 4.2 调用接口

```typescript
import { runLocal, type LocalRunOptions } from '@xuanji/runner';

const result = await runLocal({
  provider: 'claude',              // 或 'codex'
  prompt: '实现这个功能...',
  workDir: '/path/to/worktree',
  model: 'claude-3-5-sonnet',
  resume: {                         // 可选，恢复会话
    providerConversationId: 'xxx',
    input: '继续之前的任务'
  },
  onEvent: (event) => {
    // 捕获所有事件，持久化到 conversation_events
    saveEvent(event);
  },
  onInboxAsk: async (question) => {
    // 回调到璇玑的人机交互流程
    await saveQuestionToDB(question);
    return await waitForHumanAnswer(question.id);
  }
});
```

## 5. 数据库设计

### 5.1 技术选型

| 项 | 选择 |
|---|------|
| 数据库 | PostgreSQL |
| ORM | Prisma（与 AgentOS 一致） |
| LangGraph Checkpoint | `@langchain/langgraph-checkpoint-postgres` |

### 5.2 核心表结构

#### 项目管理层

```sql
-- 需求
CREATE TABLE requirements (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT,
  status              TEXT DEFAULT 'draft',
  target_project_id   TEXT NOT NULL,
  target_repo_path    TEXT NOT NULL,
  auto_execute        BOOLEAN DEFAULT FALSE,
  max_concurrent_tasks INTEGER DEFAULT 1,
  created_at          TIMESTAMP NOT NULL
);

-- 史诗（业务模块）
CREATE TABLE epics (
  id              TEXT PRIMARY KEY,
  requirement_id  TEXT REFERENCES requirements(id),
  title           TEXT NOT NULL,
  description     TEXT,
  module          TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMP NOT NULL
);

-- 特性
CREATE TABLE features (
  id          TEXT PRIMARY KEY,
  epic_id     TEXT REFERENCES epics(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMP NOT NULL
);

-- 用户故事
CREATE TABLE user_stories (
  id              TEXT PRIMARY KEY,
  epic_id         TEXT REFERENCES epics(id),
  feature_id      TEXT REFERENCES features(id),
  title           TEXT NOT NULL,
  as_a            TEXT,
  i_want          TEXT,
  so_that         TEXT,
  acceptance_text TEXT,
  priority        TEXT DEFAULT 'P2',
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMP NOT NULL
);

-- 任务
CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  user_story_id       TEXT REFERENCES user_stories(id),
  epic_id             TEXT REFERENCES epics(id),
  parent_task_id      TEXT REFERENCES tasks(id),
  title               TEXT NOT NULL,
  description         TEXT,
  acceptance_criteria TEXT,
  tech_constraints    JSONB,
  story_context       TEXT,
  status              TEXT DEFAULT 'pending',
  target_project_id   TEXT NOT NULL,
  target_repo_path    TEXT NOT NULL,
  sequence            INTEGER DEFAULT 0,
  version             INTEGER DEFAULT 0,
  retry_at            TIMESTAMP,
  created_at          TIMESTAMP NOT NULL,
  started_at          TIMESTAMP,
  completed_at        TIMESTAMP
);
```

#### 执行层

```sql
-- 任务执行实例
CREATE TABLE task_executions (
  execution_id        TEXT PRIMARY KEY,
  subject_type        TEXT NOT NULL,            -- 'task' | 'requirement'
  subject_id          TEXT NOT NULL,
  task_id             TEXT REFERENCES tasks(id),
  requirement_id      TEXT REFERENCES requirements(id),
  target_project_id   TEXT NOT NULL,
  target_repo_path    TEXT NOT NULL,
  stage               TEXT NOT NULL DEFAULT 'planning',
  status              TEXT NOT NULL DEFAULT 'pending',
  control_status      TEXT NOT NULL DEFAULT 'idle',
  provider            TEXT,                     -- 'claude' | 'codex'
  session_id          TEXT,                     -- providerConversationId，用于 --resume
  final_output        TEXT,
  worker_id           TEXT,
  lease_token         TEXT,
  fencing_token       INTEGER DEFAULT 0,
  lease_expires_at    TIMESTAMP,
  heartbeat_at        TIMESTAMP,
  rate_limit_count    INTEGER DEFAULT 0,
  max_duration_min    INTEGER DEFAULT 240,
  stall_timeout_min   INTEGER DEFAULT 10,
  error_message       TEXT,
  created_at          TIMESTAMP NOT NULL,
  started_at          TIMESTAMP,
  paused_at           TIMESTAMP,
  completed_at        TIMESTAMP,
  retry_at            TIMESTAMP
);

-- 阶段实例
CREATE TABLE phase_instances (
  id                    TEXT PRIMARY KEY,
  execution_id          TEXT REFERENCES task_executions(execution_id),
  phase_id              TEXT NOT NULL,
  task_id               TEXT REFERENCES tasks(id),
  requirement_id        TEXT REFERENCES requirements(id),
  attempt               INTEGER DEFAULT 1,
  status                TEXT DEFAULT 'pending',
  session_id            TEXT,
  agent_used            TEXT,
  result_summary        TEXT,
  result_content        TEXT,
  result_payload        JSONB,
  result_schema_version TEXT,
  error_message         TEXT,
  started_at            TIMESTAMP,
  completed_at          TIMESTAMP,
  created_at            TIMESTAMP NOT NULL
);

-- 阶段输出
CREATE TABLE phase_outputs (
  id                SERIAL PRIMARY KEY,
  phase_instance_id TEXT REFERENCES phase_instances(id),
  key               TEXT NOT NULL,
  value             TEXT,
  created_at        TIMESTAMP NOT NULL
);
```

#### 对话与事件

```sql
-- 对话事件流（V4 新增：完整记录每次对话）
CREATE TABLE conversation_events (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT REFERENCES task_executions(execution_id),
  session_id      TEXT,
  turn_index      INTEGER,
  event_type      TEXT NOT NULL,     -- 'model_started' | 'model_delta' | 'tool_started' | 'tool_completed' | 'final_output' | 'inbox_ask' | 'inbox_answer' | 'error'
  role            TEXT,              -- 'assistant' | 'user' | 'system'
  payload         JSONB NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_events_session ON conversation_events(session_id);
CREATE INDEX idx_conversation_events_execution ON conversation_events(execution_id);

-- 人机交互问题（V4 新增）
CREATE TABLE inbox_questions (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT REFERENCES task_executions(execution_id),
  session_id      TEXT,
  body            TEXT NOT NULL,
  choices         JSONB,
  answer          TEXT,
  status          TEXT DEFAULT 'pending',   -- 'pending' | 'answered'
  created_at      TIMESTAMP NOT NULL,
  answered_at     TIMESTAMP
);

-- 任务日志
CREATE TABLE task_logs (
  id              SERIAL PRIMARY KEY,
  execution_id    TEXT REFERENCES task_executions(execution_id),
  task_id         TEXT REFERENCES tasks(id),
  requirement_id  TEXT REFERENCES requirements(id),
  phase           TEXT,
  message         TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL
);

-- 决策记录
CREATE TABLE decisions (
  id              SERIAL PRIMARY KEY,
  execution_id    TEXT REFERENCES task_executions(execution_id),
  task_id         TEXT REFERENCES tasks(id),
  phase_instance_id TEXT REFERENCES phase_instances(id),
  phase           TEXT NOT NULL,
  decision        TEXT NOT NULL,
  confidence      INTEGER NOT NULL,
  severity        TEXT DEFAULT 'green',
  raw             TEXT,
  created_at      TIMESTAMP NOT NULL
);

-- 人工干预记录
CREATE TABLE interventions (
  id              SERIAL PRIMARY KEY,
  execution_id    TEXT REFERENCES task_executions(execution_id),
  task_id         TEXT REFERENCES tasks(id),
  phase_id        TEXT,
  type            TEXT NOT NULL,       -- 'feedback' | 'redirect' | 'abort'
  message         TEXT NOT NULL,
  suggested_agent TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMP NOT NULL
);

-- 执行事件流
CREATE TABLE execution_events (
  id              SERIAL PRIMARY KEY,
  execution_id    TEXT NOT NULL REFERENCES task_executions(execution_id),
  event_type      TEXT NOT NULL,       -- 'rate_limited' | 'timed_out' | 'completed' | 'failed'
  from_status     TEXT,
  to_status       TEXT,
  message         TEXT,
  created_at      TIMESTAMP NOT NULL
);

-- 调度决策留痕
CREATE TABLE scheduling_events (
  id                SERIAL PRIMARY KEY,
  actor             TEXT NOT NULL,      -- 'scheduler' | 'recovery'
  action            TEXT NOT NULL,
  target_execution_id TEXT,
  target_task_id    TEXT,
  decision          TEXT NOT NULL,      -- 'pass' | 'block' | 'wake' | 'demote' | 'kill' | 'skip'
  reason            TEXT,
  created_at        TIMESTAMP NOT NULL
);
```

## 6. 人机交互流程

```
1. Agent 调用 inbox_ask MCP 工具
2. MCP Server → 回调璇玑 Core 的 onInboxAsk 函数
3. 写入 inbox_questions 表（status='pending'）
4. LangGraph interrupt() 暂停工作流
5. 人类在 Dashboard 看到问题，提交回答
6. Dashboard API 更新 inbox_questions（answer, status='answered'）
7. LangGraph 恢复工作流，答案传回 MCP Server
8. Agent 继续执行（同会话，--resume）
```

### Dashboard API

```
GET  /api/inbox/pending         → 获取待回答的问题列表
POST /api/inbox/:id/answer      → 提交回答
GET  /api/tasks/:id/conversation → 获取完整对话历史
POST /api/tasks/:id/followup    → 人类追问（--resume 继续会话）
```

## 7. 会话管理

### 7.1 会话生命周期

| 阶段 | 说明 |
|------|------|
| 创建 | spawn CLI → 捕获 session_id → 存储到 task_executions.session_id |
| 运行 | inbox_ask → interrupt → 等待人类 → --resume 继续 |
| 完成 | CLI 退出 → 保存 finalOutput → conversation_events 全部持久化 |
| 追问 | 人类通过 Dashboard 追问 → --resume sessionId → 新对话追加 |

### 7.2 会话恢复

```typescript
// 追问流程
app.post('/api/tasks/:taskId/followup', async (req, res) => {
  const { message } = req.body;
  const execution = await getActiveExecution(req.params.taskId);

  const result = await runLocal({
    provider: execution.provider,
    resume: {
      providerConversationId: execution.sessionId,
      input: message,
    },
    workDir: execution.targetRepoPath,
    onEvent: (event) => saveEvent(execution.executionId, event),
  });

  res.json({ success: true, output: result.finalOutput });
});
```

## 8. 错误处理与重试

### 8.1 429 限流

```
CLI 输出 429 事件
    ↓
Adapter 检测到 → 分类为 retryable
    ↓
LangGraph 重试节点
    ↓
退避策略: 5min → 10min → 30min → 60min
    ↓
超过 4 次 → 标记 failed，触发下一个任务
```

### 8.2 Agent 错误分类

```typescript
type ClassifiedFailure = {
  failureClass: 'auth' | 'rate_limit' | 'network' | 'timeout' | 'unknown';
  retryable: boolean;
  operatorAction?: string;
};
```

### 8.3 会话中断恢复

```
进程崩溃 / OOM
    ↓
Lease 过期（心跳停止）
    ↓
Recovery 扫描检测到僵尸 execution
    ↓
清理旧进程
    ↓
--resume sessionId 恢复会话（如果支持）
    ↓
或重新启动新会话
```

## 9. 项目结构

```
long-running-agent-v4/
├── CLAUDE.md
├── package.json
│
├── packages/
│   ├── core/                       # 璇玑核心编排层
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # 统一数据库 Schema
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── db.mts              # Prisma 客户端单例
│   │   │   ├── graph/
│   │   │   │   ├── builder.mts         # LangGraph StateGraph 构建
│   │   │   │   ├── agent-node.mts      # Agent 节点（调用 runner）
│   │   │   │   ├── scheduler-graph.mts # 调度图（替代 V3 自研调度）
│   │   │   │   ├── worker-graph.mts    # 工作图（替代 V3 task-worker）
│   │   │   │   ├── session-control-v2.mts # interrupt/resume 控制
│   │   │   │   ├── state-schema.mts    # 状态 Schema
│   │   │   │   ├── yaml-loader.mts     # YAML 配置加载
│   │   │   │   ├── worktree.mts        # Worktree 管理
│   │   │   │   ├── nodes/              # 其他节点
│   │   │   │   └── conditions/         # 条件路由
│   │   │   ├── storage/
│   │   │   │   ├── task-store.mts          # 任务 CRUD
│   │   │   │   ├── execution-store.mts     # 执行实例 + 租约
│   │   │   │   ├── requirement-store.mts   # 需求 CRUD
│   │   │   │   └── conversation-store.mts  # 对话事件存储
│   │   │   ├── routes/
│   │   │   │   ├── tasks.mts
│   │   │   │   ├── requirements.mts
│   │   │   │   ├── executions.mts
│   │   │   │   ├── inbox.mts
│   │   │   │   └── conversations.mts
│   │   │   └── index.mts           # Express 入口
│   │   └── package.json
│   │
│   ├── runner/                     # AgentOS Runner（修改后，本地模式）
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   ├── claude.ts
│   │   │   │   └── codex.ts
│   │   │   ├── adapters.ts
│   │   │   ├── mcp-server.ts
│   │   │   ├── local-runner.ts         # 本地模式入口
│   │   │   └── workspace.ts
│   │   └── package.json
│   │
│   └── dashboard/                  # 前端 Dashboard
│       └── ...
│
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-09-07-xuanji-v4-design.md
```

## 10. 代码变更清单

| 来源 | 文件 | 改动 |
|------|------|------|
| V3 保留 | `graph/builder.mts` | 不变 |
| V3 改造 | `graph/agent-node.mts` | 替换 omnigent → runner |
| V3 新增 | `storage/conversation-store.mts` | 对话事件存储 |
| V3 新增 | `api/routes/inbox.mts` | 人机交互 API |
| V3 新增 | `api/routes/conversations.mts` | 对话历史查询 |
| AgentOS 修改 | `runner/src/local-runner.ts` | 新增本地模式入口 |
| AgentOS 修改 | `runner/src/mcp-server.ts` | inbox_ask 回调改造 |
| AgentOS 修改 | `runner/src/lease.ts` | 本地模式简化 |
| AgentOS 修改 | `runner/src/workspace.ts` | 简化 worktree 管理 |
| 删除 | `temporal/` | 全部删除 |
| 删除 | `omnigent-client.mts` | 不再需要 |
