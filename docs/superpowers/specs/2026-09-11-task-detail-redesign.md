# 任务详情页重设计 Spec

> 日期：2026-09-11
> 状态：草案，待用户 review
> 影响范围：`packages/dashboard/src/views/TaskDetail.vue`、`packages/core/src/routes/tasks.mts`、相关 API 类型

---

## 1. 背景与问题

### 当前页面状态

任务详情页（`/tasks/:id`）在璇玑 V4 系统中承担三个职责：

1. **监控**：让用户知道"AI 现在在做什么"
2. **复盘**：让用户看到"AI 做了什么"
3. **介入**：让用户能够暂停/继续/重试

### 已发现的问题

| # | 问题 | 影响 | 严重性 |
|---|------|------|--------|
| P1 | "已完成" 状态 vs "3/6 阶段完成" 显示冲突 | 用户困惑，不知道任务是否真正完成 | 高 |
| P2 | Phase 产出物区始终显示"暂无产出物" | 用户无法在页面看到 AI 工作成果，必须去画布/日志抽屉才能看到 | 高 |
| P3 | 拆分内容区始终显示"暂无结构化拆分信息" | 用户无法在此页看到任务原始需求（验收标准等） | 中 |
| P4 | 顶部双卡并列浪费空间，信息重复 | 状态卡片与进度卡片展示重复信息 | 中 |
| P5 | AI 实际工作成果藏在抽屉里 | 复盘效率低，违反"可见的工作"原则 | 高 |
| P6 | `task_executions.stage` 字段停留在 'planning' 未更新 | 误导用户当前阶段 | 中 |

### 根因

**P1**：`task_executions.status = 'completed'` 与 `phase_instances` 状态是两套独立数据源，前端笛卡尔积显示 workflow 全部节点，未考虑条件边跳过的节点（code_fix）和 gate 类型节点（final_review 不创建 phase_instance）。

**P2**：`routes/tasks.mts:111` 硬编码 `phase_outputs: []`，未查询 `phase_outputs` 表。该表实际有数据（每个完成的 phase 一条记录）。

**P3**：`routes/tasks.mts:104` 只取 `tasks.description`，未回退到 `tasks.acceptance_criteria`。直接创建的任务（非经 AI 拆分）`description` 为 null。

**P6**：`graph-runner.mts` 完成执行后未更新 `stage` 字段到最终节点 ID。

---

## 2. 设计目标

### 核心转变

**从"状态仪表盘"到"工作叙事"**

现状：页面是"任务跑到了哪一步"。
目标：页面是"AI 这次做了什么、做得如何"。

### 设计原则

1. **状态优先但不重复**：状态信息要突出，但不要重复展示（去掉双卡并列）
2. **可见的工作**：AI 的每个阶段产出直接展示在主内容区，不藏在折叠面板或抽屉里
3. **流程清晰**：只显示实际执行的阶段，不要展示被条件边跳过的未来阶段
4. **时间线感**：每个阶段带耗时，让用户感受到时间如何流过
5. **始终有内容**：拆分内容回退到验收标准，确保不出现空状态

---

## 3. 信息架构

### 新布局结构

```
┌─────────────────────────────────────────────────────────────┐
│ 面包屑：任务 / 实现图书分类后端API                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✓ 已完成           实现图书分类后端API                        │  Zone A: 标题条
│                     开始 09:16 · 用时 48m · 0eaa4532          │
│                                                             │
│  [查看画布] [对话] [日志] [重试]                              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ● write_tests ── ● develop ── ● test                       │  Zone B: 流程条
│    ✓ 48m           ✓ 6m          ✓ 37m                       │   （仅已执行节点）
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌───────────────────────────────────┬─────────────────────────┐
│                                   │                         │
│  ▌任务要求                        │  ▌元信息                 │  Zone C: 双列内容
│  提供 /library/category CRUD 接口 │  项目: ruoyi-system      │
│  验收: 树形结构, 删除检查...      │  Provider: claude        │
│                                   │  会话: abc12345          │
│                                   │  Token: 125k / 48k       │
│  ▌write_tests 阶段结果             │  Cost: $0.82             │
│  ## 测试任务完成总结               │                         │
│  - BookCategoryApiTest: 20 通过   │  ▌阶段产出物（折叠）     │
│  - BDD 覆盖 100%                  │  • write_tests · 结果    │
│                                   │  • develop · 结果        │
│  ▌develop 阶段结果                 │  • test · 结果           │
│  ## 新增文件                      │                         │
│  + BookCategoryController.java    │                         │
│  ...                              │                         │
│                                   │                         │
│  ▌test 阶段结果                    │                         │
│  ## 测试结果                      │                         │
│  | 维度 | 结果 |                  │                         │
│                                   │                         │
└───────────────────────────────────┴─────────────────────────┘
```

