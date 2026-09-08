# 璇玑 V4：Agent/工作流配置对齐 + 按流程节点接入角色 Agent 执行

## Context（为什么做这个改动）

用户指出 V4 的"流程编排/配置层"与 V3 不符、且执行没有真正按编排节点跑：

1. V3 有 **2 个默认流程**：需求理解与任务拆分、研发流程（基于 RuoYi）。侧边栏**工作流列表**展示不对；**需求管理**里触发的"需求拆分"流程不对（前端硬编码死 id `research-flow-v1`，后端 create 忽略 `workflow_id`）；**Agent 配置 / Skill 配置**整个 404。
2. 用户进一步澄清：执行本来就该由 **LangGraph 编排节点**驱动——一个 agent 节点 = 绑定一个角色 Agent（prompt + model + harness）+ skill。代码执行层还有 7 个 ruoyi agent 没坐进执行位。

**探索确认的核心事实（现状）**：
- 需求执行 = `executeRequirement`（一次 `runLocal` 组合 prompt 同时做分析+拆分）；任务执行 = scheduler `workerNode`（一次通用实现）。**两条路径都不经过 workflow YAML / agent-node。**
- `builder` 能编出 workflow 图（`buildGraphFromDef`，builder.mts:392-466），`agent-node`/`gate-node`/`command-node` 工厂齐全，且编译已挂 checkpointer（目前是 **MemorySaver**，builder.mts:22）。**但没有任何运行时入口去 `invoke()` 一张 workflow 图**——所以流程里的 agent 节点从未真正执行。
- `agent-node` 的 `runLocal({provider:'claude', model:undefined})`（agent-node.mts:188/191，注释 `TODO: 从 binding 配置读取 provider`）；`buildPrompt` 只回 `s.input ?? task.title…`，**不查 binding 的 prompt_content/model/harness/skill**。
- 后端**没有** agent-bindings/skills/graph-definitions/workflows(写)/executions-resume 路由；DB 无对应表。`runLocal` 已支持 `model`（拼 `--model`，local-runner.ts:116-118）。core 已依赖 `@langchain/langgraph@0.2.74` 与 `langgraph-checkpoint-postgres@1.0.5`。

**用户已拍板**：Agent 存 Prisma+PostgreSQL；沿用 V3 ruoyi agent 套；用户自建流程保存（graph_definitions）本轮做；执行按节点+绑定接入。

---

## 目标 / 架构

统一成一条 **"流程定义 → 编译成图 → 运行时按节点执行"** 的主线，让 10 个 ruoyi agent 各坐一个执行位：

```
POST /api/requirements/:id/execute        POST /api/executions/:id/resume|pause|cancel|gate
   │ (requirement-decomposition 图)                │ (thread_id 定位 checkpoint)
   ▼                                                ▼
  graph-runner（新增，编译 workflow → invoke → 处理 GraphInterrupt → 续跑）
   │  每节点 = agent | command | gate
   ▼
 agent-node(读 AgentBinding → prompt/model/provider/skill → runLocal)
```

分 4 个里程碑，各自可独立验证、系统全程可跑：

- **M0 配置数据与页面对齐**（Agent/Skill/流程配置正确显示 + 需求触发正确流程 + 用户图可保存）
- **M1 流程执行运行时**（binding→执行；graph-runner 线程/resume/中断；exec 详情带 phase 进度）
- **M2 两条执行链路改走流程图**（需求拆分图 + 任务 dev-flow 图）
- **M3 端到端验证 + 文档收尾**

---

## 数据模型（Prisma 增改，`packages/core/prisma/schema.prisma`）

新增 2 个 model、扩 3 个 model：

