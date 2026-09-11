# 流程驱动：流程控制能力补全设计

**日期**: 2026-09-11
**状态**: 待评审
**范围**: 建立 YAML 作为流程控制模型的权威 + 调度层参与流程治理

---

## 一、背景：从一次空转事故到架构诊断

### 1.1 事故（execution `4d2d1401`）

任务跑到第 5 轮时**已经成功**，流程却又空转 20 轮，直到 LangGraph 的框架步数上限（默认 25）触发。30 分钟里流程什么都没推进。

复现证据来自三处：`conversation_events`（对话与产出）、`phase_instances`（阶段执行行）、`/tmp/core-hot.log`（进程日志）。

### 1.2 现场事实（数据库 + 日志实证）

```sql
-- phase_instances：只有 3 行，且都是 attempt = 1
write_tests  attempt=1  completed
develop      attempt=1  completed
test         attempt=1  completed

-- task_executions
status        = failed
error_message = 手动终止：条件边节点 ID 不匹配导致流程卡住
execution_events 行数 = 0        ← 失败没有任何留痕
```

而 `conversation_events.final_output` 显示 `test` 节点**被复用了 12 次**：

```
#1  07:23:33  test → { ok: false, passed: false, "项目要求 Java 21 但当前环境是 Java 11" }
#2  07:27:27  test → { ok: true,  passed: true,  "编译成功，所有测试通过（57个测试，0失败）" }
#3~ #12      test → 全部 { ok: true, passed: true, 57/57 }，且多轮输出**逐字相同**
```

**关键异常：`develop` 被反复执行了十几次，`phase_instances` 里却始终只有一行 `attempt=1`；`test` 同理。** 流程以为自己在推进，数据库里却看不到任何新阶段。

---

### 1.3 Phase 1：根因追溯——从「症状」追到「架构」

#### 1.3.1 追每一层

我们已经知道：test 从第 5 轮开始报告 `ok:true, passed:true, 57/57` —— AI 没有问题。

现在从「流程」开始一层层追：

```
Layer 1: Agent 执行        → AI 报告 ok:true ✓
Layer 2: 状态写入          → node_outputs['test'] 有值 ✓
Layer 3: 条件函数读状态    → 读的是 'test_check'，不是 'test' ✗
Layer 4: 路由决策          → 路由正常，但输入恒假 ✗
Layer 5: 回环约束          → FIX_LOOP_KEY 没有 develop ✗
Layer 6: 调度层可见性      → 只知道 status='running'，看不见循环 ✗
```

Layer 3/5/6 都坏了。继续追——为什么它们是坏的？

#### 1.3.2 问「为什么」——直到无路可退

**Layer 3 为什么坏？**

```
▎ 因为 default-conditions.mts 里硬编码了 'test_check'

为什么硬编码？
▎ 因为条件函数当初是为 default-dev-flow.yaml 写的，它有 test_check 节点

为什么换 workflow 会断？
▎ 因为条件函数是「全局注册」的可复用资产，但实现里绑定了特定 workflow 的节点名

为什么没有发现？
▎ 因为加载 workflow 时不校验「条件函数引用的节点是否真的存在」

为什么没有校验？
▎ 因为 YAML 和条件函数是两个独立的东西，没人知道它们应该有绑定关系
```

**Layer 5 为什么坏？**

```
▎ 因为 FIX_LOOP_KEY 里没有 develop

为什么没有？
▎ 因为这张表是手写的，当初是为 default-dev-flow 写的

为什么换 workflow 会断？
▎ 因为这张表是硬编码在 builder.mts 里的，和 YAML 没有关系

为什么没有发现？
▎ 因为加载 workflow 时不校验「声明的 loop_max 是否有对应的计数机制」

为什么没有校验？
▎ 因为 YAML 声明的是「边」，计数器实现是「另一套东西」，两者没有绑定
```

**Layer 6 为什么坏？**

```
▎ 因为调度层只读 status 字段，不知道流程跑到哪一步了

为什么不知道？
▎ 因为流程状态（当前节点、第几轮迭代）只活在 LangGraph 内存里，没有落成调度层可读的格式

为什么没落？
▎ 因为 phase_instances 每轮都复用旧行，attempt 恒为 1

为什么复用？
▎ 因为 iteration 读 loop_counters，而 loop_counters 不递增（Layer 5 的结果）

但更根本的——调度层为什么没设计去读流程状态？
▎ 因为调度层的定位是「任务分发」，流程执行完全委托给 LangGraph
▎ 调度层从未被当作「流程治理者」——它只是一个执行派发器
```

#### 1.3.3 到了尽头——架构的隐含假设

把所有「为什么」汇总成一张表：

| 层 | 现状 | 隐含的架构假设 |
|---|---|---|
| 条件函数 | 硬编码节点 ID，全局注册 | 条件函数是「可复用资产」，但实现里绑定了特定 workflow |
| 循环约束 | FIX_LOOP_KEY 手写映射 | 约束机制是为某个特定流程设计的，不是通用的 |
| 调度层 | 只管任务派发，不管流程进度 | 流程执行是 LangGraph 的事，调度层只是外层循环 |

**共同模式：流程的「控制逻辑」散落在 YAML 之外的多个文件里，和 YAML 之间没有绑定。**

---

### 1.4 Phase 2：模式分析——「流程驱动」应该是什么

#### 1.4.1 我们宣称的目标

> 「基于流程驱动的 AI 自动研发系统」

#### 1.4.2 「流程驱动」的定义

流程要驱动，必须满足四件事——而且这四件事必须由流程自己持有：

| | 含义 | 谁来持有？ |
|---|---|---|
| ① 感知 | 流程能读到当前阶段 AI 的产出 | 流程 |
| ② 判定 | 流程能判断产出是否达标 | 流程 |
| ③ 决策 | 流程决定下一步走哪条边 | 流程 |
| ④ 约束 | 流程决定何时必须停、最多几次 | 流程 |

如果这四件事散落在不同地方，流程就不是「驱动者」，只是「参与者」。