### 信息层级

**Zone A — 标题条**（高度约 80px）

| 元素 | 内容 | 来源 |
|------|------|------|
| 状态徽章 | ✓ 已完成 | `task_executions.status` |
| 任务标题 | 实现图书分类后端API | `tasks.title` 或 `breakdown.title` |
| 时间戳 | 开始 09:16 | `task_executions.started_at` |
| 耗时 | 用时 48m | `completed_at - started_at` |
| 执行 ID | 0eaa4532（截短） | `task_executions.execution_id` |
| 操作按钮 | 查看画布 / 对话 / 日志 / 重试 | 根据状态条件展示 |

**Zone B — 流程条**（水平 stepper，高度约 60px）

| 元素 | 内容 | 来源 |
|------|------|------|
| 节点 | 每个已执行的阶段 | `phase_instances` 表 join workflow definition |
| 节点状态 | ✓ 完成 / ✗ 失败 / ● 运行 / ○ 待执行 | `phase_instances.status` |
| 耗时标签 | 48m / 6m / 37m | `phase_instances.completed_at - started_at` |
| 连接线 | 实线（已连接）/ 虚线（进行中） | 基于状态推导 |

**关键改动**：只显示 `phase_instances` 有记录的阶段，不展示 workflow 定义中但未被执行的阶段。去掉 "N/M 阶段完成" 这种分数显示。

**Zone C — 主内容区**（响应式两列布局：桌面端左右 65% / 35%，平板 ≤1024px 上下堆叠）

**左列（主）**：
1. **任务要求卡**（原"拆分内容"，改名）：展示任务的验收标准、描述、优先级等。如果 `tasks.description` 为空，回退到 `tasks.acceptance_criteria`。
2. **各阶段结果**：每个 phase 的输出结果，markdown 渲染。每张卡带左侧紫色色带（`--ai` 色）。

**右列（辅）**：
1. **元信息卡**：项目、Provider、会话 ID、Token 统计、成本（如果有）
2. **阶段产出物索引**：列出所有 phase_outputs 的简要信息（phase 名 + 创建时间），点击滚动到左列对应结果

---

## 4. 后端改动

### 4.1 `routes/tasks.mts` · `GET /api/tasks/:id`

#### 修复 1：填充 phase_outputs

```ts
// 当前：phase_outputs: []
// 改为：

const phaseOutputs = await db.phase_outputs.findMany({
  where: {
    phase_instance_id: { in: phases.map(p => p.id) },
  },
  orderBy: { created_at: 'asc' },
});

// 将 phase_outputs join phase_instances，得到每个输出的 node_id/iteration
const enrichedOutputs = phaseOutputs.map(po => {
  const pi = phases.find(p => p.id === po.phase_instance_id);
  return {
    id: po.id,
    execution_id: execution.execution_id,
    node_id: pi?.phase_id ?? 'unknown',
    iteration: pi?.attempt ?? 1,
    key: po.key,
    value: po.value,      // markdown 文本
    created_at: po.created_at?.toISOString?.() ?? null,
  };
});
```

#### 修复 2：breakdown_content 回退

```ts
// 当前：breakdown_content: execution.tasks?.description ?? null
// 改为：

const breakdown_content =
  execution.tasks?.description
  ?? (execution.tasks?.acceptance_criteria
      ? JSON.stringify({
          acceptance_criteria: execution.tasks.acceptance_criteria,
          title: execution.tasks?.title,
        })
      : null);
```

