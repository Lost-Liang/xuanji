# 需求管理页交互改造

> 设计日期：2026-09-09
> 状态：Draft
> 作者：Claude

## 概述

### 问题背景

当前 V4 需求管理页 (`/requirements`) 交互存在以下问题：

1. **分解结构展示空间不足**：任务树塞在 600px 的 `el-drawer` 里，和状态卡、actions、spec、sessions 挤在一起
2. **查看任务需要多层点击**：先点需求卡 → 打开抽屉 → 滚动到"分解结构" → 再点任务跳转
3. **没有行级操作**：卡片列表只有点击打开抽屉一个入口，没有参考 V2 的 row-level action 模式

### 目标

- **去掉抽屉**：所有信息在同一页展示
- **树状展示**：参考 V2 的 TreeView，全量加载 5 级层级（需求 → 史诗 → 特性 → 用户故事 → 任务）
- **行级操作按钮**：每行右侧有对应 actions（参考 V2 交互，使用 V4 实际 API）
- **保留"查看画布"**按钮

### 不做的事

- ❌ 不做编辑功能（V4 后端无 PUT/PATCH）
- ❌ 不在行按钮提供"暂停/重试/继续/对话"（V4 这些挂在 execution 层且接口是 stub）
- ❌ 不引入新详情页路由（`/requirements/:id`）— 所有内容在列表页一棵树里
- ❌ 不改后端 API

## 参考：V2 的交互模式

V2 的 `Requirements.vue` + `TreeView.vue` 关键设计：

**全量加载树**：通过嵌套 `Promise.all` 一次加载所有需求 → epics → features → stories → tasks，渲染成统一树结构。

**每行布局**：
```
[ ± 展开/折叠 ] [ 层级 badge ] [ 标题 (flex:1, 截断) ] [ 状态 chip ] [ 工时 chip ] [ action 按钮 ]
```

**层级视觉线索**：
- 每级不同颜色左竖条（需求蓝 / 史诗绿 / 特性橙 / 故事紫 / 任务灰）
- 缩进 `12 + depth * 20` px
- running 行浅背景 + 呼吸动画
- 自动展开有 running 子节点的分支；全完成 / 全 pending 的子树默认折叠

**行点击路由**：
- 需求 / 任务行 → `window.open` 跳转到对应详情页
- 史诗 / 特性 / 故事行 → 打开右侧 500px 抽屉展示详情

## V4 实际可用的 Row Actions

基于 V4 后端 routes（`packages/core/src/routes/`），每行实际能提供的按钮：

### 需求行（Requirement）

| 按钮 | 接口 | 显示条件 |
|---|---|---|
| 执行 | `POST /api/requirements/:id/execute` | `status` 为 `draft` / `pending` / `failed` |
| 停止 | `POST /api/requirements/:id/stop` | `execution_status` 为 `running` / `pending` |
| 确认所有任务 | `POST /api/requirements/:id/confirm-all-tasks` | 有 `draft` 任务（分解完成后） |
| 日志 | `RequirementLogDrawer` | 始终 |
| 画布 | 跳转 `/canvas` | `execution_id` 存在 |
| 删除 | `DELETE /api/requirements/:id` | 始终（二次确认） |

### 任务行（Task）

| 按钮 | 接口 | 显示条件 |
|---|---|---|
| 确认 | `POST /api/tasks/:id/confirm` | `status === 'draft'` |
| 执行 | `POST /api/tasks/:id/execute` | `status === 'pending'` |
| 日志 | `LogDrawer` | 始终 |
| 删除 | `DELETE /api/tasks/:id` | `status !== 'running'` |

> 注：点击任务行整行（含标题）即跳转 `/tasks/:execution_id`，无需单独"详情"按钮。

### 中间层级（Epic / Feature / UserStory）

V4 后端没有对应 row-level actions（无独立 API），所以这些层级**只展示信息**，不提供操作按钮。点击行时仅展开/折叠。

## 改造方案

### 页面结构

**单页树形布局**（替换现有卡片列表 + 抽屉）：

