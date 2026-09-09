# 璇玑 V4 架构问题分析与设计方向

> 日期：2026-09-09
> 状态：**分析完成，待设计**

## 一、已修复的 Bug（2026-09-08）

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | 任务执行流程跳过 compile_check、test_check | tasks.mts 传 taskId 字符串而非完整对象 | `taskStore.getById()` 获取完整对象 |
| 2 | command-node 不创建 phase_instance | 节点只返回 state，不写 DB | 创建/更新 phase_instance 记录 |
| 3 | 条件函数空状态返回 false | `JSON.parse('')` 抛错，catch 返回 false | 空状态视为失败，`compileFail` 返回 true |
| 4 | 前端 TaskDetail 缺少 title 字段 | TypeScript 接口定义缺失 | 添加 `title: string` |
| 5 | test_check 无条件边 | YAML 缺少条件边定义 | 添加 test_pass/test_fail 条件边 |
| 6 | execute API 竞态条件 | confirm 后调度器立即拾取，前端未刷新 | running/waiting 返回成功而非报错 |

**参考文档**：`docs/bugfix/2026-09-08-task-execution-flow-bug.md`

---

## 二、发现的架构缺陷（未修复）

### 缺陷 1：工作目录概念混乱（最核心）

**现象**：
- Agent 在璇玑 V4 项目目录执行，不在用户目标项目
- compile_check/test_check 跑的是璇玑自己的构建和测试
- bug_fix 收到的错误信息是璇玑测试失败，与任务无关

**根因分析**：

```
agent-node.mts:307-310

let workDir = process.cwd();  // ← 默认是璇玑 V4 目录
if (opts.isSubgraph && task) {
  const wtPath = await ensureTaskWorktree(task.shortid, execShortid);
  workDir = wtPath;  // ← 只有子图节点才创建 worktree
}
```

**问题**：
1. `process.cwd()` 是璇玑 V4 启动目录，不是目标项目
2. YAML 流程节点（develop/bug_fix 等）`isSubgraph = false`，不走 worktree 逻辑
3. `task.targetRepoPath` 存在但从未被使用

**数据链路**：
```
用户创建需求 → requirements.target_repo_path → tasks.target_repo_path
                                                          ↓
                                                    (存在但未使用)
                                                          ↓
                                            agent-node → process.cwd()
```

---

### 缺陷 2：target_repo_path 写死为璇玑目录

**现象**：
任务的 `target_repo_path` 指向 `packages/core`（璇玑子系统），而非用户的 RuoYi-Cloud-Plus 项目

**根因**：
```typescript
// requirements.mts 创建需求时
targetRepoPath: body.targetRepoPath || process.cwd()
```

前端没有让用户指定工作目录的入口，默认值是璇玑 V4 目录。

**设计问题**：
- 璇玑作为研发自动化平台，天然要处理多个项目
- 每个需求应该让用户指定"我要在哪个项目里干"
- 当前没有项目管理的概念

---

### 缺陷 3：三层概念混用

**现状**：

| 概念 | 当前状态 | 应该的状态 |
|------|---------|-----------|
| 璇玑平台文件 | YAML/skill/agent 从文件系统读取 | 初始化时加载到 DB，运行时从 DB 读取 |
| 目标项目 | `target_repo_path` 写死 | 用户创建需求时指定，存入需求/任务 |
| Agent Runtime | `runLocal({ workDir })` 未正确传递 | `workDir = target_repo_path` |

**用户提出的正确设计**：

> 1. agent、skill、workflow 做为系统预置工具，应该只在璇玑项目初始化的时候，从代码目录获取一次，然后就应该持久化到 DB 里了
> 2. 需求拆分、研发流程这种调用 agentos 再调用 claude code 的时候，对应的 agent/skill 应该复制到用户指定的工作目录中（.claude 文件夹内）
> 3. skill、agent 列表需要展示系统预置和用户自定义的内容（自定义的部分，可以从工作目录读取）

---

### 缺陷 4：loop_max 机制失效

**现象**：
- YAML 配置 `loop_max: 3`
- 实际循环了 8 次，触发 LangGraph 递归限制（25 步）

**根因分析**：

