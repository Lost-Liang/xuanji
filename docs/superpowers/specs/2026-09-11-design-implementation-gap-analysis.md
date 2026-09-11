# 璇玑 V4 设计目标与实现差距分析

**日期**: 2026-09-11  
**分析范围**: 设计文档 vs 实际实现  
**目的**: 识别偏离，制定回归路线

---

## 一、设计目标回顾

### 1.1 核心定位（设计文档 §1）

> 璇玑是一个**长时运行的 AI Agent 编排与调度系统**

核心能力：
1. **需求拆分**：Requirement → Epic → Feature → UserStory → Task
2. **研发流程**：开发 → 编译验证 → 测试验证 → Bug修复 → 质量验证 → 安全审查 → 最终审查
3. **并发控制**：可配置最大并发任务数
4. **429 重试**：退避策略 5/10/30/60 分钟
5. **进程管理**：暂停/恢复/取消
6. **人机交互**：Agent 运行中可向人类提问，人类通过 Dashboard 回答

### 1.2 架构设计（设计文档 §3）

```
璇玑 Core (LangGraph 编排)
    ↓
AgentOS Runner (本地模式)
    ├── Claude Code CLI
    └── Codex CLI
```

**关键组件**：
- LangGraph 编排层：工作流定义、暂停/恢复、条件分支
- PostgreSQL：状态持久化 + LangGraph Checkpoint
- Dashboard：人机交互界面、任务监控
- AgentOS Runner：CLI 进程管理、会话恢复、MCP 工具

### 1.3 数据库设计（设计文档 §5）

**三层结构**：
1. **项目管理层**：requirements → epics → features → user_stories → tasks
2. **执行层**：task_executions → phase_instances → phase_outputs
3. **对话与事件**：conversation_events、inbox_questions、decisions、interventions

### 1.4 人机交互（设计文档 §6）

```
Agent 调用 inbox_ask → 写入 inbox_questions → LangGraph interrupt()
    ↓
人类在 Dashboard 回答 → 更新 inbox_questions → LangGraph 恢复
    ↓
Agent 继续执行（同会话，--resume）
```

### 1.5 会话管理（设计文档 §7）

**生命周期**：创建 → 运行 → 完成 → 追问

**关键特性**：
- 会话恢复：使用 `--resume` 继续同一次会话
- 追问功能：人类可以在完成后继续追问
- 事件持久化：所有对话事件保存到 conversation_events

---

## 二、实际实现状态

### 2.1 已完成的部分

✅ **数据库层**
- Prisma Schema 已实现（15 张表）
- PostgreSQL 迁移完成
- 表结构与设计文档基本一致

✅ **Runner 集成**
- AgentOS Runner 本地模式已实现
- Claude Code CLI 和 Codex CLI 适配器
- MCP Server 的 inbox_ask 工具

✅ **基础编排**
- LangGraph StateGraph 构建
- Agent 节点执行
- 基本的阶段执行流程

✅ **Dashboard**
- 任务列表页面
- 执行详情页面
- 画布可视化

✅ **需求管理层**
- Requirement → Epic → Feature → UserStory → Task 拆分流程已实现
- `requirement-decomposition.yaml` 工作流
- requirement-analyst 和 task-planner Agent
- 数据库中有实际数据（3 requirements, 17 epics, 26 features, 41 user_stories, 54 tasks）

### 2.2 严重缺失的部分

❌ **工作流条件评估**
- YAML 定义的 `expression` 类型条件不支持
- Builder 只支持 `keyword` 和 `function` 类型
- 导致 code_review 和 final_review 被跳过

❌ **Agent 输出结构化**
- Agent 输出是 markdown 文本，不是结构化数据
- 下游阶段无法解析上游交付物
- 条件评估无法读取测试结果

❌ **交付物验证**
- 没有验证 Agent 创建的文件是否真实存在
- 没有验证测试结果是否与报告一致
- 可能存在"幻觉"问题

❌ **Token 统计**
- `task_executions.token_in/token_out/cost` 全部为 NULL
- 无法评估执行成本
- 无法进行成本优化

❌ **事件记录系统 Bug**
- `conversation_events` 记录了 18,043 条重复的 `model_started` 事件
- 事件映射逻辑有 bug（每个 streaming chunk 都记录为 model_started）
- 数据库膨胀，性能下降