#### 1.4.3 我们实际建的架构

```
YAML（流程图） ──→ 只是图画，没有权威
      │
      ├── 条件函数（在另一个文件里，硬编码节点名）
      ├── FIX_LOOP_KEY（在另一个文件里，手写映射）
      ├── agent prompt（在另一个目录里，不知道流程结构）
      └── 调度层（只看 status，不知道流程进度）
```

流程的四件事，没有一件真正属于流程自己。

YAML 只是在描述「流程长什么样」，但「怎么感知、怎么判定、怎么刹车」——这些真正的控制权——散落在四个不相干的地方。

**这等价于：流程不是「驱动者」，流程是「流程图渲染器」。**

它把节点连起来、按顺序调用 agent，但不感知、不判定、不设界。真正决定「下一步做什么」的，是那些它看不见的硬编码常量。

#### 1.4.4 调度层为什么没发挥作用？

因为它从未被赋予「流程治理」的职责。

设计文档里调度层的职责：
- 并发控制
- 429 重试
- 进程管理

这些都是任务级的事。一旦任务被派发给 `workerNode → graphRunner.startExecution → graph.invoke()`，调度层就完全退出了。

流程在 `graph.invoke()` 里面跑 30 分钟、循环 25 次——调度层只知道「还是 running」。它没有任何流程级预算可以检查，也没有流程状态可以观察。

**调度层被排除在「流程」之外。**

---

### 1.5 Phase 3：形成假设

**假设：我们建的不是一个「流程驱动的系统」，而是一个「AI 调用编排器」。**

证据：
1. 流程的控制权（感知/判定/约束）不在流程里，而在外部代码里
2. 流程状态不是一等对象，只是 LangGraph 的内存数据
3. 调度层不能观察流程，只能派发任务
4. 没有任何机制让「流程声明」和「流程实现」保持一致

验证方法：
如果这个假设是对的，那么：
- 修复三个 bug 后，换个 workflow 又会出同样的问题（节点名不匹配、映射表缺失）
- 调度层依然看不到流程进度，只能靠框架步数兜底

**这正是现在的情况：每次新流程都是一次手动接线，没接上就静默失效。**

---

### 1.6 Phase 4：结论——架构的根本问题

**问题不是「三个 bug」，问题是：流程的「权威」从未建立。**

我们设计了一个「流程图」，但没有设计「流程引擎」。流程图只是图形描述，真正的控制逻辑（感知/判定/约束）在别处实现，和流程图没有绑定。

换个说法：

| 期望 | 现实 |
|---|---|
| 流程决定一切 | 流程只是图画，决定权在四个不相关的文件里 |
| AI 是执行者 | AI 是执行者 ✓（这部分对了） |
| 调度层治理流程 | 调度层只派发任务，不治理流程 |
| 流程状态可见 | 流程状态活在 LangGraph 内存里，调度层看不见 |

**根因一句话：我们把「流程驱动」理解成了「按流程图顺序调用 agent」，而不是「流程持有感知/判定/决策/约束，据以驱动 agent」。**

---

### 1.7 这意味着什么？

如果要真正实现「流程驱动」，不是修三个 bug，而是重新设计流程模型的地位：

1. **YAML 不只是图，是流程的控制模型** —— 声明感知（条件边读谁）、判定（准出契约）、约束（loop_max 自计数）、数据流
2. **流程状态是一等公民** —— DB 里可查，调度层可读，可据此治理
3. **运行时从 YAML 生成，而非硬编码** —— 条件函数变成「对给定文本做判定」的纯函数，节点引用由 YAML 注入
4. **调度层参与流程治理** —— 读流程状态、执行预算、超限时中止

---

### 1.8 三个具体断点的技术细节

以上是架构层面的诊断。下面是本次事故的三个具体断点，它们共同构成了空转的物理机制：

#### 1.8.1 断点一：条件函数读错节点（感知断线）

```ts
写进去：agent-node.mts:320   node_outputs: { [nodeId]: [output] }
                             → state.node_outputs['test'] = ['{"ok":true,...}']

读出来：default-conditions.mts:51
        testPass = parseNodeOutput(state, 'test_check').ok === true
                                          ^^^^^^^^^^
        ruoyi-dev-flow.yaml 里的节点 id 是 test，不是 test_check
        → sourceText 取不到 → parseNodeOutput 返回 null
        → testPass = null?.ok === true  ≡ false   （恒假）
        → testFail = (null === null)     ≡ true    （恒真）
```

`testPass` 恒假导致流程永远走 `test_fail` 分支，`test → develop` 的回环边被无限触发。

#### 1.8.2 断点二：回环计数缺失（约束断线）

`test → develop` 声明了 `loop_max: 2`，但耗尽判定读的是 `state.loop_counters['test']`：

```ts
// builder.mts —— 计数器的唯一写入口是一张手写映射表
const FIX_LOOP_KEY: Record<string, string> = {
  bug_fix: 'compile_check',
  quality_issue_fix: 'quality_check',
  security_issue_fix: 'security_check',
  code_fix: 'code_review',
  // ← 没有 develop
};
action = withLoopCounter(action, fixKey)   // 只有表内节点才自增
```

`develop` 不在表里 → `loop_counters['test']` **永远是 0** → `done < limit` 恒真 → `loop_max: 2` 形同虚设。**这是空转的直接物理成因，比断点一更致命。**

#### 1.8.3 断点三：`attempt` 与 `session_id` 脱钩（记忆断线）

这是本次事故最隐蔽、也最容易被忽略的一层。

agent-node 计算轮次并据此查找 phase_instance：

```ts
// agent-node.mts:366
const iteration = (state.loop_counters?.[opts.nodeId] || 0);

// agent-node.mts:428  —— 用 iteration 决定 attempt
const existing = await db.phase_instances.findFirst({
  where: { execution_id: execId, phase_id: opts.nodeId, attempt: iteration + 1 },
});

// agent-node.mts:492  —— 复用已有的 session，走 resume 而非重做
resume: existingSessionId ? { providerConversationId: existingSessionId, input: promptText } : undefined
```

