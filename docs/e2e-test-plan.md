# 璇玑 V4 E2E 测试计划（含 Chrome DevTools MCP 操作）

## 测试目标

验证璇玑 V4 核心流程的正确性：
1. 需求创建与拆解（requirement-decomposition 工作流）
2. 任务确认与自动调度
3. 任务执行流程（ruoyi-dev-flow 工作流）
4. 连续任务执行与完成验证

## 核心验证点

### 验证点1：工作流流转正确性
- 任务执行是否按 ruoyi-dev-flow 设计的节点顺序流转
- 每个节点执行后状态是否正确更新
- 循环节点（test→develop, code_review→code_fix）是否正确工作

### 验证点2：真实代码生成
- Agent 是否在正确的 ruoyi 工作目录执行
- 是否生成真实的代码文件（Java、Vue 等）
- 生成的代码是否符合若依框架规范

## 工作目录

测试使用的 RuoYi 工作目录：
```
/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus
```

前端工作目录（如有前端任务）：
```
/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/plus-ui
```

## 测试环境

| 服务 | 端口 | 状态检查命令 |
|------|------|-------------|
| PostgreSQL | 5433 | `docker ps \| grep postgres` |
| Core API | 3000 | `curl http://localhost:3000/api/health` |
| Dashboard | 5173 | `curl http://localhost:5173` |
| MCP Bridge | 动态 | `pnpm --filter @xuanji/runner mcp-bridge` |
| Chrome DevTools MCP | - | 已连接 |

### 环境准备

```bash
# 1. 确保 PostgreSQL 运行
docker start xuanji-postgres || docker run -d --name xuanji-postgres \
  -e POSTGRES_USER=v2 -e POSTGRES_PASSWORD=v2 -e POSTGRES_DB=xuanji \
  -p 5433:5432 postgres:15

# 2. 启动 Core API
pnpm --filter @xuanji/core dev

# 3. 启动 Dashboard
pnpm --filter @xuanji/dashboard dev

# 4. 启动 MCP Bridge（Agent 执行时需要）
pnpm --filter @xuanji/runner mcp-bridge
```

---

## 测试用例

### TC-001: 创建需求

**目的**: 验证通过 Dashboard 创建需求的功能

**前置条件**:
- Dashboard 服务正常运行（http://localhost:5173）
- Core API 服务正常运行
- Chrome DevTools MCP 已连接
- 已配置 ruoyi 项目（路径: /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus）

**重要说明**:
1. **工作目录选择**: 创建需求时必须选择工作目录，否则 Agent 无法正确执行。页面提供项目选择下拉框，需选择已配置的项目（如 "ruoyi"）。
2. **人机交互**: requirement-analyst 执行时可能通过 `inbox_ask` 工具向人类提问。如果任务状态变为 `waiting`，需进入 Inbox 页面回答问题后继续执行。

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 打开需求管理页面
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/requirements"
)
# 等待页面加载完成

# 步骤 2: 获取页面快照，识别元素
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - textarea.create-input: 需求输入框
# - select.workflow-select: 工作流选择下拉框
# - select.project-select: 项目选择下拉框（重要！）
# - input.workdir-input: 自定义路径输入框
# - button.create-btn: 创建并执行按钮

# 步骤 3: 填写需求信息
mcp__chrome-devtools__fill_form(
  pageId=<当前页面ID>,
  elements=[
    { uid: "<textarea.create-input的uid>", value: "实现图书管理功能，包括图书的增删改查" }
  ]
)
# 注意: 工作流默认已选中 "requirement-decomposition"

# 步骤 4: 选择工作目录（重要！）
# 方式一: 点击项目选择下拉框
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<select.project-select的uid>"
)

# 等待下拉列表展开
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - option.project-ruoyi: ruoyi 项目选项

# 选择 ruoyi 项目
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<option.project-ruoyi的uid>"
)
# 对应路径: /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus

# 步骤 5: 点击创建按钮
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.create-btn的uid>"
)

# 步骤 6: 等待创建完成，验证结果
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["图书管理功能"],
  timeout=5000
)

# 步骤 7: 获取快照验证需求创建成功
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期: 需求卡片出现在列表中，状态显示为"执行中"或"waiting"

# 步骤 8: 检查是否有人机交互（重要！）
# 检查需求状态是否变为 "waiting"
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 如果状态显示 "waiting"，说明 Agent 在等待人类回答

# 步骤 9: 如果有 waiting 状态，进入 Inbox 页面处理人机交互
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/inbox"
)

mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - section.inbox-list: 问题列表
# - article.question-card: 待回答的问题卡片
# - div.question-body: 问题内容
# - button.answer-option: 答案选项按钮
# - button.submit-btn: 提交按钮

# 步骤 10: 如果有问题，选择答案并提交
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.answer-option的uid>"
)

mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.submit-btn的uid>"
)

# 步骤 11: 返回需求页面验证状态恢复
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/requirements"
)

mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["执行中"],
  timeout=10000
)

mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期: 状态恢复为"执行中"
```

**API 验证：**
```bash
# 创建需求（包含工作目录）
curl -X POST http://localhost:3000/api/requirements \
  -H "Content-Type: application/json" \
  -d '{
    "id": "req-test-001",
    "input_text": "实现图书管理功能，包括图书的增删改查",
    "workflow_id": "requirement-decomposition",
    "project_path": "/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus"
  }'

# 预期返回:
# {"id":"req-test-001","input_text":"实现图书管理功能","status":"pending","project_path":"...","...}

# 检查是否有 waiting 状态的执行
curl http://localhost:3000/api/executions | jq '.[] | select(.subject_id == "req-test-001") | {id, status}'