```prisma
model AgentBinding {
  id              String   @id            // 即角色 id（seed 用 agent_id，YAML agent_binding_ids 直指）
  plugin_id       String?
  agent_id        String                  // 角色名，如 backend-crud
  harness         String   @default("claude")  // 'claude' | 'codex' → runner provider
  skill_id        String?                 // 指向 skills 树 id（spec-driven-development …）
  prompt_content  String   @default("")   // 角色指令（seed 自 V3 agents/*.md）
  triggers        Json?                   // { task_type?: string[], stack_type?: string[] }
  model           String?                 // 传给 runLocal(--model)；空则 CLI 默认
  reasoning_effort String?
  created_at      DateTime @default(now())
  @@map("agent_bindings")
}

model GraphDefinition {
  id              String   @id            // 用户流 id（前端生成 `${name}-${Date.now()}` 或后端 uuid）
  name            String
  plugin_id       String?
  description     String?
  definition_json Json                 // { name, plugin_id, nodes: GraphNode[], edges: GraphEdge[] }
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  @@map("graph_definitions")
}

// 扩展现有 model：
// Requirement   + workflow_id String?           // 创建时选中的流程（默认 'requirement-decomposition'）
// Task          + task_type String?             // CRUD / CRUD_PAGE / MODULE_ENHANCEMENT …（worker 路由 dev 绑定用）
//               + estimated_hours Float?
// TaskExecution + graph_definition_id String?   // 该执行跑的流程 id（供画布画流程 + 运行时选图）
//               + thread_id String?             // LangGraph checkpointer 线程 id（gate 恢复用，勿与 session_id 混用）
```

同步方式沿用现状：`scripts/start.sh` 已 `prisma db push`；另建 **db push** 由 M0 手动跑一次即可。`prisma migrate dev` 不做（仓库现状即 db push 风格）。

---

## M0 — 配置数据与页面对齐

### M0.1 Prisma 变更 + 生成
- 改 `schema.prisma`（见上）；跑 `pnpm --filter @xuanji/core db:generate` + `db push`。
- `git` 无版本库（本目录非 repo），变更以文件为准。

### M0.2 资产落地（从 V3 复制）
- `packages/core/agents/ruoyi/*.md` ← `…/long-running-agnet-v2/core/plugins/ruoyi/agents/*.md`（10 个角色 prompt，seed 的 prompt_content 来源）。
- `packages/core/skills/presets/<id>/SKILL.md` ← V3 `core/skills/presets/{spec-driven-development, planning-and-task-breakdown, ruoyi-plus-ai-coding, test-driven-development, debugging-and-error-recovery, code-review-and-quality, code-simplification, security-and-hardening}/SKILL.md`。
- `packages/core/skills/user/` 建目录（存用户新建 skill，空开始）。
- 新增 `packages/core/src/seed/agent-bindings-seed.mts`：幂等 upsert 10 条 ruoyi 绑定（id=agent_id；harness 全 'claude'；model 取 V3 plugin.yaml 值 `claude-sonnet-5`；reasoning_effort 取 plugin 值；triggers 取 plugin 的 `triggers` 段；prompt_content 读对应 `agents/ruoyi/<file>.md`）。提供 `pnpm --filter @xuanji/core seed` = `node dist/seed/agent-bindings-seed.mjs`（tsc 已随 build 出 dist，路径用 `join(process.cwd(),'agents','ruoyi',…)` 解析）。M0 手动跑一次。

### M0.3 后端路由
- 新增 `routes/agent-bindings.mts` 并挂 `/api/agent-bindings`：`GET /`（AgentBinding[]，`session_count` 字段缺省不返，前端 `?? 0` 兼容）、`GET/:id`、`POST`（id 缺省用 `agent_id` 或 uuid）、`PUT/:id`、`DELETE/:id`。字段名严格用前端 AgentBinding 形状（id/plugin_id/agent_id/omnigent_agent_id[空]/harness/skill_id/prompt_content/triggers/model/reasoning_effort/created_at）。
- 新增 `routes/skills.mts` 挂 `/api/skills`：扫描 `skills/{presets,user}/<id>/SKILL.md` 前导 frontmatter；`GET /` → `{ presets: [{id,name,description,type:'preset'}], user: [...] }`；`GET /:id` → 含 `content`（读 SKILL.md 全文）；`POST`（写 user/<id>/SKILL.md，**返回创建的 id**）；`PUT/:id`；`DELETE/:id`（仅 user）。
- 新增 `routes/graph-definitions.mts` 挂 `/api/graph-definitions`：列表 = **presets**（扫 `workflows/*.yaml`，经 `loadWorkflowFromFile`+`mapYamlToGraphDef` 转成 {id,name,description,nodes,edges}）+ **user**（DB `graph_definitions`）；`GET/:id` 命中 preset/用户均返回 `{ id, name, ..., definition_json: <GraphDef 对象> }`（前端 `row.definition_json` 契约）；`POST/PUT/DELETE` 只作用 DB 用户流。供 Canvas 静态编辑与 WorkflowList。
- 扩 `routes/workflows.mts`：`DELETE /api/workflows/:id`（仅用户流，即 DB graph_definitions；preset 403）；`GET /` user 分支并入 DB 用户流（映射为 workflow 形状 id/name/version/nodes/edges/start/end/type）。
- 扩 `routes/requirements.mts`：`POST /` 记录 `body.workflow_id || 'requirement-decomposition'` 到 `requirement.workflowId`。
- 扩 `routes/executions.mts`：列表/详情加 `graph_definition_id`、`phase_nodes`（由 `phase_instances` 聚成 `{phaseId: status}`）、`thread_id`；`loop_counters`/`token_*` 占位；GET `/` 支持 `?subject_type=&requirement_id=` 过滤；新增 `POST /:id/resume`（先置 controlStatus='resume_requested'，M1 接图续跑）。