因为断点二里 `loop_counters['develop']` 恒为 0，`iteration` 恒为 0，于是**每次都命中第 1 行 `attempt=1` 的 phase_instance，每次都拿到同一个 `session_id`，每次都以"续话"方式调用 CLI agent**。

AI 以为自己只是在继续说上一轮的话，于是把上一轮的答案原样复述。这就是为什么 `develop` 的十几次输出逐字相同、`test` 的十几次输出也逐字相同。

**结论：流程的「进度时钟」（`loop_counters` / `phase_instances.attempt`）与 agent 的「记忆时钟」（`session_id` → `resume`）是两个互不相干的变量。回环一旦发生，两者立刻脱钩——流程以为进入第 2 轮，agent 以为还在第 1 轮。**

> **这条是本设计的第一优先级。** 只修条件函数的 `source`（断点一），`test_pass` 会恢复正常，但只要流程再触发任何一次回环，`resume` 依然会把 agent 锁死在旧会话上，空转换一种形式重演。

#### 1.8.4 三个断点为什么叠加成"无刹车"

```
testPass 恒假 ──→ 永远走 test_fail ──┐
                                     ├──→ test → develop 无限回环
loop_counters['test'] 恒 0 ──→ 回环永不耗尽 ──┘
                                     │
                                     └──→ develop 复用 attempt=1 的 session
                                          → agent 复述旧答案，无实际进展
```

每一环单独存在时都不致命（条件判错但计数器正常 → 2 轮后停下；计数缺失但条件正常 → 走对分支）。三者叠加，才形成"AI 每步都做对、流程却在原地打转"的完美空转。

---

### 1.9 附带的错误降级

`GraphRecursionError` 抛出后，异常被跨 3 层降级成 4 次「正常」：

```ts
// graph-runner.mts:307   捕获、写 DB、然后正常 return（不 rethrow）
catch (err) { await executionStore.fail(...) }
// worker-graph.mts:159   无条件报成功，不管内层死没死
await graphRunner.startExecution({...}); return { status: 'completed' }
// scheduler-graph.mts:175  worker → END
// scheduler-controller.mts:159  console.log('任务完成: ...')
```

日志实证（`/tmp/core-hot.log:921-922`，紧挨着的两行）：

```
[graph-runner] 执行出错: GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition.
[scheduler-controller] 任务完成: 4d2d1401-433f-46dd-9a9a-14fc67a9537c (running: 0)
```

同样地，失败没有留下任何 `execution_events`（0 行），事后只能靠人工翻 `conversation_events` 反推。

---

## 二、设计目标与原则

### 2.1 目标

让「流程驱动」名副其实：**流程能感知每一步的产出、判定是否达标、据此刻画下一步、在越界时强制停下、并在回环重入时让 agent 真正重做而非复述。**

### 2.2 原则

1. **声明即契约。** 流程的五件事全部在 YAML 里可见。不在代码里硬编码节点 ID，不依赖跨文件命名一致。
2. **加载即校验。** YAML 中任何引用了不存在节点的声明（条件边的 `source`、节点的 `inputs`、边的 `from/to`），在加载时 hard fail，不静默降级。
3. **不信自报，验真伪。** AI 说「测试通过」不算数，流程跑断言才算数。
4. **进度与记忆同源。** 节点「第几次执行」只有一个真相来源。该来源同时决定 `attempt`、回环计数、以及**是否复用 session**。三者不得各自演化。
5. **回环即重做。** 回环边触发时，节点必须在新会话中执行，并在 prompt 中显式带上「为什么被退回来」的上游产出。复用旧会话等同于让 agent 复述——这是本次事故的成因，不是优化。
6. **语义与治理分离。** LangGraph 管「走哪条边」（流程语义），调度层管「准不准继续走」（流程资源）。二者通过流程状态解耦。
7. **失败要响、要留痕。** 流程走到尽头而目标未达成时，明确失败；异常不得跨层降级为「完成」；任何终态失败必须写入 `execution_events`。

### 2.3 非目标（YAGNI）

- 不重构 LangGraph 编排模型（CLAUDE.md 明确「保留 LangGraph」）
- 不实现多流程并行编排
- 不实现流程图可视化编辑器的 schema 联动
- 不做 token 级成本核算（另立需求）

---

## 三、架构分层与职责边界

```
┌───────────────────────────────────────────────────────────────────┐
│ 调度层  scheduler-controller              流程资源治理（新增职责）│
│   读：流程状态（当前阶段 / 迭代轮次 / 已耗时 / agent 调用次数）   │
│   做：超预算 → 置 cancel_requested；原地打转 → 中止并写明原因     │
│   不做：不决定下一步走哪个节点                                    │
└───────────────────────────────────────────────────────────────────┘
                  ↕  phase_instances / task_executions（流程状态）
┌───────────────────────────────────────────────────────────────────┐
│ 流程层  builder + LangGraph               流程语义执行            │
│   ① 感知  按 YAML 声明的 source 读节点产出                        │
│   ② 判定  校验 exit_contract（schema + requires）                 │
│   ③ 决策  条件边路由                                              │
│   ④ 约束  loop_max 自计数，耗尽即失败                             │
│   ⑤ 记忆  按「该节点第几次真实进入」决定 重做 / 续话              │
└───────────────────────────────────────────────────────────────────┘
                  ↕  visit 计数（唯一真相来源：节点进入次数）
┌───────────────────────────────────────────────────────────────────┐
│ 执行层  agent-node + runner               单步执行                │
│   按 YAML 声明的 inputs 组装 prompt → 跑 agent → 产出写回 state   │
│   回环重入 → 开新 session（不复用）；串行续跑 → 复用 session      │
└───────────────────────────────────────────────────────────────────┘
```

**边界一句话：LangGraph 管「流程语义」（走哪条边），调度层管「流程资源」（准不准继续走），visit 计数管「这次是重做还是续话」。**

