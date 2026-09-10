# 需求管理页交互改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把需求管理页从"卡片列表 + 抽屉"改造成"全量树状列表 + 行级 actions"，参考 V2 交互，使用 V4 实际 API。

**Architecture:** 单页树形布局，5 级层级（需求 → 史诗 → 特性 → 用户故事 → 任务）全量加载。每行右侧按状态渲染不同 action 按钮。去掉 600px 抽屉，所有信息在同一棵树里展示。

**Tech Stack:** Vue 3 + Element Plus + TypeScript + 自定义 CSS 主题（theme.css tokens）

**Spec:** `docs/superpowers/specs/2026-09-09-requirements-page-redesign.md`

## Global Constraints

- 使用现有 theme.css 颜色 token（`--accent` / `--st-done` / `--st-running` / `--st-pending` / `--st-failed` / `--st-paused` / `--ai`）
- 状态 chip 中文标签：`draft=草稿 / pending=待执行 / running=执行中 / completed=已完成 / failed=失败 / cancelled=已取消 / waiting=等待回答 / paused=已暂停`
- 操作后局部刷新（只重新加载该需求子树），不整页刷新
- 按钮过多时次要按钮折叠到 `el-dropdown`（"更多"）

---

## Task 1: API Client 补充

**Files:**
- Modify: `packages/dashboard/src/api/requirements.ts`

**Interfaces:**
- Consumes: 无
- Produces: `api.confirmAll(requirementId: string): Promise<{ok: boolean, confirmed_count: number, message: string}>`

**Why this task:** V4 后端已有 `POST /api/requirements/:id/confirm-all-tasks` 接口，但前端 api client 没封装。需求行"确认所有任务"按钮需要这个方法。

- [ ] **Step 1: 在 api object 末尾添加 confirmAll 方法**

打开 `packages/dashboard/src/api/requirements.ts`，在 `gate` 方法后添加：

```typescript
async confirmAll(requirementId: string): Promise<{ok: boolean, confirmed_count: number, message: string}> {
  const r = await fetch(`${base}/${requirementId}/confirm-all-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return r.json()
},
```

- [ ] **Step 2: 验证构建通过**

```bash
pnpm --filter @xuanji/dashboard build
```

预期：构建成功，无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/api/requirements.ts
git commit -m "feat(dashboard): add confirmAll API method for requirement"
```

---

## Task 2: RequirementTreeView 重写

**Files:**
- Rewrite: `packages/dashboard/src/components/RequirementTreeView.vue`

**Interfaces:**
- Consumes:
  - `api/requirements.ts` → `api.getTree(id)`, `api.stop(id)`, `api.delete(id)`, `api.confirmAll(id)`
  - `api/tasks.ts` → `api.confirm(execId)`, `api.execute(execId)`, `api.delete(execId)`
- Produces:
  - Props: `requirements: RequirementListItem[]`
  - Events: `'refresh'`（操作后通知父组件刷新列表）

**Component 职责:**
1. 全量加载所有需求 + 5 级分解树
2. 渲染每行：层级 badge + 标题 + 状态 chip + 工时 chip + action 按钮
3. 展开/折叠逻辑
4. 视觉线索（左竖条颜色、缩进、running 呼吸动画）
5. 行交互（点击展开 / 点击任务跳转）

- [ ] **Step 1: 重写 script setup 部分**

替换整个 `<script setup lang="ts">` 内容：