如果 `description` 为 null，将 `acceptance_criteria` 字段包装成 JSON 对象作为 `breakdown_content` 返回。前端已有 JSON 解析逻辑，会正确渲染。

#### 修复 3：增加 phase_instances 的耗时字段

当前 `session_refs` 已经返回 `phase_instances` 数据，但缺少 `started_at` 和 `completed_at`。需要补上：

```ts
session_refs: phases.map((p: any) => ({
  id: p.id,
  node_id: p.phase_id,
  iteration: p.attempt,
  role: p.agent_used ?? 'unknown',
  omnigent_session_id: p.session_id ?? '',
  omnigent_status: p.status,
  started_at: p.started_at?.toISOString?.() ?? null,      // 新增
  completed_at: p.completed_at?.toISOString?.() ?? null,  // 新增
})),
```

### 4.2 `routes/tasks.mts` · 可选增强

**新增 `GET /api/executions/:id/outputs` 端点**

PhaseTimelineGantt.vue 组件调用这个端点，但后端未实现。为保持其他页面正常工作，补上这个端点：

```ts
executionsRouter.get('/:id/outputs', async (req, res) => {
  const execution = await db.task_executions.findUnique({
    where: { execution_id: req.params.id },
  });
  if (!execution) return res.status(404).json({ error: 'Not found' });

  const phases = await db.phase_instances.findMany({
    where: { execution_id: req.params.id },
  });
  const outputs = await db.phase_outputs.findMany({
    where: { phase_instance_id: { in: phases.map(p => p.id) } },
    orderBy: { created_at: 'asc' },
  });

  const list = outputs.map(o => {
    const pi = phases.find(p => p.id === o.phase_instance_id);
    return {
      id: o.id,
      node_id: pi?.phase_id,
      iteration: pi?.attempt,
      key: o.key,
      value: o.value,
      created_at: o.created_at,
    };
  });
  res.json(list);
});
```

---

## 5. 前端改动

### 5.1 `TaskDetail.vue` 结构重写

#### 删除的内容

- 顶部双卡并列结构（`top-cards` grid）
- `phaseOutputsExpanded` 折叠逻辑（产出物不再折叠）
- `phaseStatuses` 中基于 workflow 全节点的计算（改为只展示有记录的阶段）
- "拆分内容" 标题（改为"任务要求"）

#### 新增的内容

**Zone A — 标题条**

单行布局：状态徽章 + 标题 + 时间 + 操作按钮。

**Zone B — 流程条**

```ts
const phaseStatuses = computed<PhaseStatus[]>(() => {
  const d = detail.value
  if (!d) return []

  // 只从 session_refs（即 phase_instances）生成阶段列表
  // 不再从 workflow 全节点生成（避免显示未执行的阶段）
  const statusMap = new Map<string, { status: string; iteration: number; started_at: string | null; completed_at: string | null }>()

  for (const sr of d.session_refs) {
    const existing = statusMap.get(sr.node_id)
    if (!existing || sr.iteration > existing.iteration) {
      statusMap.set(sr.node_id, {
        status: sr.omnigent_status === 'completed' ? 'done' : sr.omnigent_status,
        iteration: sr.iteration || 0,
        started_at: sr.started_at,
        completed_at: sr.completed_at,
      })
    }
  }

  // 按照 workflow 定义的顺序排序（如果有 workflow），否则按 phaseOrder
  const order = workflow.value?.definition_json?.nodes?.map((n: any) => n.id) || phaseOrder

  return order
    .filter(id => statusMap.has(id))  // 只保留有记录的阶段
    .map(id => {
      const info = statusMap.get(id)!
      return {
        id,
        label: phaseLabel(id),
        status: info.status as PhaseStatus['status'],
        iteration: info.iteration,
        started_at: info.started_at,
        completed_at: info.completed_at,
      }
    })
})
```

去掉 "N/M 阶段完成" 摘要行。

**Zone C — 主内容区**