---
---

## 四、YAML Schema 扩展（核心产物）

### 4.1 完整示例

```yaml
version: "1"
id: ruoyi-dev-flow
name: 若依研发流程

# ── 流程级预算：调度层据此治理 ────────────────────────────────
budget:
  max_agent_invocations: 40        # 单次执行最多调用 agent 次数
  max_wall_clock_minutes: 120      # 墙钟上限（分钟）
  max_node_visits: 5               # 任一节点最多被访问次数

nodes:
  - id: write_tests
    type: agent
    name: 写测试
    agent_binding_ids: [test-engineer]
    inputs: [task]                 # 数据流：读哪些来源组装 prompt
    write_key: results
    exit_contract:                 # 准出契约
      schema:                      # ① 结构：AI 必须吐出的 JSON 字段
        ok: boolean
        summary: string
        test_files: string[]
        test_count: number
      requires:                    # ② 真实性：可执行断言
        - type: file_exists
          path: "{{write_tests.test_files}}"

  - id: test
    type: agent
    name: 测试验证
    agent_binding_ids: [tester]
    inputs: [task, develop]
    write_key: results
    exit_contract:
      schema:
        ok: boolean
        passed: boolean
        passed_count: number
        total_count: number
      requires:
        - type: command
          run: "mvn -q -Dmaven.test.skip=false test"
          expect_exit: 0
          timeout_seconds: 900

edges:
  - from: write_tests
    to: develop

  - from: develop
    to: test

  - from: test
    to: code_review
    condition:
      type: function
      name: test_pass               # 函数名（不再隐含节点）
      source: test                  # ← 感知：读哪个节点的产出

  - from: test
    to: develop
    condition:
      type: function
      name: test_fail
      source: test
    loop_max: 2
    on_exhausted: fail              # 回环耗尽后的行为（默认 fail）

  - from: code_review
    to: final_review
    condition: { type: function, name: code_review_pass, source: code_review }

  - from: code_review
    to: code_fix
    condition: { type: function, name: code_review_issues, source: code_review }
    loop_max: 3
    on_exhausted: fail

  - from: code_fix
    to: code_review

  - from: final_review
    to: __end__

start:
  - write_tests
```

### 4.2 字段语义

**`budget`（流程级）**

| 字段 | 含义 | 缺省 |
|---|---|---|
| `max_agent_invocations` | 单次执行最多的 agent 调用次数 | 30 |
| `max_wall_clock_minutes` | 墙钟上限 | 120 |
| `max_node_visits` | 任一节点最多被访问次数（防打转兜底） | 5 |

调度层每次轮询检查这三项，任一越界即中止本次执行（见 §7）。

**节点新增字段**

| 字段 | 含义 | 缺省 |
|---|---|---|
| `inputs` | prompt 组装的数据来源列表。取值可以是内置源 `task` / `input` / `spec`，也可以是上游节点 id | `[task]`（保持现状） |
| `exit_contract.schema` | 交付物 JSON 的字段与类型。字段名 → 类型的扁平映射 | 无（不校验结构） |
| `exit_contract.requires` | 可执行断言列表 | `[]` |

**条件边新增字段**

| 字段 | 含义 |
|---|---|
| `condition.config.source` | **必填**。该条件读哪个节点的产出。必须存在于 `nodes` |
| `on_exhausted` | 回环耗尽后的行为：`fail`（默认，执行置失败）或某个节点 id（跳转） |

**回环边的隐式语义（无需新字段）**：任何带 `loop_max` 的边，其 `target` 在被路由到时视为**回环重入**，执行层必须开新会话（§5.6）。这不需要 YAML 作者额外声明——声明了 `loop_max` 就代表"这里会重做"。

**state 新增字面量通道**：`reentry: Record<string, boolean>`（短期标记，消费后清除），由 `routeFromSource` 注入、由 `agent-node` 读取，用于区分「回环重入」与「串行续跑」。属于内部机制，不出现在 YAML 中。

**`requires` 断言类型**

| type | 字段 | 语义 |
|---|---|---|
| `file_exists` | `path` | 文件存在（相对 agent 工作目录） |
| `file_not_exists` | `path` | 文件不存在 |
| `command` | `run`, `expect_exit`, `timeout_seconds` | 执行 shell，校验退出码 |
| `grep` | `path`, `pattern`, `expect`（`present`/`absent`） | 文件内容匹配 |

断言值支持 `{{node_id.json_field}}` 模板，从该节点的交付物中取值（如 `{{write_tests.test_files}}` 展开为数组，逐项校验）。

---

## 五、运行时组件设计

### 5.1 ① 感知 —— 条件函数解耦

**现状**：`ConditionFunction = (state) => boolean`，函数体内硬编码节点 ID。

**改为**：条件函数退化为**对给定文本做判定的纯函数**，节点引用由 builder 从 YAML 注入。

```ts
// 新签名
export type ConditionFunction = (sourceText: string | null) => boolean

// 实现 —— 不再知道任何节点
export const testPass: ConditionFunction = (text) => parseOutput(text)?.ok === true
export const testFail: ConditionFunction = (text) => {
  const r = parseOutput(text)
  return r === null || r.ok === false
}
```

调用侧（`routeFromSource`）：

```ts
const fn = getCondition(e.condition.config.name)
const text = sourceText(state, e.condition.config.source)   // ← YAML 注入
if (fn(text)) return e.target
```

**收益**：同一个 `test_pass` 可以被任何 workflow 复用，无论它的节点叫什么。换流程不会再断线。

`default-conditions.mts` 中所有 `parseNodeOutput(state, '<hardcoded>')` 全部改为此形态；`keyword` 类型条件同步增加 `source`。

### 5.2 ④ 约束 + ⑤ 记忆 —— 统一 visit 计数

**现状**：`withLoopCounter` 只在 `FIX_LOOP_KEY[n.id]` 存在时应用；`routeFromSource` 读 `state.loop_counters[meta.source]`；`agent-node` 的 `iteration` 也读同一个 `loop_counters`，并据此决定 `attempt` 与是否复用 session。