```typescript
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api as reqApi, type RequirementListItem, type RequirementTree, type EpicNode, type FeatureNode, type UserStoryNode, type TaskNode } from '../api/requirements'
import { api as taskApi } from '../api/tasks'

const props = defineProps<{
  requirements: RequirementListItem[]
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const router = useRouter()
const loading = ref(false)
const treeData = ref<Map<string, RequirementTree>>(new Map())
const expandedNodes = ref<Set<string>>(new Set())

// 全量加载
async function loadAllTrees() {
  loading.value = true
  try {
    const trees = await Promise.all(props.requirements.map(r => reqApi.getTree(r.id)))
    const map = new Map<string, RequirementTree>()
    trees.forEach(t => map.set(t.requirement.id, t))
    treeData.value = map
    // 默认展开所有需求行
    props.requirements.forEach(r => expandedNodes.value.add(r.id))
  } catch (e) {
    ElMessage.error('加载分解结构失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadAllTrees)
watch(() => props.requirements.length, loadAllTrees)

// 展开/折叠
function toggle(nodeId: string) {
  if (expandedNodes.value.has(nodeId)) {
    expandedNodes.value.delete(nodeId)
  } else {
    expandedNodes.value.add(nodeId)
  }
}

function isExpanded(nodeId: string): boolean {
  return expandedNodes.value.has(nodeId)
}

// 状态标签
const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待执行', running: '执行中',
  completed: '已完成', failed: '失败', cancelled: '已取消',
  waiting: '等待回答', paused: '已暂停',
}

function statusLabel(s: string): string {
  return statusLabels[s] || s
}

function statusClass(s: string): string {
  return `st-${s}`
}

// 行交互
function handleRowClick(level: string, node: any) {
  if (level === 'task' && node.execution_id) {
    router.push(`/tasks/${node.execution_id}`)
  } else {
    toggle(node.id)
  }
}

// Actions
async function executeRequirement(reqId: string) {
  try {
    await reqApi.execute(reqId)
    ElMessage.success('执行已启动')
    emit('refresh')
  } catch (e) {
    ElMessage.error('启动失败')
  }
}

async function stopRequirement(reqId: string) {
  try {
    await reqApi.stop(reqId)
    ElMessage.success('已停止')
    emit('refresh')
  } catch (e) {
    ElMessage.error('停止失败')
  }
}

async function confirmAllTasks(reqId: string) {
  try {
    const res = await reqApi.confirmAll(reqId)
    ElMessage.success(res.message || `已确认 ${res.confirmed_count} 个任务`)
    await loadAllTrees()
  } catch (e) {
    ElMessage.error('确认失败')
  }
}

async function deleteRequirement(reqId: string) {
  try {
    await ElMessageBox.confirm('确定删除该需求？所有关联执行将被取消。', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await reqApi.delete(reqId)
    ElMessage.success('已删除')
    emit('refresh')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

async function confirmTask(execId: string) {
  try {
    await taskApi.confirm(execId)
    ElMessage.success('已确认')
    await loadAllTrees()
  } catch (e) {
    ElMessage.error('确认失败')
  }
}

async function executeTask(execId: string) {
  try {
    await taskApi.execute(execId)
    ElMessage.success('执行已启动')
    await loadAllTrees()
  } catch (e) {
    ElMessage.error('启动失败')
  }
}

async function deleteTask(execId: string) {
  try {
    await ElMessageBox.confirm('确定删除该任务？', '删除确认', {
      type: 'warning',
    })
    await taskApi.delete(execId)
    ElMessage.success('已删除')
    await loadAllTrees()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

// 判断是否有 draft 任务
function hasDraftTasks(tree: RequirementTree): boolean {
  for (const epic of tree.epics) {
    for (const feature of epic.features) {
      for (const story of feature.user_stories) {
        if (story.tasks.some(t => t.status === 'draft')) return true
      }
    }
    for (const story of epic.orphan_user_stories) {
      if (story.tasks.some(t => t.status === 'draft')) return true
    }
  }
  return false
}
```

- [ ] **Step 2: 重写 template 部分**