# 如果有 waiting 状态，查询待回答问题
EXEC_ID=$(curl -s http://localhost:3000/api/executions | jq -r '.[] | select(.subject_id == "req-test-001") | .id')
curl "http://localhost:3000/api/executions/$EXEC_ID/questions" | jq

# 回答问题（如有）
QUESTION_ID=$(curl -s "http://localhost:3000/api/executions/$EXEC_ID/questions" | jq -r '.[0].id')
curl -X POST "http://localhost:3000/api/executions/$EXEC_ID/questions/$QUESTION_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"answer": "选项A"}'
```

**数据库验证：**
```bash
# 验证需求已创建（包含项目路径）
psql -h localhost -p 5433 -U v2 -d xuanji -c "SELECT id, title, status, project_path FROM requirements WHERE id = 'req-test-001';"

# 预期: project_path 字段有值

# 验证人机交互问题（如有）
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT q.id, q.body, q.status, e.status as exec_status
FROM inbox_questions q
JOIN task_executions e ON q.execution_id = e.execution_id
WHERE e.subject_id = 'req-test-001';
"

# 如果有问题记录，验证回答后状态更新
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT id, body, answer, status, answered_at
FROM inbox_questions
WHERE execution_id IN (
  SELECT execution_id FROM task_executions WHERE subject_id = 'req-test-001'
);
"
```

**验证方法：**
1. 页面验证：`take_snapshot()` 检查需求卡片是否显示
2. API 验证：GET /api/requirements 返回包含新创建的需求，且包含 project_path
3. 数据库验证：requirements 表有新记录，project_path 字段有值
4. 人机交互验证：如果状态为 waiting，Inbox 页面有待回答问题，回答后状态恢复

---

### TC-002: 触发需求执行

**目的**: 验证触发需求执行后，graphRunner 正确启动流程

**前置条件**:
- TC-001 已完成，需求已创建
- MCP Bridge 服务已启动

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 确保在需求列表页
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 2: 点击刚创建的需求卡片
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<需求卡片的uid>"  # article.requirement-card 元素
)

# 步骤 3: 等待详情抽屉打开
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["需求详情", "执行状态"],
  timeout=3000
)

# 步骤 4: 获取抽屉快照，验证按钮
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - button.btn-primary: "查看执行画布" 按钮（如果有 execution_id）
# - button.btn-secondary: "日志" 按钮
# - status-badge: 状态徽章显示"执行中"或"待执行"

# 注意: 点击"创建并执行"后，执行已自动触发，无需再点击"执行"按钮
# 如果是手动触发，可点击"执行"按钮（如果存在）
```

**API 验证：**
```bash
# 触发执行（如果需要手动触发）
curl -X POST http://localhost:3000/api/requirements/req-test-001/execute

# 预期返回:
# {"success":true,"executionId":"exec-xxx","message":"执行已启动"}
```

**执行实例验证：**
```bash
# 查询执行实例
curl http://localhost:3000/api/executions | jq '.[] | select(.subject_id == "req-test-001")'

# 预期: status = 'running', graph_definition_id = 'requirement-decomposition'
```

**数据库验证：**
```bash
# 验证执行实例已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT execution_id, status, graph_definition_id, thread_id
FROM task_executions
WHERE subject_type = 'requirement' AND subject_id = 'req-test-001';
"

# 预期: status = 'running', graph_definition_id = 'requirement-decomposition'
```

---

### TC-003: 需求分析阶段执行

**目的**: 验证 `requirement_analysis` 节点正确执行

**前置条件**:
- TC-002 已完成，需求执行已启动

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 在需求详情抽屉中点击"查看执行画布"
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.btn-primary:查看执行画布的uid>"
)

# 步骤 2: 等待跳转到 Canvas 页面
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["运行态", "节点状态"],
  timeout=5000
)

# 步骤 3: 获取画布快照
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.runtime-panel: 右侧运行态面板
# - div.node-list-item: 节点列表项
# - 状态标签显示"运行中"或"已完成"

# 步骤 4: 观察节点状态变化
# 等待 10-30 秒让需求分析节点执行
# 重复获取快照查看状态更新
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
```

**API 验证：**
```bash
# 查询阶段实例
EXECUTION_ID=$(curl -s http://localhost:3000/api/executions | jq -r '.[] | select(.subject_id == "req-test-001") | .id')
curl "http://localhost:3000/api/executions/$EXECUTION_ID" | jq '.phase_nodes'
```

**数据库验证：**
```bash
# 验证 phase_instance 已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT id, phase_id, status, agent_used, session_id
FROM phase_instances
WHERE execution_id = '$EXECUTION_ID' AND phase_id = 'requirement_analysis';
"

# 预期: status = 'completed' 或 'running'
```

**对话事件验证：**
```bash
# 查询对话事件
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT event_type, role, created_at
FROM conversation_events
WHERE execution_id = '$EXECUTION_ID'
ORDER BY created_at ASC
LIMIT 20;
"

# 预期: 包含 model_delta, tool_completed 等事件
```

---

### TC-004: 需求拆解产物验证

**目的**: 验证需求拆解后，Epic/Feature/UserStory/Task 正确创建

**前置条件**:
- TC-003 已完成，需求分析阶段执行完成

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 返回需求列表页
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/requirements"
)

# 步骤 2: 点击需求卡片打开详情
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<需求卡片的uid>"
)

# 步骤 3: 等待详情抽屉打开
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["分解结构"],
  timeout=5000
)

# 步骤 4: 滚动到分解结构区域
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - section.detail-section: 包含"分解结构"标题
# - RequirementTreeView 组件显示 Epic/Feature/UserStory/Task 树

# 步骤 5: 展开 Epic 节点查看子结构
# 如果是折叠状态，点击展开
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<Epic节点的展开按钮uid>"
)
```

**API 验证：**
```bash
# 查询需求树
curl http://localhost:3000/api/requirements/req-test-001/tree | jq
```

**数据库验证：**
```bash
# 验证 Epic 已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT id, title, module, status
FROM epics
WHERE requirement_id = 'req-test-001';
"

# 验证 Feature 已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT f.id, f.title, e.title as epic_title, f.status
FROM features f
JOIN epics e ON f.epic_id = e.id
WHERE e.requirement_id = 'req-test-001';
"

# 验证 UserStory 已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT us.id, us.title, us.as_a, us.i_want, us.so_that, us.status
FROM user_stories us
JOIN epics e ON us.epic_id = e.id
WHERE e.requirement_id = 'req-test-001';
"

# 验证 Task 已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT t.id, t.title, t.description, t.status, t.sequence
FROM tasks t
JOIN user_stories us ON t.user_story_id = us.id
JOIN epics e ON us.epic_id = e.id
WHERE e.requirement_id = 'req-test-001'
ORDER BY t.sequence;
"
```

**验证方法：**
1. API 验证：GET /api/requirements/{id}/tree 返回完整树结构
2. 数据库验证：各表有正确记录
3. 页面验证：RequirementTreeView 正确显示层级关系

---

### TC-005: 任务确认（draft → pending）

**目的**: 验证批量确认任务功能

**前置条件**:
- TC-004 已完成，任务已创建
- 任务初始状态为 `draft`

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 导航到任务列表页
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/tasks"
)