**问题**：这三个消费者（回环边界、`attempt`、`session 复用`）都依赖 `loop_counters`，而 `loop_counters` 的唯一写入口是一张手写映射表。表外的节点计数恒 0，于是**边界失效、attempt 恒 1、session 永久复用**，三个 bug 同源。

**改为**：**所有节点**执行完毕自增自己的计数器，成为「该节点被进入的次数」的**唯一真相来源**；三个消费者全部改读它。

```ts
// builder.mts —— 每个节点统一包装，不再查映射表
action = withLoopCounter(action, n.id)      // key = 节点自己的 id

// 删掉整张 FIX_LOOP_KEY
```

**语义定义（唯一口径）**：

```
visits[nodeId] = 该节点「已完成的执行次数」
  首次进入前 = 0
  第 1 次执行完成后 = 1
  第 N 次执行完成后 = N

三处消费者统一使用：
  attempt       = visits[nodeId] 未执行时为 0 → 本次 phase_instance 的 attempt = visits + 1
  回环判定       = visits[source]（回环源节点已完成的次数）
  记忆决策       = 本次进入是否由回环边触发（见 §5.6）
```

**回环耗尽语义**：

```ts
// 语义：loop_max: N 表示「该节点最多因回环被重新执行 N 次」
// visits = 该节点已完成的次数（含首次进入，首次不算回环）
// 可回环的次数 = limit

const loopBack = meta.edges.find(e => e.loop_back)
if (loopBack) {
  const visits = state.loop_counters?.[meta.source] ?? 0   // 已完成的次数
  const limit = loopBack.loop_max ?? DEFAULT_MAX
  if (visits <= limit) return loopBack.target
  // 耗尽：不再静默落到默认边/END
  if (!loopBack.on_exhausted || loopBack.on_exhausted === 'fail') {
    throw new LoopExhaustedError(meta.source, limit)
  }
  return loopBack.on_exhausted
}
```

> **边界必须与写入点同步改。** 现有 `routeFromSource` 写的是 `if (done < limit)`，按新口径必须是 `if (visits <= limit)`。两者不一致会让 `loop_max: 2` 少跑一轮。这是实施时最容易漏的一处。
>
> **语义校验**：`loop_max: 2` + `test → develop` 的确切行为 —— test 第 1 次完成（visits=1 ≤ 2）→ 回退；第 2 次完成（visits=2 ≤ 2）→ 回退；第 3 次完成（visits=3 > 2）→ 回环耗尽，抛 `LoopExhaustedError`。即 test 最多运行 3 次。

**这条修复本身就挡住本次事故的大半**：即使条件函数依然判错，2 轮后流程也会明确失败，而不是空转。

### 5.3 ② 判定 —— 准出契约

执行位置：`agent-node` 内，agent 返回之后、写 state 之前。

```
1. 定位工作目录（与 agent 相同：worktree 或 target_repo_path）
2. schema 校验：解析 AI 输出的 JSON，逐字段比对类型
3. requires 校验：展开模板 → 依次执行断言
4. 合成 verdict：
   全部通过 → node_outputs[nodeId] = AI 原始输出
   任一失败 → node_outputs[nodeId] = {
                ok: false,
                contract_failed: true,
                failures: [{ type, detail }],
                ai_claimed: { ...AI 的 ok/summary，供审计 }
              }
5. AI 原始输出另存 phase_outputs（审计留痕）
```

**关键设计：契约失败不改路由逻辑，只改数据。** 合成的 verdict 里 `ok: false`，条件函数照常读到 false 并走失败分支 —— 流程不需要为「契约失败」特例化。

```ts
// test 的真实断言失败 → develop 修
// write_tests 的文件不存在 → 合成 ok:false → 走该节点的失败边（若 YAML 声明了）
```

> **运行期规则**：若节点的准出契约失败，且该节点**没有任何带条件的出边**（即没有失败去向），执行立即置为 failed，`error_message` 写明「节点 X 的准出契约未通过，且该节点未声明失败分支」。绝不静默放行。

### 5.4 数据流 —— `inputs` 声明

**现状**：`buildAgentContext(state, contextKey)` 只读静态的 `state.task` / `state.spec` / `state.input`。

**改为**：按节点声明的 `inputs` 组装。

```ts
function buildAgentContext(state, inputs: string[]): string {
  const parts: string[] = []
  for (const src of inputs) {
    if (src === 'task')       parts.push(formatTask(state.task))
    else if (src === 'input') parts.push(state.input ?? '')
    else if (src === 'spec')  parts.push(formatSpec(state.spec))
    else {
      const out = sourceText(state, src)          // 上游节点产出
      if (!out) throw new UpstreamMissingError(src)
      parts.push(`## 上游阶段产出：${src}\n\n${out}`)
    }
  }
  return parts.join('\n\n---\n\n')
}
```

**效益**：`test` 失败回到 `develop` 时，`develop` 声明 `inputs: [task, test]` 就能读到测试失败报告 —— 这正是 `4d2d1401` 里缺失的「为什么回来」。

### 5.5 加载时契约校验

在 `buildGraphFromDef(yamlContent)` 内，编译图之前执行。任一条不通过即 **throw**，`startExecution` 捕获后把 execution 置为 failed 并写入具体原因。

| # | 校验 | 违反后果 |
|---|---|---|
| V1 | `start` 中每个节点存在 | throw |
| V2 | 每条边的 `from` / `to` 存在（`__end__` 除外） | throw |
| V3 | 每条 `function` 条件的 `source` 非空且存在于 `nodes` | throw |
| V4 | 每个节点的 `inputs` 中，非内置源的项必须存在于 `nodes` | throw |
| V5 | `loop_max` 只出现在条件边上，且该条件有 `source` | throw |
| V6 | 节点的 `exit_contract.requires` 中模板引用的 `node_id` 存在 | throw |
| V7 | `on_exhausted` 若非 `fail` 则必须是已存在的节点 id | throw |

V3 是本设计的核心价值：**「条件函数读错节点」这类错误从此不可能静默存活。**

**V7 之后刻意不再校验「有契约的节点必须具备失败分支」** —— 那会强迫流程作者为每个节点硬造一条失败边。改为运行期规则（见 §5.3）：契约失败且该节点没有条件出边时，执行立即失败。作者要么给出失败去向，要么让流程明确失败，两条路都不会静默通过。

---

### 5.6 ⑤ 记忆 —— 回环重入必须开新会话

**现状**（本次事故最隐蔽的成因）：

```ts
// agent-node.mts:366  iteration 只从 loop_counters 取
const iteration = (state.loop_counters?.[opts.nodeId] || 0);