左列：
- 任务要求卡：使用 `parsedBreakdown` 渲染，回退逻辑在后端完成
- 阶段结果卡：遍历 `detail.phase_outputs`，每个输出一张卡，markdown 渲染 `value` 字段

右列：
- 元信息卡：grid 布局，显示项目/Provider/会话 ID/Token/Cost
- 阶段产出物索引：简单列表，点击滚动到左列对应卡

### 5.2 Markdown 渲染

需要添加 markdown 渲染能力。方案：

**选项 A：使用 `marked` 库（推荐）**

```bash
pnpm --filter @xuanji/dashboard add marked
```

```ts
import { marked } from 'marked'

// 安全：启用 marked 内置 sanitize 选项，避免 XSS
marked.setOptions({
  breaks: true,   // 换行符转 <br>
  gfm: true,      // 支持 GitHub 风格 markdown（表格、任务列表等）
})

function renderMarkdown(md: string): string {
  // marked 默认不 sanitize，需配合 DOMPurify 做二次过滤
  return DOMPurify.sanitize(marked.parse(md) as string)
}
```

需要额外安装 DOMPurify：

```bash
pnpm --filter @xuanji/dashboard add dompurify @types/dompurify
```

**选项 B：简单的 pre + 基础 HTML 转换**

不引入新依赖，用简单的正则把 `##`、`**`、`-` 等转成 HTML。适合 MVP，但长期不推荐。

**推荐选项 A**，marked + DOMPurify 合计 ~20KB gzip，功能完整且安全。

### 5.3 视觉细节

**阶段结果卡样式**

```css
.phase-result-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--ai);  /* 紫色左侧色带 */
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
}

.phase-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.phase-result-title {
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
  color: var(--ai);  /* 紫色标题 */
}

.phase-result-body {
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}
```

**流程条样式**

```css
.phase-flow {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 16px 0;
}

.phase-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.phase-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.phase-dot.done {
  background: rgba(34, 197, 94, 0.15);
  color: var(--st-done);
  border: 1px solid var(--st-done);
}

.phase-dot.done::before { content: '✓'; }

.phase-dot.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--st-failed);
  border: 1px solid var(--st-failed);
}

.phase-dot.failed::before { content: '✗'; }

.phase-dot.running {
  background: rgba(34, 211, 238, 0.15);
  color: var(--st-running);
  border: 1px solid var(--st-running);
  animation: v2-pulse 1.5s ease-in-out infinite;
}

.phase-dot.running::before { content: '●'; }

.phase-connector {
  flex: 1;
  height: 2px;
  background: var(--border);
  margin: 0 8px;
}

.phase-connector.done {
  background: var(--st-done);
}

.phase-duration {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
```

---

## 6. 数据流

```
GET /api/tasks/:id
    ↓
后端查询：
    - task_executions (execution 元数据)
    - tasks (title, description, acceptance_criteria)
    - phase_instances (阶段记录)
    - phase_outputs (阶段产出，新增查询)
    ↓
返回 TaskDetail 对象：
    - id, title, status, ...
    - breakdown_content (description ?? acceptance_criteria 包装)
    - session_refs (带 started_at, completed_at)
    - phase_outputs (新增，非空数组)
    ↓
前端 TaskDetail.vue 渲染：
    - Zone A: 标题条
    - Zone B: 流程条 (session_refs 过滤已执行阶段)
    - Zone C: 左列 (任务要求 + phase_outputs markdown)
              右列 (元信息 + 产出物索引)
```

---

## 7. 边界情况

### 7.1 任务从未执行（status = pending）

- Zone A：状态显示"待执行"，操作按钮显示"执行"
- Zone B：流程条为空（无 phase_instances）
- Zone C：左列只显示任务要求；右列只显示元信息
- 阶段结果区：显示"任务尚未执行，无阶段结果"

### 7.2 任务执行失败（status = failed）

- Zone A：状态徽章红色
- Zone B：最后一个 phase 显示 ✗ 失败
- Zone C：失败 phase 的结果仍然展示（如果有）
- 操作按钮显示"重试"

### 7.3 任务被取消（status = cancelled）

- Zone A：状态显示"已取消"
- Zone B：已完成的 phase 显示 ✓，后续无
- Zone C：正常展示已完成 phase 的结果