# 步骤 2: 获取页面快照
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.dashboard: 概览统计卡片
# - div.stat-card.draft: 待确认数量
# - section.task-group.draft: 待确认任务组
# - button.action-btn.primary: "确认执行" 按钮

# 步骤 3: 确认任务状态
# 查看 draft 组的任务数量
# 确认 stat-card.draft 显示正确数量

# 步骤 4: 点击单个任务的"确认执行"按钮
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.action-btn.primary:确认执行的uid>"
)

# 步骤 5: 等待状态变化
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["待执行"],
  timeout=3000
)

# 步骤 6: 验证状态已更新
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期: 任务从 draft 组移动到 pending 组
```

**API 验证：**
```bash
# 批量确认任务
curl -X POST http://localhost:3000/api/requirements/req-test-001/confirm-all-tasks

# 预期返回:
# {"ok":true,"confirmed_count":N,"message":"已确认 N 个任务"}
```

**数据库验证：**
```bash
# 验证任务状态已更新
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT te.execution_id, te.status, t.title
FROM task_executions te
JOIN tasks t ON te.task_id = t.id
WHERE te.requirement_id = 'req-test-001' AND te.task_id IS NOT NULL;
"

# 预期: 所有 status = 'pending'
```

**验证方法：**
1. API 验证：POST /api/requirements/{id}/confirm-all-tasks 返回成功
2. 数据库验证：task_executions 状态变为 pending
3. 页面验证：任务卡片从"待确认"组移动到"待执行"组

---

### TC-006: 调度器自动拾取任务

**目的**: 验证调度器自动检测 pending 任务并分发给 worker

**前置条件**:
- TC-005 已完成，任务状态为 pending
- Core API 服务正在运行（调度器在服务启动时自动运行）

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 在任务列表页等待状态变化
# 调度器轮询间隔约 5 秒
# 重复获取快照观察状态变化

mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 等待 5-10 秒
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 2: 验证任务状态变为"执行中"
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["执行中"],
  timeout=15000
)

# 步骤 3: 获取最新状态
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.stat-card.running: 执行中数量 > 0
# - section.task-group.running: 执行中任务组
# - task-card.running: 任务卡片带有 running 状态
```

**API 验证：**
```bash
# 查询任务执行状态
curl http://localhost:3000/api/tasks | jq '.[] | select(.requirement_id == "req-test-001") | {id, status, current_node_id}'
```

**日志验证：**
```bash
# 查看 Core API 日志
tail -f /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/logs/core.log

# 预期日志:
# [scheduler-graph] 开始调度...
# [worker-graph] 开始执行 executionId=xxx taskId=xxx
```

**数据库验证：**
```bash
# 验证任务状态已更新为 running
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT execution_id, status, started_at
FROM task_executions
WHERE requirement_id = 'req-test-001' AND task_id IS NOT NULL
ORDER BY created_at;
"
```

---

### TC-007: 任务执行流程 - 验证执行进度

**目的**: 验证任务执行过程中各阶段正确执行

**前置条件**:
- TC-006 已完成，任务已开始执行
- 任务使用 `ruoyi-dev-flow` 工作流

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 点击正在执行的任务卡片，进入详情页
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<task-card.running的uid>"
)

# 步骤 2: 等待任务详情页加载
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["执行进度", "查看画布"],
  timeout=5000
)

# 步骤 3: 获取详情页快照
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.status-card: 状态概览卡片
# - div.progress-card: 执行进度卡片
# - div.phase-chip: 阶段状态标签（done/running/pending）
# - button.btn-primary: "查看画布" 按钮

# 步骤 4: 观察阶段状态变化
# 重复获取快照查看阶段进度
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 5: 点击"查看画布"按钮
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.btn-primary:查看画布的uid>"
)

# 步骤 6: 等待画布页面加载
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["节点状态", "执行信息"],
  timeout=5000
)

# 步骤 7: 获取画布快照
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.runtime-panel: 运行态面板
# - div.node-list: 节点列表
# - div.node-list-item.running: 当前执行节点
# - div.node-list-item.done: 已完成节点
```

**API 验证：**
```bash
# 查询执行实例的节点状态
EXECUTION_ID="<任务执行ID>"
curl "http://localhost:3000/api/executions/$EXECUTION_ID" | jq '.phase_nodes'
```

**数据库验证：**
```bash
# 验证 phase_instance 已创建
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT id, phase_id, status, agent_used, session_id
FROM phase_instances
WHERE execution_id = '$EXECUTION_ID'
ORDER BY created_at;
"
```

---

### TC-007-A: 工作流流转正确性验证

**目的**: 验证任务按 ruoyi-dev-flow 工作流设计的节点顺序执行

**前置条件**:
- TC-007 已完成，任务正在执行
- 任务使用 `ruoyi-dev-flow` 工作流

**ruoyi-dev-flow 工作流设计**:
```
write_tests → develop → test → code_review ↔ code_fix → final_review
                              ↑__________________|
                                 (循环最多2次)