// agent-node.mts:428  用它查已有 phase_instance
const existing = await db.phase_instances.findFirst({
  where: { execution_id: execId, phase_id: opts.nodeId, attempt: iteration + 1 },
});

// agent-node.mts:492  复用它的 session → "续话"而非"重做"
resume: existingSessionId
  ? { providerConversationId: existingSessionId, input: promptText }
  : undefined
```

`loop_counters[develop]` 恒为 0（§1.4）→ `attempt` 恒为 1 → 每次都命中第 1 行、每次都拿到同一个 `session_id`、每次都走 `resume`。CLI agent 以为自己在继续上一轮对话，于是把旧答案原样复述。这就是十几次输出逐字相同的物理原因。

**改为**：session 复用必须由**进入方式**决定，而不是由"是否存在旧行"决定。

| 进入方式 | 语义 | session 行为 |
|---|---|---|
| **首次进入** | 该节点第一次执行 | 新 session |
| **串行续跑**（同一轮被中断后恢复，如 429 重试 / gate resume） | 还是那一次执行 | **复用** session（保留上下文） |
| **回环重入**（由带 `loop_back` 的边进入） | 一次全新的执行 | **开新 session**，且 prompt 必须带上"为什么被退回来" |

```ts
// builder.mts —— 路由时标记本次进入是否为回环重入
g.addConditionalEdges(source, (state) => {
  const target = routeFromSource(state, route)
  if (route.edges.find(e => e.loop_back && e.target === target)) {
    return new Command({ goto: target, update: { reentry: { [target]: true } } })
  }
  return target
})

// agent-node.mts —— 据 reentry 决定是否复用
const isReentry = state.reentry?.[opts.nodeId] === true
const existingSessionId = isReentry ? undefined : phaseInstance?.sessionId
```

**与 §5.4 的联动**：回环重入时不能只是"开新会话"——新会话意味着 agent 丢掉了全部上下文，比复述更糟。因此**声明了 `loop_back` 边指向的节点，必须声明 `inputs` 覆盖"退回原因"**。典型形态：

```yaml
- id: develop
  inputs: [task, test]        # test 的产出里含失败原因
```

§5.4 的 `UpstreamMissingError` 在此承担守门职责：回环重入时如果上游产出读不到，明确失败，绝不让 agent 在无上下文的情况下重做。

> **规则**：`reentry` 标记是一次性的，消费后清除，避免持久化在 checkpoint 里污染后续轮次。
>
> **回归断言**：同一节点第 2 次进入（回环重入）时，传给 `runLocal` 的 `resume` 必须是 `undefined`，且 prompt 必须包含上游产出。

## 六、流程状态模型

调度层要治理，必须有可读的流程状态。

### 6.1 `phase_instances`（已有表，语义补全）

`attempt` 在 §5.2 修复后自然正确（每轮循环独立一行）。语义定义：

| 字段 | 语义 |
|---|---|
| `phase_id` | 节点 id |
| `attempt` | 该节点第几次被访问（从 1 开始），由 `visits[nodeId] + 1` 得出（§5.2） |
| `session_id` | 本次执行的会话 id。**回环重入时为新的 id；串行续跑时复用旧 id**（§5.6） |
| `status` | running / completed / failed / **contract_failed**（新增枚举值） |
| `started_at` / `completed_at` | 本轮起止 |

**执行器不变量**：
- 复用已有行时，必须重置 `status = 'running'` 与 `started_at`。
- **`attempt` 递增的行，`session_id` 必须是新值或 null**。若出现"`attempt` 递增但 `session_id` 与上一行相同"，即为 §1.5 的空转形态，应当作为可观测告警（见 §6.3）。

> 本次事故的可观测特征正是：`phase_id = develop` 全程只有 `attempt = 1` 一行，却被复用了十余次。修复后这张表应能如实反映"develop 被真正执行了 N 次"。

### 6.2 `task_executions`（已有表，新增计数）

| 字段 | 语义 |
|---|---|
| `agent_invocations`（新增 Int，默认 0） | 本执行累计调用 agent 次数。每次 agent-node 开始时 +1 |
| `graph_definition_id` | 已用于指明流程（已有） |

> `agent_invocations` 计的是**真实调用次数**（含回环重入），不是 LangGraph 的步数。两者不可混用：本次事故中步数触顶 25，真实调用约 12 次。

`budget` 快照在执行开始时从流程定义写入（避免流程定义变更影响在跑的执行）：

| 字段 | 语义 |
|---|---|
| `budget_max_agent_invocations`（新增 Int?） | 预算快照 |
| `budget_max_wall_clock_minutes`（新增 Int?） | 预算快照 |
| `budget_max_node_visits`（新增 Int?） | 预算快照 |

### 6.3 状态查询

调度层每次轮询（5s）对每个 `running` 的 execution 执行：

```sql
-- 打转检测：任一节点的最大访问次数
SELECT phase_id, max(attempt) AS visits
FROM phase_instances WHERE execution_id = ?
GROUP BY phase_id ORDER BY visits DESC LIMIT 1;

-- 预算检查
SELECT agent_invocations, started_at, budget_* FROM task_executions WHERE execution_id = ?;