```
┌──────────────────────────────────────────────────────────────────┐
│ [创建工作流选择] [textarea]  [创建并执行]                          │
├──────────────────────────────────────────────────────────────────┤
│ [状态 dashboard: 总数 / 执行中 / 已暂停 / 已完成 / 失败]          │
├──────────────────────────────────────────────────────────────────┤
│ [搜索框] [刷新]                                                  │
├──────────────────────────────────────────────────────────────────┤
│ ▼ [需求] 实现用户登录功能          [执行中]  2h  [停止][日志][画布] │
│   │ ▼ [史诗] 认证模块               [执行中]                     │
│   │   │ ▼ [特性] 邮箱注册           [执行中]                     │
│   │   │   │ ▼ [故事] 作为新用户...  [P1]                         │
│   │   │   │   │ [任务] 实现注册接口 [draft]  4h [确认][日志][删除]│
│   │   │   │   │ [任务] 写注册测试   [pending] 2h [执行][日志][删除]│
│   │   │   │   └─ [故事] 作为新用户... [P2]                       │
│   │   │   │      └─ [任务] 实现邮箱验证 [completed] 1h  [日志]    │
│   │   └─ [特性] 第三方登录          [pending]                    │
│   │      └─ ...                                                │
│   └─ [史诗] 会话管理                [pending]                    │
│      └─ ...                                                    │
│ ▶ [需求] 重构支付系统               [completed]   [日志][画布][删除]│
│ ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

### 核心组件

| 组件 | 说明 |
|---|---|
| `views/Requirements.vue` | 主页面：顶部创建框 + dashboard + 工具栏 + 树形列表 |
| `components/RequirementTreeView.vue` | **重写**：从 drawer 内嵌组件 → 主页面核心树组件 |
| `components/drawers/RequirementLogDrawer.vue` | 复用，从需求行"日志"按钮触发 |
| `components/drawers/LogDrawer.vue` | 复用，从任务行"日志"按钮触发 |

### RequirementTreeView 重写要点

**数据加载**：
直接调用 V4 已有的 `/api/requirements/:id/tree`，它返回完整 5 级嵌套结构。
```ts
const trees = await Promise.all(requirements.map(r => api.getTree(r.id)))
```
无需像 V2 那样嵌套 Promise.all 分层请求。

**展开/折叠**：
- 默认：所有需求行展开；epic/feature/story 按 V2 逻辑自动判断（running 子节点展开，全完成/全 pending 折叠）
- 用户点击 ± 切换

**行渲染**：
- 左竖条颜色：需求蓝(`--accent`) / 史诗绿(`--st-done`) / 特性橙(`--st-paused`) / 故事紫(`--ai`) / 任务灰(`--st-pending`)
- 缩进：`12 + depth * 20` px
- running 行：`background: color-mix(in srgb, var(--st-running) 8%, transparent)` + CSS 呼吸动画
- 标题：`flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`

**行交互**：
- 需求行点击 → 展开/折叠该需求的分解树（不再跳页，所有信息已在当前树中）
- 任务行点击标题 → 跳转 `/tasks/:execution_id`（保留现有任务详情页入口）
- 史诗 / 特性 / 故事行点击 → 仅展开/折叠子节点

**行按钮**：
- 按上节"V4 实际可用的 Row Actions"渲染
- 按钮过多时次要按钮折叠到 `el-dropdown`（"更多"），主按钮直接显示

**状态展示**：
- 状态 chip 使用中文标签：`draft=草稿 / pending=待执行 / running=执行中 / completed=已完成 / failed=失败 / cancelled=已取消 / waiting=等待回答 / paused=已暂停`
- 沿用现有 `aggStatus(item) = item.execution_status || item.status` 逻辑

**操作后刷新**：
- 执行任何 action（执行/停止/确认/删除）后，调用 `api.getTree(requirementId)` 重新加载该需求的子树
- 不整页刷新，避免其他需求行的展开状态丢失

### API Client 补充

`packages/dashboard/src/api/requirements.ts` 需新增：
- `confirmAll(requirementId)` — 封装 `POST /api/requirements/:id/confirm-all-tasks`

`packages/dashboard/src/api/tasks.ts` 确认已有：
- `confirm(id)` / `execute(id)` / `remove(id)`（如无则补）

## 涉及的文件

| 文件 | 改动类型 |
|---|---|
| `packages/dashboard/src/views/Requirements.vue` | 重构：卡片列表 → 树形主页面，去掉 drawer |
| `packages/dashboard/src/components/RequirementTreeView.vue` | 重写：从 drawer 子组件 → 全宽树核心组件，增加 row actions |
| `packages/dashboard/src/api/requirements.ts` | 新增 `confirmAll` 方法 |
| `packages/dashboard/src/api/tasks.ts` | 确认/补充 `confirm` / `execute` / `remove` |

## 验证

1. `pnpm --filter @xuanji/dashboard build` 通过
2. 启动 dashboard（`pnpm --filter @xuanji/dashboard dev`），访问 `/requirements`：
   - 看到树形列表，所有需求 + 分解层级在同一页
   - 每行右侧有对应 action 按钮（按状态显示）
   - 层级视觉线索正确（颜色、缩进、running 呼吸动画）
3. 操作验证：
   - 需求行"执行"按钮 → 触发分解
   - 任务行"确认"按钮 → draft 任务变为 pending
   - 任务行"执行"按钮 → 触发任务执行
   - 行"日志"按钮 → 打开 log drawer
   - 任务行点击 → 跳转 `/tasks/:id`
4. 抽屉移除：原 600px `el-drawer` 不再出现

## 已知限制（不阻塞本次改造）

- `/api/requirements/:id/tree` 返回的任务节点中 `task_type`、`execution_id`、`estimated_hours` 为硬编码 `null`（mapper 未读取底层 Task 字段）→ 工时 chip 暂不显示，后续可补
- 需求数量大时一次性全量加载有性能风险，暂不处理（V2 同样如此），后续可加分页或懒加载