```

**验证步骤**:

1. **节点顺序验证**（页面操作）：
```
# 进入画布页面观察节点状态
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/canvas?execution_id=<执行ID>"
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 检查节点列表顺序：
# 预期: write_tests → develop → test → code_review → code_fix → final_review
# 当前执行节点应有 "running" 标记
# 已完成节点应有 "done" 标记
```

2. **数据库验证 - 阶段执行顺序**：
```bash
# 查询 phase_instances 表，验证执行顺序
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT phase_id, status, started_at, completed_at
FROM phase_instances
WHERE execution_id = '$EXECUTION_ID'
ORDER BY started_at;
"

# 预期输出顺序：
# 1. write_tests (completed)
# 2. develop (completed)
# 3. test (completed/running)
# 4. code_review (pending/running，视 test 结果)
# 5. code_fix (如果有问题)
# 6. final_review (pending，最后的人审)
```

3. **循环验证**（如果 test 失败）：
```bash
# 查询 loop_counters
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT loop_counters
FROM task_executions
WHERE execution_id = '$EXECUTION_ID';
"

# 如果 test 失败后回到 develop，loop_counters['test'] 应增加
# 最大循环次数为 2
```

---

### TC-007-B: 真实代码生成验证

**目的**: 验证 Agent 在 ruoyi 工作目录中生成了真实的代码文件

**前置条件**:
- TC-007 已完成，develop 节点已执行
- 工作目录: /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus

**验证步骤**:

1. **检查工作目录是否正确使用**：
```bash
# 查询任务执行的 target_repo_path
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT execution_id, task_id, target_repo_path
FROM task_executions
WHERE execution_id = '$EXECUTION_ID';
"

# 预期: target_repo_path = '/Users/admin/.../workspace/RuoYi-Cloud-Plus'
```

2. **检查生成的代码文件**：
```bash
# 进入 RuoYi 工作目录
cd /Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus

# 查看最近的文件变更（develop 节点执行后）
git status

# 预期: 有新文件或修改的文件，如：
# - ruoyi-modules/ruoyi-book/src/main/java/.../domain/Book.java
# - ruoyi-modules/ruoyi-book/src/main/java/.../mapper/BookMapper.java
# - ruoyi-modules/ruoyi-book/src/main/java/.../service/BookService.java
# - ruoyi-modules/ruoyi-book/src/main/java/.../controller/BookController.java
```

3. **验证代码质量（符合若依规范）**：
```bash
# 检查实体类是否使用若依注解
grep -r "@TableName\|@TableId" ruoyi-modules/ruoyi-book/src/main/java/

# 检查 Controller 是否使用若依注解
grep -r "@RequiresPermissions\|@Log" ruoyi-modules/ruoyi-book/src/main/java/

# 检查 Mapper XML 是否存在
ls -la ruoyi-modules/ruoyi-book/src/main/resources/mapper/
```

4. **页面验证 - 查看生成的文件**：
```
# 在任务详情页查看 Phase 产出物
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 展开 "产出物" 区域
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<产出物折叠区域的uid>"
)

# 预期显示：
# - 文件列表（Java/Vue 文件）
# - 文件变更统计（新增/修改行数）
# - Diff 预览
```

**完成标准**:
- [ ] target_repo_path 指向正确的 ruoyi 目录
- [ ] 生成了真实的代码文件（非空）
- [ ] 代码符合若依框架规范（注解、命名等）
- [ ] 前端可查看产出物详情

---

### TC-008: 人机交互验证（如有）

**目的**: 验证 Agent 通过 inbox_ask 向人类提问的功能

**前置条件**:
- 有正在执行的任务
- Agent 配置了 inbox_ask 工具
- 执行遇到需要人机交互的情况

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 检查任务状态是否变为"waiting"
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/tasks"
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 查找状态为"waiting"的任务

# 步骤 2: 如果有 waiting 任务，进入详情页
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<waiting任务的uid>"
)

# 步骤 3: 查看待回答问题
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["问题"],
  timeout=5000
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 4: 回答问题（如有）
# 如果有选择项，点击选择
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<问题选项的uid>"
)

# 步骤 5: 提交回答
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<提交按钮的uid>"
)
```

**API 验证：**
```bash
# 查询待回答问题
curl "http://localhost:3000/api/executions/$EXECUTION_ID/elicitations"

# 提交回答
curl -X POST "http://localhost:3000/api/executions/$EXECUTION_ID/elicitations/$QUESTION_ID/reply" \
  -H "Content-Type: application/json" \
  -d '{"answer": "选项A"}'
```

**数据库验证：**
```bash
# 验证问题状态已更新
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT id, body, answer, status, answered_at
FROM inbox_questions
WHERE execution_id = '$EXECUTION_ID';
"
```

---

### TC-009: Gate 审核决策

**目的**: 验证 `final_review` gate 节点的暂停/恢复机制

**前置条件**:
- 任务执行到 final_review 阶段
- 执行状态变为 `paused`

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 在任务列表页查找"暂停"状态的任务
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/tasks"
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 查找 div.stat-card.paused 或 section.task-group.paused

# 步骤 2: 进入暂停任务的详情页
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<paused任务卡片的uid>"
)

# 步骤 3: 等待详情页加载
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["已暂停", "继续"],
  timeout=5000
)

# 步骤 4: 获取详情页快照，查找审核操作
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.status-badge.paused: 状态徽章
# - button.btn-primary: "继续" 按钮
# - (如果显示审核区) div.review-gate-section: 审核决策区