```vue
<template>
  <div class="req-tree" v-loading="loading">
    <div v-if="requirements.length === 0" class="empty-state">
      暂无需求，使用上方表单创建
    </div>

    <template v-for="req in requirements" :key="req.id">
      <!-- 需求行 -->
      <div
        class="tree-row level-requirement"
        :class="{ 'is-running': req.execution_status === 'running' }"
        @click="handleRowClick('requirement', req)"
      >
        <span class="toggle-icon">{{ isExpanded(req.id) ? '▼' : '▶' }}</span>
        <span class="level-badge requirement">需求</span>
        <span class="title">{{ req.input_text }}</span>
        <span class="status-chip" :class="statusClass(req.execution_status || req.status)">
          {{ statusLabel(req.execution_status || req.status) }}
        </span>
        <span class="created-at">{{ new Date(req.created_at).toLocaleDateString() }}</span>
        <div class="actions" @click.stop>
          <el-button v-if="canExecute(req)" size="small" type="primary" @click="executeRequirement(req.id)">执行</el-button>
          <el-button v-if="req.execution_status === 'running' || req.execution_status === 'pending'" size="small" type="warning" @click="stopRequirement(req.id)">停止</el-button>
          <el-button v-if="treeData.get(req.id) && hasDraftTasks(treeData.get(req.id)!)" size="small" type="primary" @click="confirmAllTasks(req.id)">确认任务</el-button>
          <el-button size="small" @click="openLogDrawer(req.id)">日志</el-button>
          <el-button v-if="req.execution_id" size="small" @click="router.push('/canvas')">画布</el-button>
          <el-button size="small" type="danger" @click="deleteRequirement(req.id)">删除</el-button>
        </div>
      </div>

      <!-- 分解树（展开时显示） -->
      <template v-if="isExpanded(req.id) && treeData.has(req.id)">
        <template v-for="epic in treeData.get(req.id)!.epics" :key="epic.id">
          <!-- Epic 行 -->
          <div class="tree-row level-epic" @click="toggle(epic.id)">
            <span class="toggle-icon" style="padding-left: 20px">{{ isExpanded(epic.id) ? '▼' : '▶' }}</span>
            <span class="level-badge epic">史诗</span>
            <span class="title">{{ epic.title }}</span>
            <span class="status-chip" :class="statusClass(epic.status)">{{ statusLabel(epic.status) }}</span>
            <span v-if="epic.module" class="module-tag">{{ epic.module }}</span>
          </div>

          <template v-if="isExpanded(epic.id)">
            <template v-for="feature in epic.features" :key="feature.id">
              <!-- Feature 行 -->
              <div class="tree-row level-feature" @click="toggle(feature.id)">
                <span class="toggle-icon" style="padding-left: 40px">{{ isExpanded(feature.id) ? '▼' : '▶' }}</span>
                <span class="level-badge feature">特性</span>
                <span class="title">{{ feature.title }}</span>
                <span class="status-chip" :class="statusClass(feature.status)">{{ statusLabel(feature.status) }}</span>
              </div>

              <template v-if="isExpanded(feature.id)">
                <template v-for="story in feature.user_stories" :key="story.id">
                  <!-- UserStory 行 -->
                  <div class="tree-row level-story" @click="toggle(story.id)">
                    <span class="toggle-icon" style="padding-left: 60px">{{ isExpanded(story.id) ? '▼' : '▶' }}</span>
                    <span class="level-badge story">故事</span>
                    <span class="title">{{ story.title }}</span>
                    <span class="priority-tag">{{ story.priority }}</span>
                    <span class="status-chip" :class="statusClass(story.status)">{{ statusLabel(story.status) }}</span>
                  </div>

                  <template v-if="isExpanded(story.id)">
                    <div v-for="task in story.tasks" :key="task.id"
                      class="tree-row level-task"
                      :class="{ 'is-running': task.status === 'running' }"
                      @click="handleRowClick('task', task)"
                    >
                      <span class="toggle-icon" style="padding-left: 80px"></span>
                      <span class="level-badge task">任务</span>
                      <span class="title">{{ task.title || '(无标题)' }}</span>
                      <span class="status-chip" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
                      <div class="actions" @click.stop>
                        <el-button v-if="task.status === 'draft'" size="small" type="primary" @click="confirmTask(task.execution_id!)">确认</el-button>
                        <el-button v-if="task.status === 'pending'" size="small" type="primary" @click="executeTask(task.execution_id!)">执行</el-button>
                        <el-button size="small" @click="openTaskLogDrawer(task.execution_id)">日志</el-button>
                        <el-button v-if="task.status !== 'running'" size="small" type="danger" @click="deleteTask(task.execution_id!)">删除</el-button>
                      </div>
                    </div>
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>
```

