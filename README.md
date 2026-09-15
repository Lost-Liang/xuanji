# 璇玑 (Xuanji) - 长时运行 AI Agent 编排与调度系统

> "璇玑"取自古代天文仪器，运转有序、周而复始，象征编排调度之道。

## 项目简介

璇玑是一个基于 LangGraph 的智能编排系统，专为管理长时间运行的 AI Agent 任务而设计。系统支持：

- **需求拆分**：将复杂需求拆解为 Epic → Feature → UserStory → Task 的树形结构
- **任务调度**：支持并发控制、重试机制、进程管理（暂停/恢复/取消）
- **研发工作流**：预置成熟的研发流程，支持 TDD、编译验证、安全扫描等阶段
- **人机协作**：Agent 可通过 `inbox_ask` 向人类提问，实现人机交互

## 架构概览

```
Dashboard ◄──API──► 璇玑 Core (LangGraph 编排)
                         │
                         ▼
                   AgentOS Runner (本地模式)
                    ├── Claude Code CLI
                    └── Codex CLI
```

**核心组件**：
- **编排层**：基于 LangGraph 的状态图，管理任务流转
- **执行层**：AgentOS Runner（本地模式），支持 Claude Code 和 Codex CLI
- **存储层**：PostgreSQL + Prisma，统一存储需求和执行记录
- **前端层**：Vue 3 Dashboard，可视化任务状态和人机交互

## 核心特性

### 1. 需求拆分

需求按树形结构拆解：
```
Requirement → Epic → Feature → UserStory → Task
```

### 2. 研发工作流

#### V2 版本（推荐）

基于执行数据分析，优化后的研发工作流包含以下改进：

- ✅ **真正的 TDD**：`run_initial_tests` 确认测试失败后再开发
- ✅ **编译检查**：`compile_check` 智能判断前后端，快速失败
- ✅ **安全扫描**：`security_scan` 独立阶段，检测 XSS、SQL 注入等
- ✅ **修复验证**：`code_fix` 后强制 `regression_test`，防止引入新问题
- ✅ **人审不跳过**：`final_review` gate 强制触发

**使用方式**：

```typescript
// 创建 requirement 时指定 V2 工作流
await db.requirements.create({
  data: {
    title: '实现 XXX 功能',
    graph_definition_id: 'ruoyi-dev-flow-v2',  // 使用 V2
    ...
  }
})
```

详细使用指南：[docs/workflow-v2-guide.md](docs/workflow-v2-guide.md)

设计文档：`docs/superpowers/specs/2026-09-15-dev-workflow-optimization-design.md`

### 3. 并发控制

- 默认并发：1
- 任务完成后触发下一个
- 支持 MAX_CONCURRENT 配置

### 4. 429 重试

- 退避策略：5分钟 → 10分钟 → 30分钟 → 60分钟
- 最大重试：4次
- 自动恢复执行

### 5. 进程管理

- 暂停：通过 API 暂停正在执行的任务
- 恢复：从暂停点恢复执行
- 取消：终止正在执行的任务

## 快速开始

### 前置条件

- Node.js 18+
- PostgreSQL 14+
- pnpm 8+

### 安装依赖

```bash
pnpm install
```

### 数据库配置

```bash
# 创建 PostgreSQL 数据库
createdb xuanji

# 同步 Prisma schema
cd packages/core
pnpm prisma db push
```

### 启动服务

```bash
# 1. 确保 PostgreSQL 运行
docker ps | grep postgres

# 2. 启动 API 服务
pnpm --filter @xuanji/core dev  # 端口 3000

# 3. 启动 MCP Bridge（Agent 执行时需要）
pnpm --filter @xuanji/runner mcp-bridge

# 4. 启动 Dashboard
pnpm --filter @xuanji/dashboard dev  # 端口 5173
```

### 验证安装

```bash
# 检查 API 服务
curl http://localhost:3000/api/health

# 检查 Dashboard
open http://localhost:5173
```

## 项目结构

```
long-running-agent-v4/
├── packages/
│   ├── core/                       # 璇玑核心编排层
│   │   └── src/
│   │       ├── graph/              # LangGraph 编排
│   │       ├── storage/            # PostgreSQL 存储
│   │       ├── scheduler/          # 任务调度
│   │       └── api/                # Dashboard API
│   ├── runner/                     # AgentOS Runner（修改后）
│   │   └── src/
│   │       ├── adapters/           # Claude/Codex 适配器
│   │       ├── mcp-server.ts       # MCP 工具（inbox_ask 等）
│   │       └── local-runner.ts     # 本地模式入口
│   └── dashboard/                  # 前端 Dashboard
└── docs/
    ├── workflow-v2-guide.md        # 研发工作流 V2 使用指南
    ├── startup-guide.md            # 启动指南
    └── superpowers/specs/          # 设计文档
```

## 核心数据表

| 表 | 用途 |
|---|------|
| `requirements` / `epics` / `features` / `user_stories` / `tasks` | 需求拆分树 |
| `task_executions` | 执行实例（含 session_id 用于 --resume） |
| `phase_instances` | 阶段执行记录 |
| `conversation_events` | 完整对话事件流 |
| `inbox_questions` | 人机交互问题 |
| `task_logs` | 任务日志 |
| `decisions` / `interventions` | 决策与干预 |
| `execution_events` / `scheduling_events` | 事件流留痕 |

## 开发状态

### V4 实施完成（2026-09-07）

18 个 commits（9ec5279..882218a），13 个任务全部完成 + 所有已知限制已修复。

### 调度层架构修复完成（2026-09-15）

5 个 commits（88d7e81..6a7bc3d），修复双重租约死锁和需求执行绕过调度器问题。

### 研发工作流优化（2026-09-15）

基于执行数据分析，修复了 10 个已识别问题，推出 V2 工作流。

详细历史：
- [V4 架构设计](docs/superpowers/specs/2026-09-07-xuanji-v4-design.md)
- [V4 实施计划](docs/superpowers/plans/2026-09-07-xuanji-v4-impl.md)
- [调度器架构修复](docs/superpowers/specs/2026-09-15-scheduler-architecture-fix.md)
- [研发工作流优化设计](docs/superpowers/specs/2026-09-15-dev-workflow-optimization-design.md)

## 文档

- [研发工作流 V2 使用指南](docs/workflow-v2-guide.md)
- [启动指南](docs/startup-guide.md)
- [状态机设计](docs/state-machine.md)
- [端到端测试计划](docs/e2e-test-plan.md)

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: 添加某功能'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证。

## 联系方式

项目维护者：xc.liang