-- 空转检测（新增）：同一节点 attempt 递增但 session_id 未变
SELECT phase_id, count(*) AS rows, count(DISTINCT session_id) AS sessions
FROM phase_instances WHERE execution_id = ?
GROUP BY phase_id HAVING count(*) > count(DISTINCT session_id);
```

最后一条查询是**本次事故的专用探针**：它能在空转发生的当场（而不是 30 分钟后）报警。

---

## 七、调度层监督

### 7.1 检查项

```ts
// scheduler-controller.mts —— 每个 running execution
if (agent_invocations >= budget_max_agent_invocations)
  → 中止，原因：「超出预算：已调用 Agent ${n} 次（上限 ${m}）」

if (now - started_at > budget_max_wall_clock_minutes)
  → 中止，原因：「超出预算：已运行 ${n} 分钟（上限 ${m}）」

if (max(phase_instances.attempt) > budget_max_node_visits)
  → 中止，原因：「流程疑似打转：节点 ${phase_id} 已执行 ${n} 次（上限 ${m}）」

// 新增：会话未重置检测（§1.5 的专用探针）
if (同一 phase_id 的 phase_instances 行数 > distinct session_id 数 + 容忍度)
  → 中止，原因：「节点 ${phase_id} 重复进入但会话未重置，疑似空转」
```

**优先级：`max_node_visits` 高于 `loop_max`。** 前者是流程级兜底，不依赖「回环边声明正确」，能兜住本次这种「计数缺失导致的假性回环」；后者是单边的语义约束。两者都命中时，先触发哪个都可能，但 `max_node_visits` 必须存在——否则任何一次「回环边声明有误 / 计数器没喂上」都会重新退化成 30 分钟空转。

### 7.2 中止通道 —— 复用现有机制

**不新增取消机制。** 中止动作就是把现有的人工取消通道自动化：

```
调度层写 task_executions.control_status = 'cancel_requested'
        + error_message = <具体原因>
   ↓
graph-runner 的心跳循环（每 HEARTBEAT_INTERVAL_MS）读到
   ↓
abortController.abort() → 当前 agent CLI 进程终止
   ↓