### M0.4 两个 workflow YAML 绑定对齐（ruoyi agent 套）
- `requirement-decomposition.yaml`：不变（requirement_analysis→[requirement-analyst] spec、task_breakdown→[task-planner] tasks、review_gate）。
- `default-dev-flow.yaml`：agent_binding_ids 对齐 ruoyi 套——`develop`→`[backend-crud, backend-module-enhancement, frontend-crud-page]` + `selector:{by: task_type}`；`bug_fix`→`[bug-fixer]`；`quality_review`→`[reviewer]`；`quality_issue_fix`→`[quality-fixer]`；`security_review`→`[reviewer]`；`security_issue_fix`→`[security-fixer]`；compile_check/test_check 保持 `command`；final_review gate 保持。

### M0.5 前端对齐（`packages/dashboard`）
- `views/Requirements.vue`：`selectedWorkflowId` 默认 `'requirement-decomposition'`；下拉文案用 `/api/workflows` 的 name（否则显示 id）。
- `views/Canvas.vue`：`onMounted` 分支补 `route.query.workflow_id` → 静态态 `api.get(workflow_id)` 绘制；无 query 时先 `loadGraphDefs()` 再默认第一张；`selectedGraphId` 去掉死值 `'research-flow-v1'`；`save()` 保存后把 `selectedGraphId` 更新为新建图 id 并回填 name。
- `views/WorkflowList.vue`：无需大改（后端补齐后即显示 2 preset + 用户图；DELETE 用返回 `{ok}` 语义微调）。
- `views/AgentDetail.vue`：harness 下拉 `['claude-sdk','codex','codex-native']` → `['claude','codex']`；AgentConfig/SkillConfig/SkillDetail 依赖的路由补齐即通。
- `views/Requirements.vue` 删除分支：`api.delete` 后端 DELETE 返回 `{ ok: true }`/`{ ok:false, error }`。

**M0 验收**：重启 core+dashboard 后——侧边栏工作流列表显示 2 个默认流程且能"打开画布"画出来；需求管理创建即带 requirement-decomposition；Agent 配置列出 10 个 ruoyi agent（可编辑 prompt/model/harness/skill）；Skill 配置列出 8 个 preset；画布可另存用户图且出现在工作流"用户"tab。

---

## M1 — 流程执行运行时（核心）

### M1.1 binding 读取 + agent-node 接入角色
- 新增 `storage/agent-binding-store.mts`：`getByRole(ids)/list()`（db.agentBinding，Prisma）。
- 改 `graph/nodes` 上层：`builder.mts` `nodeAction`（agent 分支）从 DB 解析 `agent_binding_ids` → 把 `{ prompt_content, model, harness/provider, skill_id }` 传入 `makeAgentNode`。
- 改 `agent-node.mts`：`provider` 由 binding.harness 映射（claude→'claude'，codex→'codex'）；`model: binding.model || undefined`；prompt = `binding.prompt_content`（role）+ 角色技能内容（若 `skill_id`，读 `skills/presets|user/<skill>/SKILL.md` 截断插入）+ `nodeContext`（见下）。多个 binding + selector 时按 `task.task_type/stack_type` 命中 `triggers` 选，否则取第一个（回退）。
- `nodeContext`：按 `write_key`/节点语义组装——spec→需求文本；tasks→需求文本+spec+epics/features 摘要；results/实现与审查类→任务明细(title/description/acceptance/tech/context)+前序 `results` 最后一条（如编译/测试报错、review 发现）。保留现有 reject-redo / archive 分支。
- 新增 `lib/skill-content.mts` 读 SKILL.md 内容（复用给 seed 与 agent-node）。