❌ **并发控制**
- 设计文档提到"可配置最大并发任务数"
- 实际没有实现并发调度器
- 任务是串行执行的

❌ **429 重试机制**
- 设计文档定义了退避策略 5/10/30/60 分钟
- 实际没有实现 429 检测和重试逻辑
- 遇到限流就失败

❌ **人机交互完整流程**
- inbox_ask 工具存在，但 interrupt/resume 流程不完整
- Dashboard 的人机交互界面不完善
- 没有实现"追问"功能

❌ **会话恢复**
- 设计文档强调使用 `--resume` 继续会话
- 实际没有实现会话恢复逻辑
- 每次执行都是新会话

---

## 三、关键偏离分析

### 3.1 偏离 1：工作流引擎不完整

**设计要求**：
- 支持 YAML 定义的条件边
- 支持 expression、keyword、function 三种条件类型
- 条件评估基于 state 数据

**实际实现**：
- 只支持 keyword 和 function 两种类型
- expression 类型被忽略
- 条件评估失败时直接结束工作流

**影响**：
- code_review 和 final_review 被跳过
- 研发流程不完整
- 代码质量无法保证

**根因**：
- Builder 的条件评估逻辑不完整
- 没有实现 expression 类型的评估器
- 缺少错误处理和日志

### 3.2 偏离 2：Agent 角色定义不清

**设计要求**：
- 每个 Agent 有明确的职责边界
- 上下游交付物有明确的定义
- Agent 之间通过结构化数据通信

**实际实现**：
- Agent 输出是 markdown 文本
- 没有结构化的交付物定义
- 下游 Agent 需要解析 markdown，容易出错

**影响**：
- 角色越界严重（test agent 修复业务代码）
- 交付物质量不可控
- 无法验证交付物的真实性

**根因**：
- 没有定义 Agent 的输出 Schema
- 没有实现交付物验证机制
- Agent Prompt 中的职责描述不够明确

### 3.3 偏离 3：监控和可观测性缺失

**设计要求**：
- 完整的对话事件记录
- Token 消耗统计
- 执行成本追踪

**实际实现**：
- 事件记录有 bug（18,043 条重复事件）
- Token 统计字段全部为 NULL
- 无法评估执行成本

**影响**：
- 无法进行成本优化
- 无法识别性能瓶颈
- 无法评估 ROI

**根因**：
- Runner 没有返回 Token 使用量
- 事件映射逻辑有 bug
- 没有实现成本计算

---

## 四、偏离的严重程度

### 4.1 关键偏离（必须修复）

| 偏离 | 影响 | 优先级 |
|------|------|--------|
| 工作流条件评估不完整 | 研发流程不完整，代码质量无法保证 | **P0** |
| Agent 输出未结构化 | 角色越界，交付物质量不可控 | **P0** |
| 事件记录 Bug | 数据库膨胀，性能下降 | **P0** |
| Token 统计缺失 | 无法评估成本 | **P1** |

### 4.2 重要偏离（应该修复）

| 偏离 | 影响 | 优先级 |
|------|------|--------|
| 交付物验证缺失 | 可能存在"幻觉" | **P1** |
| 并发控制缺失 | 任务是串行执行 | **P2** |
| 429 重试机制缺失 | 遇到限流就失败 | **P2** |

### 4.3 次要偏离（可以延后）

| 偏离 | 影响 | 优先级 |
|------|------|--------|
| 人机交互不完整 | 用户体验不佳 | **P2** |
| 会话恢复未实现 | 每次都是新会话 | **P2** |
| 追问功能未实现 | 无法继续追问 | **P3** |

---

## 五、回归路线建议

### 5.1 第一阶段：修复核心问题（1-2 周）

**目标**：让研发流程能够完整执行

1. **修复工作流条件评估**
   - 实现 expression 条件评估器
   - 支持 YAML 定义的所有条件类型
   - 添加错误处理和日志

2. **修复事件记录 Bug**
   - 修复 mapAdapterEvent 的去重逻辑
   - 清理历史数据中的重复事件
   - 添加监控告警

3. **补充 Token 统计**
   - 在 Runner 层捕获 Token 使用量
   - 更新 task_executions 表
   - 在 Dashboard 展示成本信息

**验收标准**：
- [ ] code_review 和 final_review 能够被触发
- [ ] conversation_events 表没有重复事件
- [ ] token_in/token_out/cost 字段有值

