# 璇玑 (Xuanji) — 长时运行 AI Agent 编排与调度系统

> "璇玑"取自古代天文仪器，运转有序、周而复始，象征编排调度之道。

## 项目路径

`/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4`

## 版本迭代历史

| 版本 | 编排层 | 执行层 | 状态 |
|------|--------|--------|------|
| V1 | 极简框架 | 直接 CLI | 已废弃 |
| V2 | 自研调度 + Dashboard | Omnigent (SQLite) | 已废弃（仅作参考） |
| V3 | LangGraph | Omnigent | 已废弃（Omnigent 灵活性不足） |
| V4 | LangGraph | AgentOS Runner | **当前** |

### 历史版本路径

- V1: `/Users/admin/code/01-tula-explore/yancao/dev-0817/cwc-long-running-agents-v2/framework`
- V2: `/Users/admin/code/01-tula-explore/yancao/dev-0820/cwc-long-running-agents/framework`
- V3: `/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agnet-v2`

---

## 核心设计目标（5个）

### 目标1: 需求拆分
需求按树形结构拆解：
```
Requirement → Epic → Feature → UserStory → Task
```

### 目标2: 任务研发流程
```
开发 → 编译验证 → 测试验证 → Bug修复(条件) → 质量验证 → 安全审查 → 最终审查
```
- 最大修复循环: 3次

### 目标3: 并发控制
- 默认并发: 1
- 任务完成后触发下一个

### 目标4: 429重试
- 退避: 5分钟 → 10分钟 → 30分钟 → 60分钟
- 最大重试: 4次

### 目标5: 进程管理
- 暂停/恢复/取消

---

## V4 架构

### 技术选型

| 层 | 技术 | 来源 |
|---|------|------|
| 编排层 | LangGraph | V3 保留 |
| 执行层 | AgentOS Runner（本地模式） | 引入 + 修改 |
| 数据库 | PostgreSQL + Prisma | 统一存储 |
| 前端 | Dashboard | V2/V3 保留 |

### 核心决策

- **保留 LangGraph**：V3 的在线编排和调度能力成熟
- **替换 Omnigent → AgentOS Runner**：更好的 CLI 适配（Claude Code、Codex）
- **代码级融合**：AgentOS Runner 修改为本地模式，嵌入璇玑内部（非独立服务）
- **完整对话记录**：新增 `conversation_events` 表，记录每个 token 和工具调用
- **人机交互**：Agent 可通过 `inbox_ask` 向人类提问，人类通过 Dashboard 回答

### 架构概览

```
Dashboard ◄──API──► 璇玑 Core (LangGraph 编排)
                         │
                         ▼
                   AgentOS Runner (本地模式)
                    ├── Claude Code CLI
                    └── Codex CLI
```

---

## 项目结构

```
long-running-agent-v4/
├── CLAUDE.md
├── package.json
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
    └── superpowers/specs/          # 设计文档
```

---

## 数据库核心表

| 表 | 用途 |
|---|------|
| `requirements` / `epics` / `features` / `user_stories` / `tasks` | 需求拆分树 |
| `task_executions` | 执行实例（含 session_id 用于 --resume） |
| `phase_instances` | 阶段执行记录 |
| `conversation_events` | **完整对话事件流**（V4 新增） |
| `inbox_questions` | **人机交互问题**（V4 新增） |
| `task_logs` | 任务日志 |
| `decisions` / `interventions` | 决策与干预 |
| `execution_events` / `scheduling_events` | 事件流留痕 |

---

## 设计文档

- [V4 架构设计](docs/superpowers/specs/2026-09-07-xuanji-v4-design.md)
- [V4 实施计划](docs/superpowers/plans/2026-09-07-xuanji-v4-impl.md)

---

## 当前状态（2026-09-07 更新）

### ✅ V4 实施完成

13 个任务全部完成，经过 13 轮 task review + 1 轮 final review + 1 轮 fix re-review。

**Commits:** 17 commits（9ec5279..61bf405）

**完成内容：**
- ✅ Prisma Schema（15 张表）+ PostgreSQL 迁移
- ✅ Runner 本地模式（Claude Code CLI + Codex CLI 适配器）
- ✅ Storage 层（task/execution/requirement/conversation 四个 store）
- ✅ LangGraph 调度图（scheduler-graph + worker-graph）
- ✅ agent-node 改造（omnigent → runner + SQLite → Prisma）
- ✅ API 路由（5 组 RESTful 路由 + 内部 API）
- ✅ Interrupt/Resume 机制（双策略：Promise 阻塞 + LangGraph interrupt）
- ✅ 端到端测试（20 个测试用例）
- ✅ V3 前端迁移（品牌化 + API 对接）
- ✅ MCP Server（inbox_ask 工具）+ MCP Bridge（CLI 子进程）

**P0 修复（最终审查发现）：**
1. releaseLease 状态覆盖 → 新增 releaseLeaseKeepStatus
2. mcp-server.ts 缺失 → 创建完整 MCP 工具链
3. onInboxAsk 抛错 → 提取 shared-agent-utils.mts
4. sessionId 空操作 → 添加持久化逻辑
5. 进程管理不生效 → 心跳循环检查 controlStatus

**已知限制（后续迭代处理）：**
- builder.mts 的 buildSubGraph/buildTopGraph 仍被注释（研发流程子图未启用）
- recovery-graph.mts 未实现（僵尸执行清理）
- Dashboard 缺少人机交互界面（inbox/followup UI）
- 部分审计留痕表（logs/decisions/interventions）无写入代码

**构建状态：**
- ✅ `pnpm build` 三个包全部通过
- ✅ `pnpm --filter @xuanji/runner test` 24/24 通过
- ⏭️ `pnpm --filter @xuanji/core test` 跳过（需 PostgreSQL）
- ⚠️ `pnpm --filter @xuanji/dashboard test` 1 个预存在测试失败（graph-serialize 序列化断言）

### 下一步

启动系统：
```bash
# 1. 启动 PostgreSQL（需先创建数据库）
createdb xuanji_v4

# 2. 运行数据库迁移
pnpm --filter @xuanji/core prisma migrate deploy

# 3. 启动 API 服务
pnpm --filter @xuanji/core dev  # 端口 3000

# 4. 启动 MCP Bridge（Agent 执行时需要）
pnpm --filter @xuanji/runner mcp-bridge

# 5. 启动 Dashboard
pnpm --filter @xuanji/dashboard dev  # 端口 5173
```

---

## 语言要求

全程使用中文。
