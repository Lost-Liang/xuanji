# 璇玑 V4 启动指南

> **重要：** 这是 V4 系统，使用 AgentOS Runner 本地模式，直接调用 Claude Code CLI。
> 如果你看到 Omnigent 相关的日志，说明运行的是 V3，请检查端口占用。

## 快速启动

```bash
# 一键启动所有服务
./scripts/start.sh

# 或者手动启动
pnpm --filter @xuanji/core start &      # Core API (端口 3000)
pnpm --filter @xuanji/dashboard dev &   # Dashboard (端口 5173)
```

启动后访问：
- **Dashboard**: http://localhost:5173
- **人机交互 Inbox**: http://localhost:5173/inbox
- **API Health**: http://localhost:3000/api/health

**验证 V4 运行：**
```bash
curl http://localhost:3000/api/health
# 期望返回: {"status":"ok","version":"0.1.0"}
```

## 架构说明

**V4 vs V3：**
- **V4（当前）**: 直接调用 Claude Code CLI（AgentOS 本地模式），不使用 Omnigent
- **V3（已废弃）**: 使用 Omnigent 服务，代码在 `long-running-agnet-v2/` 目录

**V4 特点：**
- 直接 spawn Claude Code CLI 进程
- MCP Server 集成，支持 `inbox_ask` 人机交互工具
- LangGraph 调度，CAS 租约机制
- PostgreSQL + Prisma 持久化

## 前置条件

### 1. PostgreSQL 数据库

璇玑 V4 使用 PostgreSQL 16，运行在 Docker 中。

```bash
# 启动 PostgreSQL
docker compose up -d postgres

# 验证运行状态
docker ps | grep postgres
```

**数据库配置：**
- 端口: `5433`（映射到容器内 5432）
- 用户: `v2`
- 密码: `v2`
- 数据库: `xuanji`

**连接字符串：**
```
postgresql://v2:v2@localhost:5433/xuanji
```

### 2. Node.js 环境

- Node.js >= 18
- pnpm >= 8

```bash
# 安装依赖
pnpm install
```

## 启动脚本用法

### 启动所有服务

```bash
./scripts/start.sh
# 或
./scripts/start.sh --all
```

启动内容：
1. Core API（端口 3000）
2. MCP Bridge（按需）
3. Dashboard（端口 5173）

### 单独启动服务

```bash
# 只启动 Core API
./scripts/start.sh --core-only

# 只启动 Dashboard
./scripts/start.sh --dashboard-only
```

### 停止所有服务

```bash
./scripts/start.sh --stop
```

### 查看状态

```bash
./scripts/start.sh --status
```

## 手动启动

如果不使用启动脚本，可以手动启动各服务：

### 1. 初始化数据库

```bash
cd packages/core

# 推送 schema 到数据库
pnpm prisma db push

# 运行迁移
pnpm prisma migrate deploy

# 生成 Prisma Client
pnpm prisma generate
```

### 2. 启动 Core API

```bash
# 开发模式（热重载）
pnpm --filter @xuanji/core dev

# 或生产模式
pnpm --filter @xuanji/core build
pnpm --filter @xuanji/core start
```

API 运行在 `http://localhost:3000`

### 3. 启动 Dashboard

```bash
# 开发模式
pnpm --filter @xuanji/dashboard dev

# 或生产模式
pnpm --filter @xuanji/dashboard build
pnpm --filter @xuanji/dashboard preview
```

Dashboard 运行在 `http://localhost:5173`

### 4. 启动 MCP Bridge（按需）

```bash
# MCP Bridge 在 Agent 执行时自动调用
# 如需手动启动
pnpm --filter @xuanji/runner mcp-bridge
```

## 验证启动

### 检查 API 健康状态

```bash
curl http://localhost:3000/api/health
# 期望: {"ok":true,"ts":...}
```

### 检查 Dashboard

```bash
curl -I http://localhost:5173
# 期望: HTTP/1.1 200 OK
```

### 检查数据库连接

```bash
# 运行核心测试
pnpm --filter @xuanji/core test
# 期望: 27/27 测试通过
```

### 检查默认研发流程

```bash
# 验证 YAML 加载
pnpm --filter @xuanji/core dev
# 然后在另一个终端
curl http://localhost:3000/api/workflows/default-dev-flow
```

## 日志查看

启动脚本会将日志输出到 `logs/` 目录：

```bash
# Core API 日志
tail -f logs/core.log

# Dashboard 日志
tail -f logs/dashboard.log

# 查看 PID
cat logs/core.pid
cat logs/dashboard.pid
```

## 常见问题

### 1. PostgreSQL 连接失败

**错误信息：**
```
P1000: Authentication failed
```

**解决方案：**
```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 如果未运行，启动它
docker compose up -d postgres

# 检查数据库是否存在
docker exec core-postgres-1 psql -U v2 -d v2 -c "\l" | grep xuanji

# 如果不存在，创建它
docker exec core-postgres-1 psql -U v2 -d v2 -c "CREATE DATABASE xuanji;"
```

### 2. 端口被占用