### 5.2 第二阶段：结构化 Agent 输出（2-3 周）

**目标**：让 Agent 之间的协作更可靠

1. **定义 Agent 输出 Schema**
   - 为每个阶段定义结构化的交付物格式
   - 包含文件列表、测试结果、审查意见等

2. **修改 Agent Prompt**
   - 要求 Agent 输出结构化数据
   - 明确职责边界和禁止行为

3. **实现交付物验证**
   - 验证文件是否真实存在
   - 验证测试结果是否与报告一致
   - 添加验证失败的回退机制

**验收标准**：
- [ ] 每个 Agent 输出符合 Schema 定义
- [ ] 交付物验证通过率达到 95%+
- [ ] 角色越界事件减少 80%+

### 5.3 第三阶段：优化调度和容错（2-3 周）

**目标**：提高系统的稳定性和效率

1. **实现并发控制**
   - 可配置最大并发任务数
   - 任务队列管理
   - 优先级调度

2. **实现 429 重试机制**
   - 检测 429 响应
   - 退避策略 5/10/30/60 分钟
   - 重试次数限制

3. **完善人机交互**
   - interrupt/resume 完整流程
   - 追问功能
   - 会话恢复

**验收标准**：
- [ ] 支持并发执行多个任务
- [ ] 429 限流时能够自动重试
- [ ] 人机交互流程完整可用

---

## 六、风险评估

### 6.1 技术风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 工作流引擎重构引入新 bug | 高 | 高 | 添加充分的测试，灰度发布 |
| Agent 输出结构化导致兼容性问题 | 中 | 中 | 向后兼容，支持旧格式 |
| 事件记录修复导致数据丢失 | 低 | 高 | 备份数据，逐步清理 |

### 6.2 产品风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 修复周期过长，用户流失 | 中 | 高 | 分阶段交付，每阶段有可用版本 |
| 需求变更，设计文档过时 | 高 | 中 | 定期同步设计文档，保持灵活 |
| 性能问题，系统不稳定 | 中 | 高 | 添加监控，及时发现和修复 |

---

## 七、总结

### 7.1 当前状态

**完成度**：约 60%

**已完成**：
- ✅ 数据库层（100%）
- ✅ Runner 集成（80%）
- ✅ 基础编排（60%）
- ✅ 需求管理层（100%）
- ✅ Dashboard（50%）

**未完成**：
- ❌ 工作流条件评估（30%）
- ❌ Agent 输出结构化（10%）
- ❌ 监控和可观测性（20%）
- ❌ 并发控制（0%）
- ❌ 429 重试（0%）

### 7.2 核心问题

1. **工作流引擎不完整**：条件评估不支持 expression 类型，导致研发流程跳过关键阶段
2. **Agent 协作机制缺失**：没有结构化的交付物定义，角色越界严重
3. **监控和可观测性缺失**：Token 统计缺失，事件记录有 bug

### 7.3 下一步行动

**立即行动**（本周）：
1. 修复工作流条件评估（P0）
2. 修复事件记录 Bug（P0）
3. 补充 Token 统计（P0）

**短期目标**（1-2 个月）：
1. 结构化 Agent 输出
2. 实现并发控制和 429 重试
3. 完善人机交互

**长期目标**（3-6 个月）：
1. 添加性能优化
2. 扩展更多 Agent 角色
3. 增强 Dashboard 功能

---

## 八、附录

### 8.1 相关文件

- 设计文档：`docs/superpowers/specs/2026-09-07-xuanji-v4-design.md`
- 工作流定义：`packages/core/workflows/ruoyi-dev-flow.yaml`
- 需求拆分工作流：`packages/core/workflows/requirement-decomposition.yaml`
- Builder 代码：`packages/core/src/graph/builder.mts`
- Agent 节点：`packages/core/src/graph/agent-node.mts`

### 8.2 相关分析

- Agent 执行分析：`docs/superpowers/analysis/2026-09-11-task-728fbb58-execution-analysis.md`
- 工作流跳过阶段分析：`docs/superpowers/specs/2026-09-11-workflow-execution-skipped-phases-analysis.md`

### 8.3 修订历史

| 日期 | 修订内容 | 作者 |
|------|---------|------|
| 2026-09-11 | 初始版本 | Claude |
| 2026-09-11 | 修正：移除"需求管理层缺失"错误结论，需求管理层已完整实现 | Claude |