```typescript
// builder.mts FIX_LOOP_KEY 映射
const FIX_LOOP_KEY: Record<string, string> = {
  bug_fix: 'compile_check',           // ← bug_fix 只映射到 compile_check
  quality_issue_fix: 'quality_check',
  security_issue_fix: 'security_check',
}

// withLoopCounter 包装 bug_fix 节点
action = withLoopCounter(action, fixKey)  // fixKey = 'compile_check'

// routeFromSource 读取计数器
const done = state.loop_counters?.[meta.source] ?? 0
```

**问题**：
- `test_check → bug_fix` 边有 `loop_max: 3`
- 但 `withLoopCounter` 固定增加 `loop_counters.compile_check`
- `routeFromSource` 检查 `loop_counters.test_check`（从未增加，永远是 0）
- 导致 `test_check` 的循环计数失效，无限循环

**设计问题**：
- `FIX_LOOP_KEY` 是静态映射，假设每个 fix 节点只对应一个 check 节点
- 但 `bug_fix` 被两个 check 节点共享（compile_check 和 test_check）
- 计数器应该在边级别跟踪，而非节点级别

---

### 缺陷 5：YAML 工作流从文件系统加载

**现象**：
```typescript
// graph-runner.mts:58-64
const presetPath = join(WORKFLOWS_DIR, `${flowId}.yaml`);
if (existsSync(presetPath)) {
  const yamlContent = readFileSync(presetPath, 'utf-8');
  // ...
}
```

**问题**：
- 工作流从文件系统读取，而非 DB
- 用户无法在 Dashboard 上编辑/保存工作流
- 与"agent/skill/workflow 应该持久化到 DB"的设计目标不符

---

### 缺陷 6：前端阶段显示硬编码

**现象**：
```typescript
// TaskDetail.vue:137
const phaseOrder = ['breakdown', 'planning', 'develop', 'code', 'compile_check',
                    'test', 'test_check', 'review', 'quality_review', 'security_review',
                    'deploy', 'archive', 'final_review']  // 13 个阶段
```

**问题**：
1. 阶段列表硬编码，无法适应不同工作流
2. 实际工作流可能只有 7 个节点（default-dev-flow）
3. 进度显示 "2 / 13 阶段完成" 是错的
4. `stage` 字段没有正确更新（一直显示 planning）

**期望**：
- 阶段列表从工作流定义动态读取
- `stage` 实时反映当前执行的节点

---

### 缺陷 7：bug_fix Agent 收到错误上下文

**现象**：
日志显示 bug_fix Agent 说"请提供需要修复的具体 bug 信息"

**根因**：
1. `buildPrompt` 只传 `task.title`，没有错误详情
2. bug_fix 被触发是因为 test_check 失败
3. 但失败原因（璇玑测试失败）与任务无关
4. Agent 不知道要修什么

**设计问题**：
- 条件边触发 fix 节点时，应该传递 check 节点的错误输出
- 当前 `state.node_outputs.compile_check` 包含错误信息
- 但 bug_fix 的 prompt 没有读取这个上下文

---

### 缺陷 8：command 节点命令硬编码

**现象**：
```yaml
# default-dev-flow.yaml
- id: compile_check
  type: command
  command: npm run build    # ← 编译璇玑 V4

- id: test_check
  type: command
  command: npm test         # ← 跑璇玑 V4 测试
```

**问题**：
- 命令硬编码，不感知目标项目
- 不同项目有不同的构建/测试命令（mvn、gradle、pnpm）
- 应该从 target_repo_path 或项目配置读取

---

### 缺陷 9：没有项目管理概念

**现象**：
- 数据库没有 `projects` 表
- `target_project_id` 只是字符串字段，无外键关联
- 用户无法注册/管理多个项目

**设计问题**：
- 璇玑要处理多个项目，每个项目有不同的工作目录
- 当前设计假设只有一个目标项目

---

## 三、设计方向讨论

### 方向 1：三层分离架构