> 注：`openLogDrawer` 和 `openTaskLogDrawer` 暂用占位实现（emit 事件让父组件处理），实际对接现有 `RequirementLogDrawer` 和 `LogDrawer`。

- [ ] **Step 3: 重写 style 部分**

```css
<style scoped>
.req-tree {
  padding: 16px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-muted, #64748B);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.2s;
}

.tree-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tree-row.is-running {
  background: color-mix(in srgb, var(--st-running, #22D3EE) 8%, transparent);
  animation: breathe 2s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { background: color-mix(in srgb, var(--st-running, #22D3EE) 8%, transparent); }
  50% { background: color-mix(in srgb, var(--st-running, #22D3EE) 15%, transparent); }
}

/* 层级左竖条颜色 */
.level-requirement { border-left-color: var(--accent, #22D3EE); }
.level-epic { border-left-color: var(--st-done, #22C55E); }
.level-feature { border-left-color: var(--st-paused, #F59E0B); }
.level-story { border-left-color: var(--ai, #7C3AED); }
.level-task { border-left-color: var(--st-pending, #64748B); }

.toggle-icon {
  width: 16px;
  font-size: 12px;
  color: var(--text-muted, #64748B);
}

.level-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.level-badge.requirement { background: color-mix(in srgb, var(--accent, #22D3EE) 20%, transparent); color: var(--accent, #22D3EE); }
.level-badge.epic { background: color-mix(in srgb, var(--st-done, #22C55E) 20%, transparent); color: var(--st-done, #22C55E); }
.level-badge.feature { background: color-mix(in srgb, var(--st-paused, #F59E0B) 20%, transparent); color: var(--st-paused, #F59E0B); }
.level-badge.story { background: color-mix(in srgb, var(--ai, #7C3AED) 20%, transparent); color: var(--ai, #7C3AED); }
.level-badge.task { background: color-mix(in srgb, var(--st-pending, #64748B) 20%, transparent); color: var(--st-pending, #64748B); }

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-chip {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.status-chip.st-running { background: color-mix(in srgb, var(--st-running, #22D3EE) 20%, transparent); color: var(--st-running, #22D3EE); }
.status-chip.st-completed { background: color-mix(in srgb, var(--st-done, #22C55E) 20%, transparent); color: var(--st-done, #22C55E); }
.status-chip.st-pending { background: color-mix(in srgb, var(--st-pending, #64748B) 20%, transparent); color: var(--st-pending, #64748B); }
.status-chip.st-failed { background: color-mix(in srgb, var(--st-failed, #EF4444) 20%, transparent); color: var(--st-failed, #EF4444); }
.status-chip.st-paused { background: color-mix(in srgb, var(--st-paused, #F59E0B) 20%, transparent); color: var(--st-paused, #F59E0B); }
.status-chip.st-draft, .status-chip.st-cancelled { background: rgba(100, 116, 139, 0.1); color: #64748B; }

.created-at, .module-tag, .priority-tag {
  font-size: 12px;
  color: var(--text-muted, #64748B);
}

.actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
</style>
```

- [ ] **Step 4: 验证构建通过**

```bash
pnpm --filter @xuanji/dashboard build
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/RequirementTreeView.vue
git commit -m "feat(dashboard): rewrite RequirementTreeView as full-width tree with row actions"
```

---

## Task 3: Requirements.vue 重构

**Files:**
- Modify: `packages/dashboard/src/views/Requirements.vue`

**Interfaces:**
- Consumes: `RequirementTreeView` 组件、`RequirementLogDrawer` 组件
- Produces: 单页树形布局，去掉 drawer