### 7.4 phase_outputs 为空（例如早期数据）

- 阶段结果区显示"此阶段无产出记录"
- 不阻断页面渲染

### 7.5 breakdown_content 仍然为空（极端情况）

- 任务要求区显示"此任务未提供详细要求"
- 不显示空状态

---

## 8. 测试策略

### 8.1 后端测试

在 `packages/core/test/` 添加：

- `test/routes/tasks-outputs.test.mts`：验证 `GET /api/tasks/:id` 返回非空 `phase_outputs`
- `test/routes/tasks-breakdown-fallback.test.mts`：验证 `breakdown_content` 回退到 `acceptance_criteria`
- `test/routes/execution-outputs.test.mts`：验证 `GET /api/executions/:id/outputs` 端点

### 8.2 前端手动测试

使用现有执行 `728fbb58-bd42-4492-9424-38500eaa4532`（图书分类 API）验证：

- [ ] 标题条正确显示状态、标题、时间
- [ ] 流程条只显示 3 个已执行阶段（write_tests / develop / test），每个带耗时
- [ ] 任务要求区显示验收标准（来自 acceptance_criteria）
- [ ] 阶段结果区展示 3 条 markdown 内容
- [ ] 右侧元信息卡显示 Token/会话 ID 等

### 8.3 视觉回归

修改前后截图对比：

- 修改前：`/canvas-screenshot.png`、`/tasks-screenshot.png`
- 修改后：新截图保存同目录

---

## 9. 实施顺序

按依赖关系排序：

1. **后端：填充 phase_outputs**（`routes/tasks.mts`）
2. **后端：breakdown_content 回退逻辑**
3. **后端：session_refs 增加 started_at/completed_at**
4. **后端：新增 `/api/executions/:id/outputs` 端点**（可选，为其他页面兼容）
5. **前端：安装 marked 库**
6. **前端：重写 TaskDetail.vue 布局**
   - 6.1 Zone A 标题条
   - 6.2 Zone B 流程条（改用 session_refs-only 计算）
   - 6.3 Zone C 左列（任务要求 + 阶段结果 markdown 渲染）
   - 6.4 Zone C 右列（元信息 + 产出物索引）
7. **前端：视觉微调与响应式适配**
8. **测试与截图对比**

---

## 10. 成功标准

### 功能标准

- 任务详情页能正确展示 phase_outputs（非空）
- 任务详情页能正确展示任务要求（即使 description 为空）
- 流程条只显示实际执行的阶段，不带误导性的 "N/M" 分数
- 所有 phase_outputs 内容以 markdown 正确渲染

### 体验标准

- 用户打开页面 3 秒内能回答：
  1. 任务完成了吗？（标题条状态）
  2. 花了多久？（标题条时间 + 流程条每阶段耗时）
  3. AI 做了什么？（阶段结果区 markdown）
- 复盘不需要打开抽屉或跳转到画布

### 兼容性标准

- 不影响现有画布页（`/canvas`）功能
- 不影响执行概览页（`/executions`）功能
- 旧数据（无 phase_outputs）不显示错误状态

---

## 11. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| marked + DOMPurify 引入增加 bundle 体积 | 合计 ~20KB gzip，可接受；如未来需要更复杂渲染（如代码块高亮）可换 markdown-it + highlight.js |
| 历史数据 phase_outputs 为空 | 前端降级显示"此阶段无产出记录"，不报错 |
| 流程条排序与 workflow 定义不一致 | 按 workflow definition 的节点顺序排序，无 workflow 时回退硬编码 phaseOrder |
| markdown 渲染仍含恶意脚本 | DOMPurify 二次过滤（section 5.2），所有 HTML 输出均经 sanitize |

---

## 12. 范围外

以下不在本次 spec 范围：

- 对话/日志抽屉重构（保持现状）
- 画布页（`/canvas`）改动
- 执行概览页（`/executions`）改动
- 实时刷新逻辑改动（保持 5s 轮询）
- Token/Cost 后端聚合（当前后端返回 null，前端显示时跳过）