**错误信息：**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**解决方案：**
```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>

# 或修改 .env 中的端口
# packages/core/.env
PORT=3001
```

### 3. Prisma Client 未生成

**错误信息：**
```
Cannot find module '@prisma/client'
```

**解决方案：**
```bash
cd packages/core
pnpm prisma generate
```

### 4. Dashboard 构建失败

**解决方案：**
```bash
cd packages/dashboard

# 清理缓存
rm -rf node_modules/.vite
rm -rf dist

# 重新构建
pnpm build
```

## 默认研发流程

璇玑 V4 内置了默认研发流程，定义在 `packages/core/workflows/default-dev-flow.yaml`：

```
开发 → 编译验证 → 测试验证 → Bug修复(最多3次)
     → 质量审查 → 安全审查 → 最终审查
```

**特点：**
- 每个 check 节点通过条件函数判断通过/失败
- 失败时进入 fix 节点修复，最多循环 3 次
- 条件函数在 `default-conditions.mts` 注册

**使用方式：**
1. 在 Dashboard 创建需求
2. 系统自动加载默认研发流程
3. 任务按流程执行

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                      Dashboard                          │
│                  (http://localhost:5173)                │
│         Inbox | Conversations | Tasks | Executions     │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP API
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    Core API                             │
│                  (http://localhost:3000)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Storage    │  │   Graph      │  │   Scheduler  │ │
│  │   Layer      │  │   Layer      │  │   Layer      │ │
│  │  (Prisma)    │  │ (LangGraph)  │  │  (CAS)       │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────────┬────────────────────────────────────┘
                     │ MCP Protocol
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  MCP Bridge                             │
│           (CLI subprocess, on-demand)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Claude Code  │  │   Codex      │  │  inbox_ask   │ │
│  │   Adapter    │  │   Adapter    │  │   Tool       │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────────┬────────────────────────────────────┘
                     │ CLI
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   PostgreSQL                            │
│              (Docker, port 5433)                        │
│         15 tables + partial unique indexes              │
└─────────────────────────────────────────────────────────┘
```

## 环境变量

### Core API (`packages/core/.env`)

```bash
DATABASE_URL="postgresql://v2:v2@localhost:5433/xuanji"
PORT=3000
NODE_ENV=development
```

### Dashboard (`packages/dashboard/.env`)

```bash
VITE_API_BASE_URL=http://localhost:3000
```

## 开发指南

### 运行测试

```bash
# 所有测试
pnpm test

# Core 测试（需要 PostgreSQL）
pnpm --filter @xuanji/core test

# Runner 测试
pnpm --filter @xuanji/runner test

# Dashboard 测试
pnpm --filter @xuanji/dashboard test
```

### 构建

```bash
# 所有包
pnpm build

# 单独构建
pnpm --filter @xuanji/core build
pnpm --filter @xuanji/runner build
pnpm --filter @xuanji/dashboard build
```

### 代码检查

```bash
pnpm lint
```

## 下一步

1. **创建需求**: 访问 Dashboard，创建第一个需求
2. **执行需求**: 
   ```bash
   # 通过 API 触发执行
   curl -X POST http://localhost:3000/api/requirements/<req-id>/execute
   
   # 或通过 Dashboard UI
   ```
3. **查看任务**: 系统会自动拆分需求为任务
4. **执行任务**: 任务会被调度器拾取并执行
5. **人机交互**: Agent 遇到问题时，会在 Inbox 提问
6. **查看对话**: 在 Conversations 页面查看完整对话历史

## API 端点

### 需求管理
- `GET /api/requirements` - 需求列表
- `GET /api/requirements/:id` - 需求详情
- `POST /api/requirements` - 创建需求
- `POST /api/requirements/:id/execute` - **触发需求执行**

### 执行管理
- `GET /api/executions` - 执行列表
- `GET /api/executions/:id` - 执行详情

### 人机交互
- `GET /api/inbox/pending` - 待回答问题列表
- `POST /api/inbox/:id/answer` - 提交回答

### 对话历史
- `GET /api/conversations/:sessionId/events` - 对话事件流
- `POST /api/conversations/session/:sessionId/followup` - 追问（--resume 会话）

## MCP Server 集成

V4 集成了 MCP Server，Agent 可以通过 `inbox_ask` 工具向人类提问：

**通信链路：**
```
Agent (Claude CLI) 
  → inbox_ask MCP 工具 
  → mcp-bridge.js (子进程)
  → POST /api/internal/inbox-ask
  → 写入 inbox_questions 表
  → waitForHumanAnswer (阻塞)
  → Dashboard 显示问题
  → 人类回答
  → 返回 Agent
```

**配置：**
- local-runner.ts 自动生成 MCP 配置文件
- 通过 `--mcp-config` 参数传递给 Claude CLI
- 环境变量：`XUANJI_API_URL`、`XUANJI_EXECUTION_ID`

## 参考文档

- [CLAUDE.md](../CLAUDE.md) - 项目总览
- [V4 架构设计](../docs/superpowers/specs/2026-09-07-xuanji-v4-design.md)
- [V4 实施计划](../docs/superpowers/plans/2026-09-07-xuanji-v4-impl.md)