# 方式一：在任务详情页点击"继续"
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.btn-primary:继续的uid>"
)

# 方式二：在画布页面审核
# 步骤 5: 点击"查看画布"进入运行态
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.btn-primary:查看画布的uid>"
)

# 步骤 6: 等待画布加载
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["执行信息", "节点状态"],
  timeout=5000
)

# 步骤 7: 点击暂停的 gate 节点
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<gate节点的uid>"
)

# 步骤 8: 查看审核操作区域
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.gate-review: 审核区域
# - textarea.gate-comment: 审核意见输入框
# - button: "通过" 按钮
# - button: "驳回" 按钮

# 步骤 9: 输入审核意见（可选）
mcp__chrome-devtools__fill(
  pageId=<当前页面ID>,
  uid="<textarea.gate-comment的uid>",
  value="代码质量良好，审核通过"
)

# 步骤 10: 点击"通过"按钮
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button:通过的uid>"
)

# 步骤 11: 验证状态恢复为"运行中"
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["运行中"],
  timeout=5000
)
```

**API 验证：**
```bash
# 查询执行状态
curl "http://localhost:3000/api/executions/$EXECUTION_ID" | jq '.status'

# 预期: status = 'paused'

# 提交审核决策
curl -X POST "http://localhost:3000/api/executions/$EXECUTION_ID/gate" \
  -H "Content-Type: application/json" \
  -d '{"decision": "approve", "comments": "审核通过"}'

# 预期: 流程继续，状态恢复为 running 并最终变为 completed
```

**数据库验证：**
```bash
# 验证决策记录
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT phase, decision, severity, raw
FROM decisions
WHERE execution_id = '$EXECUTION_ID';
"
```

---

### TC-010: 任务执行完成验证

**目的**: 验证任务执行完成后状态正确更新

**前置条件**:
- TC-009 已完成，Gate 通过

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 在任务详情页等待状态变化
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 等待执行完成（可能需要几分钟）

# 步骤 2: 验证状态变为"已完成"
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["已完成"],
  timeout=120000
)

# 步骤 3: 获取最终状态快照
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.status-badge.completed: 状态徽章显示"已完成"
# - div.phase-chip.done: 所有阶段显示为完成

# 步骤 4: 展开"Phase 产出物"查看执行结果
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<Phase产出物折叠区域的uid>"
)

# 步骤 5: 查看产出物详情
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - article.phase-output-item: 产出物记录
# - div.po-section: 文件变更、Diff、测试结果等
```

**API 验证：**
```bash
# 查询任务执行状态
curl "http://localhost:3000/api/tasks/$EXECUTION_ID" | jq '{id, status, finished_at}'
```

**数据库验证：**
```bash
# 验证最终状态
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT execution_id, status, completed_at, stage
FROM task_executions
WHERE execution_id = '$EXECUTION_ID';
"

# 预期: status = 'completed', completed_at 有值
```

---

### TC-011: 连续任务执行验证

**目的**: 验证第一个任务完成后，调度器自动拾取下一个任务

**前置条件**:
- TC-004 已完成，多个任务已创建并确认
- TC-010 已完成，第一个任务执行完成

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 导航到任务列表页
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/tasks"
)

# 步骤 2: 获取概览统计
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.stat-card.completed: 已完成数量
# - div.stat-card.running: 执行中数量（如果有）
# - div.stat-card.pending: 待执行数量

# 步骤 3: 等待下一个任务被拾取
# 重复获取快照观察状态变化
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 4: 验证调度器持续执行
# 观察执行中任务数量变化
```

**API 验证：**
```bash
# 查询所有任务状态
curl "http://localhost:3000/api/tasks?requirementId=req-test-001" | jq '.[] | {id, status}'
```

**数据库验证：**
```bash
# 统计各状态任务数量
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT status, COUNT(*)
FROM task_executions
WHERE requirement_id = 'req-test-001' AND task_id IS NOT NULL
GROUP BY status;
"
```

**预期结果：**
- 完成的任务状态为 `completed`
- 进行中的任务状态为 `running`
- 待执行的任务状态为 `pending`

---

### TC-012: 所有任务完成验证

**目的**: 验证所有任务完成后，需求状态正确更新

**前置条件**:
- 所有任务已执行完成

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 导航到需求列表页
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/requirements"
)

# 步骤 2: 获取页面快照
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.stat-card.completed: 已完成需求数量
# - article.requirement-card.completed: 已完成的需求卡片

# 步骤 3: 点击需求卡片查看详情
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<已完成需求卡片的uid>"
)

# 步骤 4: 验证分解结构全部完成
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["已完成"],
  timeout=3000
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期: 所有任务状态显示为"已完成"
```

**API 验证：**
```bash
# 查询需求状态
curl "http://localhost:3000/api/requirements/req-test-001" | jq '{id, status}'
```

**数据库验证：**
```bash
# 验证需求状态
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT id, status, updated_at
FROM requirements
WHERE id = 'req-test-001';
"

# 验证所有任务状态
psql -h localhost -p 5433 -U v2 -d xuanji -c "
SELECT COUNT(*) as total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM task_executions
WHERE requirement_id = 'req-test-001' AND task_id IS NOT NULL;
"
```

---

### TC-013: SSE 实时事件流

**目的**: 验证执行过程中的实时事件推送

**前置条件**:
- 有正在执行的任务

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 进入任务详情页或画布页
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/tasks"
)
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<running任务卡片的uid>"
)

# 步骤 2: 查看实时事件流组件
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["查看画布"],
  timeout=5000
)
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.btn-primary:查看画布的uid>"
)

# 步骤 3: 观察右侧 LiveEventStream 组件
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
# 预期返回:
# - div.rt-stream: 实时事件流面板
# - 实时显示 token 输出和工具调用事件
```

**API 验证：**
```bash
# 终端 1: 打开 SSE 连接
curl -N "http://localhost:3000/api/executions/$EXECUTION_ID/stream"