```
┌─────────────────────────────────────────────────────────────┐
│ 第 1 层：璇玑平台（持久化在 DB）                              │
│ ├── YAML workflow                                           │
│ ├── Agent 定义                                              │
│ ├── Skill 内容                                              │
│ └── 初始化时从代码目录加载 → 后续从 DB 读写                   │
└─────────────────────────────────────────────────────────────┘
                              ↓ 复制配置
┌─────────────────────────────────────────────────────────────┐
│ 第 2 层：目标项目（target_repo_path）                        │
│ ├── .claude/ 配置目录                                       │
│ │   ├── agents/                                             │
│ │   ├── skills/                                             │
│ │   └── workflows/                                          │
│ └── 用户创建需求时指定                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓ runLocal({ workDir })
┌─────────────────────────────────────────────────────────────┐
│ 第 3 层：Agent Runtime                                       │
│ ├── Claude Code CLI 在 target_repo_path 启动                │
│ ├── 读取 .claude/ 配置                                      │
│ └── 操作目标项目代码                                         │
└─────────────────────────────────────────────────────────────┘
```

### 方向 2：工作目录管理

**需求创建时**：
- 用户指定目标项目（路径或已注册的项目）
- 存入 `requirements.target_repo_path`
- 传递到所有 `tasks.target_repo_path`

**执行时**：
- `agent-node` 读取 `task.targetRepoPath` 作为 `workDir`
- 执行前复制需要的 agent/skill 配置到 `.claude/`
- `runLocal({ workDir: targetRepoPath })`

### 方向 3：命令节点动态化

```yaml
# 方案 A：模板变量
- id: compile_check
  type: command
  command: ${project.build_command}  # 从项目配置读取

# 方案 B：条件判断
- id: compile_check
  type: command
  command:
    by: project.type
    npm: npm run build
    maven: mvn compile
    gradle: ./gradlew build
```

### 方向 4：loop_counter 修复

```typescript
// 方案 A：边级别计数
// 每条 loop_back 边维护自己的计数器
loop_counters: {
  'compile_check→bug_fix': 2,
  'test_check→bug_fix': 1,
}

// 方案 B：修复 FIX_LOOP_KEY 映射
// 让 test_check 的边也正确计数
```

### 方向 5：前端阶段动态化

```typescript
// 从工作流定义读取节点列表
const phaseOrder = computed(() => {
  const workflow = await api.getWorkflow(execution.graphDefinitionId)
  return workflow.nodes.map(n => n.id)
})
```

---

## 四、优先级建议

| 优先级 | 问题 | 理由 |
|--------|------|------|
| P0 | 工作目录（缺陷 1、2） | 核心功能，Agent 在错误目录做什么都是错的 |
| P0 | 三层分离（缺陷 3） | 架构设计决策，影响全局 |
| P1 | loop_max 失效（缺陷 4） | 导致无限循环，触发 LangGraph 限制 |
| P1 | YAML 从文件加载（缺陷 5） | 用户无法自定义工作流 |
| P2 | bug_fix 上下文（缺陷 7） | Agent 不知道要修什么 |
| P2 | 命令硬编码（缺陷 8） | 不同项目构建命令不同 |
| P3 | 前端阶段（缺陷 6） | 显示问题，不影响核心流程 |
| P3 | 项目管理（缺陷 9） | 增强功能，可后续迭代 |

---

## 五、待讨论事项

1. **工作目录形态**：用户直接填本地路径？还是需要 git clone/worktree 管理？
2. **项目管理 UI**：是否需要"项目注册"入口？还是创建需求时直接填路径？
3. **.claude/ 配置**：系统预置 vs 用户自定义如何合并展示？
4. **loop_counter 方案**：边级别 vs 节点级别？哪种改动更小？

---

## 六、涉及文件

| 文件 | 问题关联 |
|------|----------|
| `packages/core/src/graph/agent-node.mts` | 工作目录、targetRepoPath 未使用 |
| `packages/core/src/graph/builder.mts` | loop_counter 机制 |
| `packages/core/src/graph/graph-runner.mts` | YAML 从文件加载 |
| `packages/core/src/routes/requirements.mts` | target_repo_path 写死 |
| `packages/core/workflows/default-dev-flow.yaml` | 命令硬编码 |
| `packages/dashboard/src/views/TaskDetail.vue` | 阶段硬编码 |
| `packages/core/prisma/schema.prisma` | 缺少 projects 表 |

---

## 七、参考

- Bug 修复记录：`docs/bugfix/2026-09-08-task-execution-flow-bug.md`
- V4 设计文档：`docs/superpowers/specs/2026-09-07-xuanji-v4-design.md`
- 用户会话讨论：2026-09-09 任务执行问题排查