startExecution 的 catch 分支读 control_status → executionStore.fail(executionId, 原因)
```

**这套通道已经存在且已验证**（`graph-runner.mts:199-207`），调度层只是从「人触发」变成「策略触发」。

### 7.3 职责边界

调度层**只做减法**：能中止，不能推进、不能改路由、不能插入节点。这样它不需要理解研发流程语义，只需要理解预算。

---

## 八、错误处理

### 8.1 异常不得跨层降级（修复 §1.9）

| 位置 | 现状 | 改为 |
|---|---|---|
| `graph-runner.startExecution` | catch 后 `fail()` 再正常 return | 返回结构化结果 `{ ok: false, reason }`，**或** rethrow |
| `worker-graph.workerNode` | 无条件 `return { status: 'completed' }` | 依据 `startExecution` 的结果返回 `completed` / `failed` |
| `scheduler-controller` | 对失败任务也打印「任务完成」 | 区分「完成」与「失败」两条日志，失败额外记录原因 |

### 8.2 失败必须留痕

`executionStore.fail()` 目前只写 `task_executions`，导致 `execution_events` 表在本次事故中 **0 行** —— 事后只能靠人工翻 39914 行 `conversation_events` 反推发生了什么。改为同时写一条 `execution_events`（`event_type='failed'`，含 `from_status`/`to_status`/`message`）。

> **为什么这条排在最前面**：没有留痕，后面所有治理都是盲的。本次事故的定位成本几乎全部来自"系统里没有记录"，而不是"问题本身难"。
>
> **附加要求**：`LoopExhaustedError` / 预算中止 / `GraphRecursionError` 三类终止都必须留下结构化事件，且 `message` 里包含**节点名与次数**，便于直接定位。

### 8.3 新增错误类型

| 错误 | 触发 | 处理 |
|---|---|---|
| `WorkflowValidationError` | 加载时 V1–V8 任一失败 | execution 置 failed，`error_message` 列出全部违规项（不是第一条） |
| `LoopExhaustedError` | 回环耗尽且 `on_exhausted: fail` | execution 置 failed，写明「节点 X 回环 N 次仍未通过」 |
| `UpstreamMissingError` | `inputs` 引用的上游无产出 | execution 置 failed |
| `ContractViolationError` | 准出契约失败 | **不抛错** —— 合成 verdict 走正常路由 |

---

## 九、存量流程迁移

校验是 hard fail，因此以下流程必须在同一次改动中升级，否则无法加载：

| 流程 | 改动 |
|---|---|
| `workflows/ruoyi-dev-flow.yaml` | 所有条件边补 `source`；节点补 `inputs` / `exit_contract`；补 `budget`；**`develop` 必须声明 `inputs: [task, test]`**（回环重入时携带失败原因）|
| `workflows/default-dev-flow.yaml` | 同上。该流程的节点名（`test_check` 等）与旧条件函数一致，但函数签名变更后仍需补 `source` |
| `workflows/requirement-decomposition.yaml` | 无条件边，仅补 `inputs` / `budget`（`spec` 源已在用） |
| DB 中的 `graph_definitions` | 用户流当前不支持执行（`loadFlow` 已明确 return null），本次不处理 |

**决策：`exit_contract` 在首个版本中为可选字段。** 未声明即不做契约校验，保持向后可运行；但 `source` / `inputs` / `budget` 的校验是强制的（这三项缺失正是本次事故的直接原因）。

---

## 十、测试策略

| 层 | 用例 |
|---|---|
| 契约校验 | V1–V7 每条各一个反例，断言 throw 且 message 含违规详情；合法流程不 throw |
| 条件函数 | 新签名下的 `testPass` / `testFail`：给定 `{"ok":true}` → pass=true / fail=false；给定 `null` → pass=false / fail=true |
| visit 计数 | 同一节点连续访问 N 次，断言 `loop_counters[nodeId] === N`；`loop_max: 2` 时**第 3 次完成后**抛 `LoopExhaustedError`（边界回归：`<` vs `<=`） |
| **回环记忆**（P0） | 同一节点回环重入时，断言传给 `runLocal` 的 `resume === undefined`；串行续跑（429 / gate resume）时断言 `resume` 被复用。**回归 4d2d1401 的核心机制** |
| 准出契约 | schema 缺字段 / 类型不符 → 合成 verdict `ok:false`；`file_exists` 断言指向不存在文件 → 同上；`command` 退出码非 0 → 同上 |
| 数据流 | `inputs: [task, test]` 时 prompt 含测试报告；引用不存在的源 → 加载时 throw |
| 调度层预算 | 构造超 `max_node_visits` 的执行，断言 `control_status` 被置为 `cancel_requested` 且 `error_message` 含节点名与次数 |
| 错误不降级 | mock `startExecution` 抛错，断言 `workerNode` 返回 `failed`，调度层不打印「任务完成」 |
| 失败留痕 | 构造 `LoopExhaustedError`，断言 `execution_events` 有 `event_type='failed'` 且 message 含节点名与次数 |
| 端到端 | mock 流程：test 首次失败 → 回 develop → 第二次通过 → 进 code_review。断言总 agent 调用次数 = 4，第 2 轮 develop 的 prompt 含测试失败报告，且第 2 轮 develop 的 `attempt === 2`、`resume === undefined` |

**端到端用例是本设计的验收标准**：同样的场景在事故中是超时+空转，修复后必须是 4 次调用、且第 2 次 develop 是真正的重做而非复述。

**注意量级口径**：`Recursion limit of 25` 是 LangGraph 步数预算，与 agent 调用次数无关。断言必须落在"agent 调用次数"与"develop 的 attempt/session 行为"上，不要用 25 这个数字做基准。

---

## 十一、实施顺序

按「先留痕、再止血、后补能力、最后上治理」排列，每步独立可验证：

1. **失败留痕 + 错误不降级**（§8）—— 先让系统能说话。没有这一步，后面每一步出问题都要靠人工翻日志。**P0**
2. **统一 visit 计数 + 回环开新会话**（§5.2 + §5.6）—— 本次事故的直接物理成因，两条必须同一步落地（计数是 session 决策的输入，拆开做会做出错误行为）。**P0**
3. **条件边 `source` 注入 + 契约校验**（§5.1 + §5.5）—— 让「读错节点」不可能静默发生
4. **准出契约**（§5.3）—— 判定能力
5. **数据流 `inputs`**（§5.4）—— 回环重做的上下文载体（与第 2 步配合才完整）
6. **调度层监督 + `max_node_visits` 兜底**（§6 + §7）—— 流程资源治理

**第 1、2 步合起来即可拦住 `4d2d1401` 的完整因果链**：留痕让失败可见，visit 计数让回环耗尽，开新会话让重做是真重做。

> **为什么第 2 步必须先于第 3 步**：只补 `source` 而不改记忆机制，`testPass` 会恢复正常，但下一个流程只要再触发任意一次回环，`resume` 依然把 agent 锁死在旧会话上——空转换个形式重演。条件判定和记忆重置是正交的两件事。

---

## 十二、验收标准

- [ ] 加载一个条件边 `source` 指向不存在节点的 YAML，启动时明确报错并指出具体违规项
- [ ] 构造条件函数恒假的流程且 `loop_max: 2`，流程在回环耗尽后失败，**不**空转到 LangGraph 步数上限
- [ ] 同一节点回环重入时，`runLocal` 收到的 `resume` 为 `undefined`（新会话），prompt 含上游产出
- [ ] 同一节点串行续跑（429 重试 / gate resume）时，`resume` 被复用
- [ ] 回环重入产生的 `phase_instances` 行 `attempt` 严格递增，`phase_id` 相同但 `session_id` 不同
- [ ] 构造 AI 自报 `ok:true` 但 `requires` 断言失败的节点，流程判定为失败并走失败分支
- [ ] 循环第 2 轮时，下游节点 prompt 含上游阶段产出
- [ ] 超预算执行被调度层中止，`error_message` 含具体预算项与数值
- [ ] `GraphRecursionError` 场景下，调度层不再打印「任务完成」
- [ ] 任何终态失败都写入 `execution_events`（`event_type='failed'`，含节点名与次数）
- [ ] 端到端：test 失败 → 修复 → 通过 → 进入 code_review，总 agent 调用 4 次，第 2 轮 develop 为真正重做

---

## 附录：相关文件

| 文件 | 本次涉及 |
|---|---|
| `packages/core/src/graph/conditions/default-conditions.mts` | 条件函数签名重构 |
| `packages/core/src/graph/conditions/index.mts` | 注册表 + 新签名 |
| `packages/core/src/graph/conditions/source-text.mts` | 保持（已被正确使用） |
| `packages/core/src/graph/builder.mts` | 删 `FIX_LOOP_KEY`、全节点包装计数器、**回环边界 `<` → `<=`**、`reentry` 标记注入、契约校验、路由注入 source |
| `packages/core/src/graph/types.mts` | `WorkflowNode` / `WorkflowEdge` / `WorkflowDef` 扩展 |
| `packages/core/src/graph/agent-node.mts` | `inputs` 组装、准出契约执行；**`iteration` 改读 `visits`；回环重入强制 `resume: undefined`**（§5.6，P0）|
| `packages/core/src/graph/yaml-loader.mts` | 新字段映射 |
| `packages/core/src/graph/graph-runner.mts` | 错误不降级、失败留痕、预算快照 |
| `packages/core/src/graph/worker-graph.mts` | 状态传递不降级 |
| `packages/core/src/scheduler-controller.mts` | 预算检查 + 自动中止 + 会话未重置探针（§6.3）|
| `prisma/schema.prisma` | `agent_invocations` + 3 个 budget 快照字段；`phase_instances.status` 增加 `contract_failed` |
| `packages/core/workflows/*.yaml` | 3 个流程迁移 |