# 终端 2: 观察事件流
# 预期: 收到 {"type":"connected"} 初始消息
#       收到 {"type":"token","node_id":"agent","text":"..."} 消息
#       收到 {"type":"done","node_id":"..."} 消息
```

---

### TC-014: 任务暂停与恢复

**目的**: 验证任务暂停和恢复功能

**前置条件**:
- 有正在执行的任务

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 在任务列表页找到 running 状态的任务
mcp__chrome-devtools__navigate_page(
  pageId=<当前页面ID>,
  type="url",
  url="http://localhost:5173/tasks"
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 2: 点击"暂停"按钮
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.action-btn.warn:暂停的uid>"
)

# 步骤 3: 确认暂停操作（如有确认对话框）
# 等待对话框出现
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["确定"],
  timeout=3000
)
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<确认按钮的uid>"
)

# 步骤 4: 验证状态变为"已暂停"
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["已暂停"],
  timeout=5000
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 5: 点击"继续"按钮恢复执行
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.action-btn.primary:继续的uid>"
)

# 步骤 6: 验证状态恢复为"执行中"
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["执行中"],
  timeout=5000
)
```

**API 验证：**
```bash
# 请求暂停
curl -X POST "http://localhost:3000/api/executions/$EXECUTION_ID/pause"

# 查询状态
curl "http://localhost:3000/api/executions/$EXECUTION_ID" | jq '.status'
# 预期: status = 'paused'

# 请求恢复
curl -X POST "http://localhost:3000/api/executions/$EXECUTION_ID/resume"
```

---

### TC-015: 任务取消

**目的**: 验证任务取消功能

**前置条件**:
- 有正在执行或暂停的任务

**页面操作（Chrome DevTools MCP）：**

```
# 步骤 1: 在任务列表页找到可取消的任务
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)

# 步骤 2: 点击"取消"按钮
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<button.action-btn.danger:取消的uid>"
)

# 步骤 3: 确认取消操作
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["确定要取消"],
  timeout=3000
)
mcp__chrome-devtools__click(
  pageId=<当前页面ID>,
  uid="<确认按钮的uid>"
)

# 步骤 4: 验证状态变为"已取消"
mcp__chrome-devtools__wait_for(
  pageId=<当前页面ID>,
  text=["已取消"],
  timeout=5000
)
mcp__chrome-devtools__take_snapshot(pageId=<当前页面ID>)
```

**API 验证：**
```bash
# 请求取消
curl -X POST "http://localhost:3000/api/executions/$EXECUTION_ID/cancel"

# 查询状态
curl "http://localhost:3000/api/executions/$EXECUTION_ID" | jq '.status'
# 预期: status = 'cancelled'
```

---

## 完整 E2E 测试脚本