### M1.2 graph-runner（新执行入口）
- 新增 `graph/graph-runner.mts`：
  - `getCheckpointer()`：把 `builder.mts` 的 `MemorySaver` 换为 `PostgresSaver`（`@langchain/langgraph-checkpoint-postgres`，`packages/core/src/checkpointer.mts` 单例，启动时 `.setup()` 建表；builder 改 import 它）——gate 中断可跨进程重启恢复。
  - `loadFlow(id)`：preset（扫 workflows/*.yaml→GraphDef）或 DB 用户流（definition_json）二选一。
  - `startExecution({executionId, flowId, input, task?})`：`buildGraphFromDefObject(def)`（把 builder `buildGraphFromDef` 的 string 版抽成接受 GraphDef 对象的重载，YAML 解析留原函数），`graph.invoke(stateInit, { configurable: { thread_id, execution_id, exec_shortid? } })`；`thread_id` 写入 execution.thread_id；agent/gate 节点内建/复用的 `phase_instance` 更新照旧（agent-node 已写）。结束 → execution 终态。
  - gate `GraphInterrupt`：捕到后把 execution status 置 `paused`，`stage`=gate 节点，落一条 `intervention`/`inbox_question`（gate 文案）供 Dashboard 展示；**不抛错**。
  - `resumeExecution({executionId, decision, comments})`：按 thread_id `graph.invoke(new Command({ resume: {decision, comments} }), config)`（复用 session-control-v2 的 `resumeGraph` 形态），继续跑直到下一个中断或 END。
  - 租约/心跳/进程管理：runner 外层沿用现有 lease 语义——由调用方（execute route / scheduler worker）持有 lease，runner 在**每个节点边界** `renewHeartbeat` + 查 `controlStatus`（cancel→abort 后续节点；pause_requested→跑完当前节点后暂停）。
- 路由接线：`POST /api/executions/:id/gate` 改为写 decision **后调用 `resumeExecution`**（approve/reject 传给 gate 节点，`gatePath` 已处理 reject 回退）；`POST /:id/resume` 同 resumeExecution。

**M1 验收**（可独立演示）：手造一条 TaskExecution 指向 requirement-decomposition，`startExecution` 后 DB 里出现 `phase_instances`（requirement_analysis、task_breakdown 依次 completed，resultContent 有 spec/任务树），conversation_events 有对应 session；在 final gate 处 status=paused；POST /gate approve 后 execution completed。Console/DB 均可见每个节点用的是**对应 agent 的 prompt 前缀**（从 conversation 首条 assistant 上下文/phase_output 验证）。

---

## M2 — 两条执行链路改走流程图

### M2.1 需求拆分跑 requirement-decomposition 图
- `routes/requirements.mts` execute：不再直接 `executeRequirement` 组合调用，改为：建 requirement 级 TaskExecution（record `graph_definition_id=workflow_id`）→ `graphRunner.startExecution`。输入 state = `{ input: requirement.text }`。
- 图结束后（或 task_breakdown 后 final gate 前）**持久化任务树**：在 `task_breakdown` 节点的 phase_output/resultContent 里 parse JSON（V3 task-planner schema：user_stories 带 as_a/i_want/so_that + tasks 带 task_type/estimated_hours，feature_id/epic_id 关联），新建 Epic/Feature/UserStory/Task（task 记 `task_type`）并为其建 TaskExecution(pending)。放 `graph-runner` 的 onFlowComplete 回调（按 flowId 分发），**待 final gate approve 后再 enqueue**（requirement 分解默认人工 gate；`autoExecute` 需求可自动 approve gate）。
- 保留 `executeRequirement` 的 JSON 容错解析/归一（抽到 `requirement-tree.mts` 复用），仅把调用点从"一次 runLocal"改为"读两阶段 phase 输出合并成树"（analysis 给 epics/features，breakdown 给 stories/tasks）。

### M2.2 任务执行跑 default-dev-flow 图
- `scheduler-graph` worker：`workerNode` 单次实现 → 改为 `graphRunner.startExecution({ flowId:'default-dev-flow', task })`（lease/heartbeat/429 语义迁到 runner 节点边界；429 时整图 rate_limited，重试到期后 scheduler 重新 startExecution——新建/续用同一 thread 从断点续跑）。dev-flow final gate 对**任务执行默认自动 approve**（避免每任务停等人工；`gate 自动通过`由 runner 的 task 分支策略控制），requirement 级 gate 保持人工。
- 若仓库/编译语义不适合某任务，dev-flow 的 command 节点失败会走 bug_fix 循环（既有条件边），行为与 V3 一致。

### M2.3 画布运行态完善
- execution 详情行已带 graph_definition_id + phase_nodes（M0.3），Canvas `connectExecution` 走"有 def→画流程+按 phase_nodes 染色"分支（覆盖 requirement 与 task）；`buildCanvasFromRequirementTree` 保留为无 flow 时兜底。

**M2 验收**：创建需求→执行→分解图里 requirement_analysis/task_breakdown 逐节点变绿→final gate 暂停→（approve 后）任务行生成→scheduler 逐任务跑 dev-flow（develop→compile_check→test_check→quality/security→final）→完成；Dashboard 需求卡/执行概览/人机交互/画布运行态颜色全程正确，无 404、无 Recursion 报错、无 unhandled reject。

---

## M3 — 验证与收尾
- `pnpm build` + 三包测试（core/runner/dashboard）全绿；按 CLAUDE.md"启动系统"四步重启验证。
- 回归既有调度器修复：scheduler 空闲不触发 25 步限制（监控日志 0 递归错）；429 退避仍生效。
- 补记忆：M0-M2 的关键决策与坑；更新 `CLAUDE.md` 当前状态段与"下一步"。

---

## 关键文件清单

| 文件 | 动作 |
|---|---|
| `core/prisma/schema.prisma` | 增 AgentBinding/GraphDefinition；扩 Requirement/Task/TaskExecution |
| `core/agents/ruoyi/*.md`、`core/skills/presets/*/SKILL.md`、`core/skills/user/` | 从 V3 复制资产 |
| `core/src/seed/agent-bindings-seed.mts` | 新增 seed |
| `core/src/routes/agent-bindings.mts`、`skills.mts`、`graph-definitions.mts` | 新增路由 |
| `core/src/routes/workflows.mts`、`requirements.mts`、`executions.mts` | 扩（DELETE/写/过滤/resume/gate→resume/字段） |
| `core/src/graph/agent-node.mts`、`builder.mts` | binding/skill 接入；checkpointer 换 PostgresSaver；GraphDef 编译重载 |
| `core/src/checkpointer.mts`、`core/src/graph/graph-runner.mts`、`core/src/storage/agent-binding-store.mts` | 新增运行时 |
| `core/workflows/requirement-decomposition.yaml`、`default-dev-flow.yaml` | 绑定对齐 |
| `dashboard/src/views/Requirements.vue`、`Canvas.vue`、`AgentDetail.vue`、`WorkflowList.vue` | 前端对齐 |

## 复用的既有函数（勿重复造）
- `builder.mts`: `buildGraphFromDef/buildTopGraph/buildSubGraph/nodeAction/gatePath/withLoopCounter`
- `graph/nodes/gate-node.mts` `makeGateNode`（interrupt）；`command-node.mts` `makeCommandNode`
- `agent-node.mts` `makeAgentNode/buildReturn`、`shared-agent-utils.mts` `mapAdapterEvent/handleInboxAsk`
- `session-control-v2.mts` `waitForHumanAnswer/notifyHumanAnswered/resumeGraph`
- `runner local-runner.ts` `runLocal`（provider/model/resume/onInboxAsk/abortSignal）
- 现有 store 单例 `core/src/db.mts`、`execution-store`、`requirement-store`、`task-store`、`conversation-store`

## 风险与决策点（记录为 Ruling，供执行期对照）
- **R1 任务级 dev-flow final gate 自动 approve**（M2.2）：避免 N 个任务都停等人工；需求级 gate 保持人工。可后续加"人工终审"开关。
- **R2 429 重试=整图级**：rate_limited 后到期用同一 thread 续跑而非只重试当前节点（LangGraph checkpoint 天然支持断点续跑），会话尽量续用 sessionId。
- **R3 仓库语义**：当任务无真实 repo（targetRepoPath=cwd）时 command 节点的 build/test 结果如实反映，bug_fix 循环按既有条件边运转，不额外特殊处理。
- **R4 checkpointer 升级 PostgresSaver** 需在启动时建表（幂等）；首次连接失败降级 MemorySaver 并 warn。