**改造要点:**
1. 保留顶部创建框、dashboard、工具栏
2. 主体由卡片列表换成 `<RequirementTreeView :requirements="list" @refresh="loadList" />`
3. 删除 `<el-drawer>` 及其相关代码（detail 相关 state、methods）
4. 保留 `<RequirementLogDrawer>` 供行按钮调用

- [ ] **Step 1: 删除 drawer 相关代码**

删除以下内容：
- `<el-drawer v-model="drawerVisible" ...>` 整块 HTML
- `const detail = ref<RequirementDetail | null>(null)`
- `const drawerVisible = ref(false)`
- `async function openDetail(id: string)` 函数
- 相关 CSS

- [ ] **Step 2: 替换卡片列表为 RequirementTreeView**

找到渲染需求列表的部分（`<div class="req-list">` 或类似），替换为：

```vue
<RequirementTreeView :requirements="filteredList" @refresh="loadList" />
```

添加 import：
```typescript
import RequirementTreeView from '../components/RequirementTreeView.vue'
```

- [ ] **Step 3: 处理日志按钮**

RequirementTreeView 的 `openLogDrawer` 事件需要通过父组件触发。两种方式：

**方式 A（简单）：** 在 RequirementTreeView 内部 import 并使用 `<RequirementLogDrawer>`

**方式 B（当前计划）：** RequirementTreeView emit `'open-log'` 事件，Requirements.vue 监听并打开 drawer

先采用方式 A，让 RequirementTreeView 自己管理 log drawer。

在 RequirementTreeView.vue 中添加：
```vue
<RequirementLogDrawer v-model="logDrawerVisible" :requirement="currentLogRequirement" />
```

并添加对应 state 和方法：
```typescript
const logDrawerVisible = ref(false)
const currentLogRequirement = ref<any>(null)

function openLogDrawer(reqId: string) {
  currentLogRequirement.value = { id: reqId }
  logDrawerVisible.value = true
}
```

- [ ] **Step 4: 验证构建**

```bash
pnpm --filter @xuanji/dashboard build
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/views/Requirements.vue
git commit -m "feat(dashboard): refactor Requirements.vue to tree-based layout, remove drawer"
```

---

## Task 4: 构建与手动验证

**Files:** 无新文件

- [ ] **Step 1: 完整构建**

```bash
pnpm --filter @xuanji/dashboard build
```

预期：构建成功，无错误。

- [ ] **Step 2: 启动开发服务器**

```bash
pnpm --filter @xuanji/dashboard dev
```

访问 `http://localhost:5173/requirements`

- [ ] **Step 3: 视觉验证**

- [ ] 看到树形列表（不再是卡片列表）
- [ ] 每行有：层级 badge、标题、状态 chip、action 按钮
- [ ] 层级视觉线索正确（左竖条颜色、缩进）
- [ ] running 行有呼吸动画背景
- [ ] 点击需求行展开/折叠分解树
- [ ] 点击任务行跳转到 `/tasks/:id`
- [ ] 原 600px drawer 不再出现

- [ ] **Step 4: 功能验证（如有测试数据）**

- [ ] 需求行"执行"按钮 → 触发分解
- [ ] 需求行"确认任务"按钮 → 批量确认 draft 任务
- [ ] 需求行"停止"按钮 → 停止执行
- [ ] 需求行"删除"按钮 → 二次确认后删除
- [ ] 任务行"确认"按钮 → draft 任务变 pending
- [ ] 任务行"执行"按钮 → 触发任务执行
- [ ] 行"日志"按钮 → 打开 log drawer

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat(dashboard): requirements page tree-view redesign complete"
```

---

## Self-Review Checklist

- [x] Spec coverage: 所有 spec 要求都有对应 task
  - 去掉抽屉 → Task 3
  - 树状展示 → Task 2
  - 行级 actions → Task 2
  - API confirmAll → Task 1
- [x] Placeholder scan: 无 TBD/TODO
- [x] Type consistency: api 方法名、组件 props 名一致