```bash
#!/bin/bash
# scripts/e2e-test.sh —— 璇玑 V4 E2E 测试自动化脚本

set -e

API_URL="http://localhost:3000"
REQ_ID="e2e-req-$(date +%s)"

echo "=== 璇玑 V4 E2E 测试开始 ==="
echo "测试需求 ID: $REQ_ID"

# ─── TC-001: 创建需求 ───────────────────────────────────────────────────────────
echo -e "\n[TC-001] 创建需求..."

# 重要: 必须指定项目路径，否则 Agent 无法正确执行
PROJECT_PATH="/Users/admin/code/01-tula-explore/02-AI-Research/long-running-agent-v4/workspace/RuoYi-Cloud-Plus"

RESP=$(curl -s -X POST "$API_URL/api/requirements" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$REQ_ID\", \"input_text\": \"实现图书管理功能\", \"workflow_id\": \"requirement-decomposition\", \"project_path\": \"$PROJECT_PATH\"}")

echo "创建响应: $RESP"
REQ_STATUS=$(echo $RESP | jq -r '.status')
if [ "$REQ_STATUS" != "pending" ]; then
  echo "❌ 需求创建失败"
  exit 1
fi

# 验证项目路径
REQ_PROJECT_PATH=$(echo $RESP | jq -r '.project_path')
if [ -z "$REQ_PROJECT_PATH" ] || [ "$REQ_PROJECT_PATH" == "null" ]; then
  echo "⚠️ 警告: 项目路径未设置"
fi
echo "✅ 需求创建成功，项目路径: $REQ_PROJECT_PATH"

# 检查是否有人机交互（waiting 状态）
sleep 3
EXEC_STATUS=$(curl -s "$API_URL/api/executions/$EXEC_ID" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "null")
if [ "$EXEC_STATUS" == "waiting" ]; then
  echo "⚠️ 检测到 waiting 状态，处理人机交互..."
  # 获取待回答问题
  QUESTIONS=$(curl -s "$API_URL/api/executions/$EXEC_ID/questions" 2>/dev/null || echo "[]")
  QUESTION_ID=$(echo $QUESTIONS | jq -r '.[0].id' 2>/dev/null || echo "null")
  if [ "$QUESTION_ID" != "null" ] && [ -n "$QUESTION_ID" ]; then
    curl -s -X POST "$API_URL/api/executions/$EXEC_ID/questions/$QUESTION_ID/answer" \
      -H "Content-Type: application/json" \
      -d '{"answer": "继续"}'
    echo "✅ 已自动回答问题"
    sleep 3
  fi
fi

# ─── TC-002: 触发执行 ───────────────────────────────────────────────────────────
echo -e "\n[TC-002] 触发需求执行..."
EXEC_RESP=$(curl -s -X POST "$API_URL/api/requirements/$REQ_ID/execute")
EXEC_ID=$(echo $EXEC_RESP | jq -r '.executionId')
echo "执行 ID: $EXEC_ID"

if [ "$EXEC_ID" == "null" ] || [ -z "$EXEC_ID" ]; then
  echo "❌ 执行触发失败"
  exit 1
fi
echo "✅ 执行触发成功"

# 等待执行启动
sleep 3

# ─── TC-003/004: 等待需求拆解完成 ──────────────────────────────────────────────
echo -e "\n[TC-003/004] 等待需求拆解..."
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS=$(curl -s "$API_URL/api/executions/$EXEC_ID" | jq -r '.status')
  echo "当前状态: $STATUS"

  if [ "$STATUS" == "completed" ]; then
    echo "✅ 需求拆解完成"
    break
  elif [ "$STATUS" == "failed" ]; then
    echo "❌ 需求拆解失败"
    exit 1
  elif [ "$STATUS" == "paused" ]; then
    echo "⚠️ 需求拆解暂停（等待人工审核）"
    # 自动通过 Gate
    curl -s -X POST "$API_URL/api/executions/$EXEC_ID/gate" \
      -H "Content-Type: application/json" \
      -d '{"decision": "approve", "comments": "自动通过"}'
    echo "已自动通过 Gate"
  fi

  sleep 5
  WAITED=$((WAITED + 5))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "❌ 需求拆解超时"
  exit 1
fi

# ─── TC-004: 验证任务树 ─────────────────────────────────────────────────────────
echo -e "\n[TC-004] 验证任务树..."
TREE=$(curl -s "$API_URL/api/requirements/$REQ_ID/tree")
EPIC_COUNT=$(echo $TREE | jq '.epics | length')
TASK_COUNT=$(echo $TREE | jq '[.epics[].features[].user_stories[].tasks | length] | add')

echo "Epic 数量: $EPIC_COUNT"
echo "Task 数量: $TASK_COUNT"

if [ "$EPIC_COUNT" -lt 1 ] || [ "$TASK_COUNT" -lt 1 ]; then
  echo "❌ 任务树验证失败"
  exit 1
fi
echo "✅ 任务树验证成功"

# ─── TC-005: 批量确认任务 ──────────────────────────────────────────────────────
echo -e "\n[TC-005] 批量确认任务..."
CONFIRM_RESP=$(curl -s -X POST "$API_URL/api/requirements/$REQ_ID/confirm-all-tasks")
CONFIRMED=$(echo $CONFIRM_RESP | jq '.confirmed_count')
echo "已确认任务数: $CONFIRMED"

if [ "$CONFIRMED" -lt 1 ]; then
  echo "❌ 批量确认失败"
  exit 1
fi
echo "✅ 批量确认成功"

# ─── TC-006: 等待调度器拾取 ────────────────────────────────────────────────────
echo -e "\n[TC-006] 等待调度器拾取任务..."
sleep 10

# 查询第一个任务执行
FIRST_TASK_EXEC=$(curl -s "$API_URL/api/tasks?requirementId=$REQ_ID" | jq -r '.[0].id')
if [ "$FIRST_TASK_EXEC" == "null" ] || [ -z "$FIRST_TASK_EXEC" ]; then
  echo "❌ 未找到任务执行"
  exit 1
fi
echo "第一个任务执行 ID: $FIRST_TASK_EXEC"

# ─── TC-007-012: 等待任务执行完成 ──────────────────────────────────────────────
echo -e "\n[TC-007-012] 等待任务执行..."
MAX_WAIT=300
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS=$(curl -s "$API_URL/api/executions/$FIRST_TASK_EXEC" | jq -r '.status')
  echo "任务状态: $STATUS"

  if [ "$STATUS" == "completed" ]; then
    echo "✅ 任务执行完成"
    break
  elif [ "$STATUS" == "failed" ]; then
    echo "❌ 任务执行失败"
    exit 1
  elif [ "$STATUS" == "paused" ]; then
    echo "⚠️ 任务暂停（等待人工审核）"
    # 自动通过 Gate
    curl -s -X POST "$API_URL/api/executions/$FIRST_TASK_EXEC/gate" \
      -H "Content-Type: application/json" \
      -d '{"decision": "approve", "comments": "自动通过"}'
    echo "已自动通过 Gate"
  elif [ "$STATUS" == "waiting" ]; then
    echo "⚠️ 任务等待人机交互"
    # 自动回答问题
    QUESTIONS=$(curl -s "$API_URL/api/executions/$FIRST_TASK_EXEC/elicitations")
    QUESTION_ID=$(echo $QUESTIONS | jq -r '.[0].id')
    if [ "$QUESTION_ID" != "null" ]; then
      curl -s -X POST "$API_URL/api/executions/$FIRST_TASK_EXEC/elicitations/$QUESTION_ID/reply" \
        -H "Content-Type: application/json" \
        -d '{"answer": "继续"}'
      echo "已自动回答问题"
    fi
  fi

  sleep 10
  WAITED=$((WAITED + 10))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "❌ 任务执行超时"
  exit 1
fi

# ─── TC-013-014: 验证连续执行 ──────────────────────────────────────────────────
echo -e "\n[TC-013-014] 验证任务执行统计..."
STATS=$(curl -s "$API_URL/api/tasks?requirementId=$REQ_ID" | jq 'group_by(.status) | map({status: .[0].status, count: length})')
echo "任务状态统计: $STATS"

echo -e "\n=== E2E 测试全部通过 ==="
```

---

## 测试检查清单

### 环境准备
- [ ] PostgreSQL 运行中
- [ ] Core API 服务运行中
- [ ] Dashboard 服务运行中
- [ ] MCP Bridge 服务运行中
- [ ] Chrome DevTools MCP 已连接

### 场景1：需求创建与拆解
- [ ] TC-001: 需求创建成功（含工作目录选择）
- [ ] TC-001: 人机交互处理（如有 waiting 状态）
- [ ] TC-002: 执行触发成功
- [ ] TC-003: 需求分析阶段执行
- [ ] TC-004: Epic/Feature/UserStory/Task 正确创建

### 场景2：任务确认与自动调度
- [ ] TC-005: 批量确认任务成功
- [ ] TC-006: 调度器自动拾取任务

### 场景3：任务执行流程
- [ ] TC-007: 执行进度验证
- [ ] TC-008: 人机交互验证（如有）
- [ ] TC-009: Gate 审核决策
- [ ] TC-010: 任务执行完成

### 场景4：连续任务执行
- [ ] TC-011: 连续任务执行验证
- [ ] TC-012: 所有任务完成验证

### 辅助功能
- [ ] TC-013: SSE 实时事件流
- [ ] TC-014: 任务暂停与恢复
- [ ] TC-015: 任务取消

---

## 测试数据清理

```bash
# 清理测试数据
psql -h localhost -p 5433 -U v2 -d xuanji -c "
DELETE FROM tasks WHERE user_story_id IN (
  SELECT us.id FROM user_stories us
  JOIN epics e ON us.epic_id = e.id
  WHERE e.requirement_id LIKE 'e2e-%' OR e.requirement_id LIKE 'req-test-%'
);

DELETE FROM user_stories WHERE epic_id IN (
  SELECT id FROM epics WHERE requirement_id LIKE 'e2e-%' OR requirement_id LIKE 'req-test-%'
);

DELETE FROM features WHERE epic_id IN (
  SELECT id FROM epics WHERE requirement_id LIKE 'e2e-%' OR requirement_id LIKE 'req-test-%'
);

DELETE FROM epics WHERE requirement_id LIKE 'e2e-%' OR requirement_id LIKE 'req-test-%';

DELETE FROM task_executions WHERE requirement_id LIKE 'e2e-%' OR requirement_id LIKE 'req-test-%';

DELETE FROM requirements WHERE id LIKE 'e2e-%' OR id LIKE 'req-test-%';

DELETE FROM inbox_questions WHERE execution_id LIKE 'e2e-%' OR execution_id LIKE 'req-test-%';

DELETE FROM conversation_events WHERE execution_id LIKE 'e2e-%' OR execution_id LIKE 'req-test-%';
"
```

---

## 预期结果汇总

| 测试项 | 预期结果 | 通过标准 |
|--------|----------|----------|
| 需求创建 | 返回需求记录，status=pending，project_path 有值 | HTTP 200 |
| 工作目录选择 | 下拉选择 ruoyi 项目，路径正确关联 | 数据库有 project_path |
| 人机交互检测 | waiting 状态正确检测 | 状态变化 |
| 人机交互回答 | 回答后状态恢复为 running | 流程继续 |
| 执行触发 | 返回 executionId，流程启动 | HTTP 200 |
| 需求拆解 | 创建 Epic/Feature/UserStory/Task | 数据库记录存在 |
| 任务确认 | 状态从 draft→pending | HTTP 200 |
| 调度拾取 | pending→running | 状态变化 |
| 任务执行 | 按 ruoyi-dev-flow 流程执行 | 阶段记录存在 |
| Gate 决策 | 暂停→恢复→完成 | 状态正确流转 |
| SSE 推送 | 实时收到事件 | 事件流正常 |
| 人机交互 | 问题创建→回答→继续 | 流程继续 |
| 暂停/恢复 | 状态正确变化 | HTTP 200 |
| 取消 | 状态变为 cancelled | HTTP 200 |
| 服务重启 | 状态恢复，孤儿检测运行 | 数据不丢失 |

---

## 页面元素参考（基于代码分析）

### 需求页面 (Requirements.vue)

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 工作流选择 | `select.workflow-select` | 下拉选择工作流 |
| 需求输入框 | `textarea.create-input` | 输入需求文本 |
| 项目选择 | `select.project-select` | 下拉选择项目 |
| 自定义路径 | `input.workdir-input` | 手动输入路径 |
| 创建按钮 | `button.create-btn` | 创建并执行 |
| 需求卡片 | `article.requirement-card` | 需求列表项 |
| 状态徽章 | `div.status-badge` | 状态显示 |
| 概览统计 | `div.stat-card` | 统计卡片 |

### 任务页面 (Tasks.vue)

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 搜索框 | `input.search-input` | 搜索任务 |
| 需求筛选 | `select.req-filter` | 按需求筛选 |
| 状态筛选 | `button.filter-chip` | 状态过滤标签 |
| 任务卡片 | `article.task-card` | 任务列表项 |
| 确认按钮 | `button.action-btn.primary` | 确认执行 |
| 暂停按钮 | `button.action-btn.warn` | 暂停任务 |
| 取消按钮 | `button.action-btn.danger` | 取消任务 |
| 统计卡片 | `div.stat-card` | 概览统计 |

### 任务详情页 (TaskDetail.vue)

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 状态徽章 | `div.status-badge` | 任务状态 |
| 阶段标签 | `div.phase-chip` | 执行阶段状态 |
| 查看画布 | `button.btn-primary` | 跳转到画布 |
| 对话按钮 | `button.btn-secondary` | 查看对话 |
| 日志按钮 | `button.btn-secondary` | 查看日志 |
| 继续按钮 | `button.btn-primary` | 继续执行 |
| 审核区域 | `div.review-gate-section` | Gate 审核区 |

### 画布页面 (Canvas.vue)

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 模式切换 | `el-radio-group` | 编辑/运行态 |
| 执行ID输入 | `input.rt-id` | 输入执行ID |
| 连接按钮 | `button` | 连接执行 |
| 运行态面板 | `div.runtime-panel` | 右侧信息面板 |
| 节点列表 | `div.node-list` | 节点状态列表 |
| 审核区域 | `div.gate-review` | Gate 审核操作 |
| 通过按钮 | `button[type=success]` | 审核通过 |
| 驳回按钮 | `button[type=danger]` | 审核驳回 |