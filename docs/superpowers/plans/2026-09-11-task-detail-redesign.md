# 任务详情页重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新设计任务详情页，修复 phase_outputs 为空、3/6 阶段完成显示混乱、拆分内容为空三个 bug，并把页面从"状态仪表盘"改造为"工作叙事"布局。

**Architecture:** 后端 `routes/tasks.mts` 补齐 phase_outputs 查询 + breakdown_content 回退 + session_refs 时间字段；前端 `TaskDetail.vue` 重写为三区布局（标题条 + 流程条 + 双列主内容），用 marked + DOMPurify 渲染 markdown。

**Tech Stack:** Vue 3 + TypeScript + Element Plus, Express + Prisma, marked + DOMPurify, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-09-11-task-detail-redesign.md`

## Global Constraints

- 后端代码用 `.mts` 扩展名（ES modules with TypeScript）
- 前端代码用 `.vue` + `.ts`
- 所有新代码必须有单元测试（后端）或手动验证清单（前端）
- 不引入新数据库迁移（phase_outputs 表已存在）
- marked + DOMPurify 合计 ~20KB gzip，可接受
- 响应式：桌面 65/35 双列，平板 ≤1024px 上下堆叠
- 状态色对齐 theme.css：done 绿 / running 青 / failed 红 / paused 黄

---

## File Structure

### Backend

| 文件 | 职责 |
|------|------|
| `packages/core/src/routes/tasks.mts` | 修改：填充 phase_outputs、breakdown_content 回退、session_refs 增加时间字段 |
| `packages/core/src/routes/executions.mts` | 新增：`GET /:id/outputs` 端点（兼容 PhaseTimelineGantt.vue） |
| `packages/core/test/routes/tasks-outputs.test.mts` | 新增：验证 phase_outputs 查询 |
| `packages/core/test/routes/tasks-breakdown-fallback.test.mts` | 新增：验证 breakdown_content 回退 |

### Frontend

| 文件 | 职责 |
|------|------|
| `packages/dashboard/src/api/tasks.ts` | 修改：PhaseOutput 接口增加 `key` 和 `value` 字段；SessionRef 增加 `started_at`/`completed_at` |
| `packages/dashboard/src/views/TaskDetail.vue` | 重写：三区布局 + markdown 渲染 |
| `packages/dashboard/package.json` | 新增依赖：marked + dompurify |

---

## Task 1: 后端填充 phase_outputs

**Files:**
- Modify: `packages/core/src/routes/tasks.mts:85-122`
- Create: `packages/core/test/routes/tasks-outputs.test.mts`

**Interfaces:**
- Consumes: 数据库 `phase_instances` 和 `phase_outputs` 表
- Produces: `GET /api/tasks/:id` 返回 `phase_outputs: PhaseOutput[]` 非空数组

- [ ] **Step 1: Write the failing test**

创建测试文件 `packages/core/test/routes/tasks-outputs.test.mts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'

describe('GET /api/tasks/:id - phase_outputs', () => {
  const testExecutionId = 'test-exec-outputs-' + Date.now()
  const testPhaseId = 'test-phase-' + Date.now()

  beforeAll(async () => {
    // 创建测试 execution
    await db.task_executions.create({
      data: {
        execution_id: testExecutionId,
        subject_type: 'task',
        subject_id: 'test-task',
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
        status: 'completed',
        stage: 'test',
      },
    })
    // 创建测试 phase_instance
    await db.phase_instances.create({
      data: {
        id: testPhaseId,
        execution_id: testExecutionId,
        phase_id: 'write_tests',
        attempt: 1,
        status: 'completed',
        started_at: new Date('2026-09-11T01:00:00Z'),
        completed_at: new Date('2026-09-11T01:10:00Z'),
      },
    })
    // 创建测试 phase_output
    await db.phase_outputs.create({
      data: {
        phase_instance_id: testPhaseId,
        key: 'results',
        value: '## 测试结果\n\n✅ 全部通过',
      },
    })
  })

  afterAll(async () => {
    await db.phase_outputs.deleteMany({
      where: { phase_instance_id: testPhaseId },
    })
    await db.phase_instances.deleteMany({
      where: { id: testPhaseId },
    })
    await db.task_executions.deleteMany({
      where: { execution_id: testExecutionId },
    })
  })

  it('should return phase_outputs for the execution', async () => {
    const phases = await db.phase_instances.findMany({
      where: { execution_id: testExecutionId },
    })
    const outputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
    })

    expect(outputs).toHaveLength(1)
    expect(outputs[0].key).toBe('results')
    expect(outputs[0].value).toContain('## 测试结果')
  })

  it('should join phase_outputs with phase_instances to get node_id', async () => {
    const phases = await db.phase_instances.findMany({
      where: { execution_id: testExecutionId },
    })
    const outputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
    })

    const enriched = outputs.map(o => {
      const pi = phases.find(p => p.id === o.phase_instance_id)
      return {
        node_id: pi?.phase_id,
        iteration: pi?.attempt,
        key: o.key,
        value: o.value,
      }
    })

    expect(enriched[0].node_id).toBe('write_tests')
    expect(enriched[0].iteration).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xuanji/core test test/routes/tasks-outputs.test.mts`
Expected: PASS（测试只验证数据库查询，不涉及路由）

注意：这个测试验证数据库查询逻辑，不涉及路由层。路由层的手动测试在 Task 5 进行。

- [ ] **Step 3: Implement phase_outputs query in route**

修改 `packages/core/src/routes/tasks.mts` 的 `GET /:id` 端点（约 line 85-122）：

```ts
tasksRouter.get('/:id', async (req, res) => {
  try {
    const execution = await db.task_executions.findUnique({
      where: { execution_id: req.params.id },
      include: {
        tasks: {
          select: { id: true, title: true, description: true, acceptance_criteria: true },
        },
      },
    })

    if (!execution) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // 查询 phase_instances
    const phases = await db.phase_instances.findMany({
      where: { execution_id: execution.execution_id },
      orderBy: { started_at: 'asc' },
    })

    // 查询 phase_outputs（新增）
    const phaseOutputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
      orderBy: { created_at: 'asc' },
    })

    // 将 phase_outputs join phase_instances
    const enrichedOutputs = phaseOutputs.map(po => {
      const pi = phases.find(p => p.id === po.phase_instance_id)
      return {
        id: po.id,
        execution_id: execution.execution_id,
        node_id: pi?.phase_id ?? 'unknown',
        iteration: pi?.attempt ?? 1,
        key: po.key,
        value: po.value,
        created_at: po.created_at?.toISOString?.() ?? null,
      }
    })

    const item: any = {
      id: execution.execution_id,
      title: execution.tasks?.title ?? '(无标题)',
      task_id: execution.task_id,
      status: execution.status,
      thread_id: execution.thread_id,
      parent_execution_id: null,
      current_node_id: execution.stage ?? null,
      started_at: execution.started_at?.toISOString?.() ?? null,
      finished_at: execution.completed_at?.toISOString?.() ?? null,
      created_at: execution.created_at?.toISOString?.() ?? null,
      rate_limited_count: execution.rate_limit_count ?? null,
      rate_limited_until: execution.retry_at?.toISOString?.() ?? null,
      breakdown_content: execution.tasks?.description ?? null,
      requirement_id: execution.requirement_id,
      graph_definition_id: execution.graph_definition_id ?? null,
      token_in: null,
      token_out: null,
      cost: null,
      loop_counters: null,
      phase_outputs: enrichedOutputs,  // 改为实际查询结果
      session_refs: phases.map((p: any) => ({
        id: p.id,
        node_id: p.phase_id,
        iteration: p.attempt,
        role: p.agent_used ?? 'unknown',
        omnigent_session_id: p.session_id ?? '',
        omnigent_status: p.status,
        started_at: p.started_at?.toISOString?.() ?? null,
        completed_at: p.completed_at?.toISOString?.() ?? null,
      })),
    }

    res.json(item)
  } catch (err) {
    res.status(500).json({ error: '查询任务失败', detail: (err as Error).message })
  }
})
```

- [ ] **Step 4: Run test to verify implementation**

Run: `pnpm --filter @xuanji/core test test/routes/tasks-outputs.test.mts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/routes/tasks.mts packages/core/test/routes/tasks-outputs.test.mts
git commit -m "feat(tasks): fill phase_outputs from database

- Query phase_outputs table and join with phase_instances
- Return enriched array with node_id, iteration, key, value
- Add started_at/completed_at to session_refs

Fixes P2: Phase 产出物区始终显示'暂无产出物'"
```

---

## Task 2: 后端 breakdown_content 回退逻辑

**Files:**
- Modify: `packages/core/src/routes/tasks.mts:104`
- Create: `packages/core/test/routes/tasks-breakdown-fallback.test.mts`

**Interfaces:**
- Consumes: `tasks.description` 和 `tasks.acceptance_criteria` 字段
- Produces: `breakdown_content` 字段，优先 description，回退到 acceptance_criteria 包装的 JSON

- [ ] **Step 1: Write the failing test**

创建测试文件 `packages/core/test/routes/tasks-breakdown-fallback.test.mts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'

describe('GET /api/tasks/:id - breakdown_content fallback', () => {
  const testTaskId = 'test-task-breakdown-' + Date.now()
  const testExecutionId = 'test-exec-breakdown-' + Date.now()

  beforeAll(async () => {
    // 创建测试 task（description 为 null，acceptance_criteria 有值）
    await db.tasks.create({
      data: {
        id: testTaskId,
        title: '测试任务',
        description: null,
        acceptance_criteria: '提供 /api/test CRUD 接口',
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
      },
    })
    // 创建关联 execution
    await db.task_executions.create({
      data: {
        execution_id: testExecutionId,
        subject_type: 'task',
        subject_id: testTaskId,
        task_id: testTaskId,
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
        status: 'completed',
      },
    })
  })

  afterAll(async () => {
    await db.task_executions.deleteMany({
      where: { execution_id: testExecutionId },
    })
    await db.tasks.deleteMany({
      where: { id: testTaskId },
    })
  })

  it('should fallback to acceptance_criteria when description is null', async () => {
    const execution = await db.task_executions.findUnique({
      where: { execution_id: testExecutionId },
      include: {
        tasks: {
          select: { id: true, title: true, description: true, acceptance_criteria: true },
        },
      },
    })

    // 模拟后端的 breakdown_content 逻辑
    const breakdown_content =
      execution?.tasks?.description
      ?? (execution?.tasks?.acceptance_criteria
          ? JSON.stringify({
              acceptance_criteria: execution.tasks.acceptance_criteria,
              title: execution.tasks?.title,
            })
          : null)

    expect(breakdown_content).not.toBeNull()
    const parsed = JSON.parse(breakdown_content!)
    expect(parsed.acceptance_criteria).toBe('提供 /api/test CRUD 接口')
    expect(parsed.title).toBe('测试任务')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xuanji/core test test/routes/tasks-breakdown-fallback.test.mts`
Expected: PASS（测试只验证逻辑，不涉及路由）

- [ ] **Step 3: Implement fallback logic in route**

修改 `packages/core/src/routes/tasks.mts` 的 `breakdown_content` 字段（约 line 104）：

```ts
// 找到这行：
breakdown_content: execution.tasks?.description ?? null,

// 改为：
const breakdown_content =
  execution.tasks?.description
  ?? (execution.tasks?.acceptance_criteria
      ? JSON.stringify({
          acceptance_criteria: execution.tasks.acceptance_criteria,
          title: execution.tasks?.title,
        })
      : null)
```

并在 `item` 对象中使用 `breakdown_content` 变量：

```ts
const item: any = {
  // ...
  breakdown_content,  // 使用上面计算的变量
  // ...
}
```

同时修改 `include` 子句，确保查询 `acceptance_criteria`：

```ts
include: {
  tasks: {
    select: { id: true, title: true, description: true, acceptance_criteria: true },
  },
},
```

- [ ] **Step 4: Run test to verify implementation**

Run: `pnpm --filter @xuanji/core test test/routes/tasks-breakdown-fallback.test.mts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/routes/tasks.mts packages/core/test/routes/tasks-breakdown-fallback.test.mts
git commit -m "feat(tasks): fallback breakdown_content to acceptance_criteria

When tasks.description is null (directly created tasks), fallback to
acceptance_criteria wrapped as JSON object.

Fixes P3: 拆分内容区始终显示'暂无结构化拆分信息'"
```

---

## Task 3: 后端新增 `/api/executions/:id/outputs` 端点

**Files:**
- Modify: `packages/core/src/routes/executions.mts`
- Create: `packages/core/test/routes/execution-outputs.test.mts`

**Interfaces:**
- Consumes: `phase_instances` 和 `phase_outputs` 表
- Produces: `GET /api/executions/:id/outputs` 返回 `PhaseOutput[]`

**注意**：此端点为 `PhaseTimelineGantt.vue` 组件使用，当前该组件调用此端点但后端未实现。

- [ ] **Step 1: Write the failing test**

创建测试文件 `packages/core/test/routes/execution-outputs.test.mts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'

describe('GET /api/executions/:id/outputs', () => {
  const testExecutionId = 'test-exec-outputs-endpoint-' + Date.now()
  const testPhaseId = 'test-phase-outputs-endpoint-' + Date.now()

  beforeAll(async () => {
    await db.task_executions.create({
      data: {
        execution_id: testExecutionId,
        subject_type: 'task',
        subject_id: 'test-task',
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
        status: 'completed',
      },
    })
    await db.phase_instances.create({
      data: {
        id: testPhaseId,
        execution_id: testExecutionId,
        phase_id: 'develop',
        attempt: 1,
        status: 'completed',
      },
    })
    await db.phase_outputs.create({
      data: {
        phase_instance_id: testPhaseId,
        key: 'results',
        value: '开发完成',
      },
    })
  })

  afterAll(async () => {
    await db.phase_outputs.deleteMany({
      where: { phase_instance_id: testPhaseId },
    })
    await db.phase_instances.deleteMany({
      where: { id: testPhaseId },
    })
    await db.task_executions.deleteMany({
      where: { execution_id: testExecutionId },
    })
  })

  it('should return phase_outputs for the execution', async () => {
    const phases = await db.phase_instances.findMany({
      where: { execution_id: testExecutionId },
    })
    const outputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
      orderBy: { created_at: 'asc' },
    })

    const list = outputs.map(o => {
      const pi = phases.find(p => p.id === o.phase_instance_id)
      return {
        id: o.id,
        node_id: pi?.phase_id,
        iteration: pi?.attempt,
        key: o.key,
        value: o.value,
        created_at: o.created_at,
      }
    })

    expect(list).toHaveLength(1)
    expect(list[0].node_id).toBe('develop')
    expect(list[0].key).toBe('results')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xuanji/core test test/routes/execution-outputs.test.mts`
Expected: PASS（测试只验证数据库查询）

- [ ] **Step 3: Implement the endpoint**

在 `packages/core/src/routes/executions.mts` 末尾添加新端点：

```ts
/**
 * GET /api/executions/:id/outputs
 * 获取执行的所有阶段产出物（供 PhaseTimelineGantt.vue 使用）
 */
executionsRouter.get('/:id/outputs', async (req, res) => {
  try {
    const execution = await db.task_executions.findUnique({
      where: { execution_id: req.params.id },
    })

    if (!execution) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const phases = await db.phase_instances.findMany({
      where: { execution_id: req.params.id },
      orderBy: { started_at: 'asc' },
    })

    const outputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
      orderBy: { created_at: 'asc' },
    })

    const list = outputs.map(o => {
      const pi = phases.find(p => p.id === o.phase_instance_id)
      return {
        id: o.id,
        node_id: pi?.phase_id,
        iteration: pi?.attempt,
        key: o.key,
        value: o.value,
        created_at: pi?.started_at?.toISOString?.() ?? null,
      }
    })

    res.json(list)
  } catch (err) {
    res.status(500).json({ error: '查询产出物失败', detail: (err as Error).message })
  }
})
```

- [ ] **Step 4: Run test to verify implementation**

Run: `pnpm --filter @xuanji/core test test/routes/execution-outputs.test.mts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/routes/executions.mts packages/core/test/routes/execution-outputs.test.mts
git commit -m "feat(executions): add GET /:id/outputs endpoint

Returns phase_outputs joined with phase_instances for PhaseTimelineGantt.vue.

Fixes: PhaseTimelineGantt 组件调用不存在的端点"
```

---

## Task 4: 前端更新 API 类型

**Files:**
- Modify: `packages/dashboard/src/api/tasks.ts:21-42`

**Interfaces:**
- Consumes: 后端 `GET /api/tasks/:id` 返回的新字段
- Produces: TypeScript 类型定义，供 `TaskDetail.vue` 使用

- [ ] **Step 1: Update PhaseOutput interface**

修改 `packages/dashboard/src/api/tasks.ts` 的 `PhaseOutput` 接口（约 line 21-33）：

```ts
export interface PhaseOutput {
  id: number
  execution_id: string
  node_id: string
  iteration: number
  key: string          // 新增
  value: string | null // 新增：markdown 文本
  created_at: string | null
}
```

删除不再使用的字段：`file_changes`、`diff_content`、`pr_url`、`test_result`、`review_result`、`compile_result`。

- [ ] **Step 2: Update SessionRef interface**

修改 `SessionRef` 接口（约 line 35-42）：

```ts
export interface SessionRef {
  id: string
  node_id: string
  iteration: number
  role: string
  omnigent_session_id: string
  omnigent_status: string
  started_at: string | null      // 新增
  completed_at: string | null    // 新增
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/api/tasks.ts
git commit -m "refactor(api): update PhaseOutput and SessionRef types

- PhaseOutput: add key, value fields; remove unused structured fields
- SessionRef: add started_at, completed_at for phase duration calculation"
```

---

## Task 5: 前端安装 marked + DOMPurify

**Files:**
- Modify: `packages/dashboard/package.json`

- [ ] **Step 1: Install dependencies**

Run: `pnpm --filter @xuanji/dashboard add marked dompurify @types/dompurify`

- [ ] **Step 2: Verify installation**

Run: `pnpm --filter @xuanji/dashboard list | grep -E "marked|dompurify"`
Expected: 显示 marked 和 dompurify 版本

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/package.json packages/dashboard/pnpm-lock.yaml
git commit -m "chore(dashboard): add marked + dompurify for markdown rendering

- marked: parse markdown to HTML (~15KB gzip)
- dompurify: sanitize HTML output to prevent XSS (~5KB gzip)"
```

---

## Task 6: 前端重写 TaskDetail.vue 布局

**Files:**
- Modify: `packages/dashboard/src/views/TaskDetail.vue`（整体重写）

**Interfaces:**
- Consumes: `TaskDetail` 类型（来自 Task 4）
- Produces: 新的三区布局页面

**注意**：这是最大的任务，需要整体重写。建议分步骤进行，每步验证。

- [ ] **Step 1: Rewrite Zone A (标题条)**

替换现有的 `top-cards` 双卡结构为单行标题条：

```vue
<template>
  <div class="task-detail" v-loading="loading">
    <!-- 面包屑 -->
    <nav class="breadcrumb">
      <router-link to="/tasks" class="breadcrumb-link">任务</router-link>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ title }}</span>
    </nav>

    <!-- Zone A: 标题条 -->
    <section class="title-bar" v-if="detail">
      <div class="title-bar-main">
        <div class="status-badge" :class="effectiveStatus">
          <span class="status-icon"></span>
          <span class="status-label">{{ statusText(effectiveStatus) }}</span>
        </div>
        <h1 class="task-title">{{ title }}</h1>
        <div class="task-meta">
          <span>开始 {{ formatTime(detail.started_at) }}</span>
          <span class="meta-sep">·</span>
          <span>用时 {{ formatDuration(detail.started_at, detail.finished_at) }}</span>
          <span class="meta-sep">·</span>
          <span class="mono">{{ detail.id.slice(-8) }}</span>
        </div>
      </div>
      <div class="title-bar-actions">
        <button class="btn btn-secondary" @click="goToCanvas">查看画布</button>
        <button class="btn btn-secondary" @click="openRightDrawer('chat')" :disabled="!mainSessionRef">对话</button>
        <button class="btn btn-secondary" @click="openRightDrawer('log')">日志</button>
        <button v-if="effectiveStatus === 'failed'" class="btn btn-primary" @click="retryTask">重试</button>
        <button v-if="effectiveStatus === 'running'" class="btn btn-warning" @click="pauseTask">暂停</button>
        <button v-if="effectiveStatus === 'paused'" class="btn btn-primary" @click="resumeTask">继续</button>
      </div>
    </section>

    <!-- Zone B: 流程条 (next step) -->
    <!-- Zone C: 主内容区 (next step) -->
  </div>
</template>
```

添加对应样式：

```css
.title-bar {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.title-bar-main {
  flex: 1;
}

.task-title {
  font-size: 20px;
  font-weight: 600;
  margin: 8px 0;
  color: var(--text);
}

.task-meta {
  font-size: 13px;
  color: var(--muted);
  display: flex;
  gap: 8px;
  align-items: center;
}

.meta-sep {
  color: var(--faint);
}

.title-bar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Rewrite Zone B (流程条)**

替换现有的 `phaseStatuses` 计算属性和模板：

```vue
<!-- Zone B: 流程条 -->
<section class="phase-flow-card" v-if="detail && phaseStatuses.length">
  <div class="phase-flow">
    <template v-for="(phase, idx) in phaseStatuses" :key="phase.id">
      <div class="phase-node">
        <div class="phase-dot" :class="phase.status">
          <template v-if="phase.status === 'done'">✓</template>
          <template v-else-if="phase.status === 'failed'">✗</template>
          <template v-else-if="phase.status === 'running'">●</template>
        </div>
        <div class="phase-label">{{ phase.label }}</div>
        <div v-if="phase.duration" class="phase-duration">{{ phase.duration }}</div>
      </div>
      <div
        v-if="idx < phaseStatuses.length - 1"
        class="phase-connector"
        :class="{ done: phase.status === 'done' }"
      ></div>
    </template>
  </div>
</section>
```

更新 `phaseStatuses` 计算属性：

```ts
const phaseStatuses = computed<PhaseStatus[]>(() => {
  const d = detail.value
  if (!d) return []

  // 只从 session_refs 生成阶段列表（不展示未执行的阶段）
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

  // 按照 workflow 定义的顺序排序（如果有），否则按 phaseOrder
  const order = workflow.value?.definition_json?.nodes?.map((n: any) => n.id) || phaseOrder

  return order
    .filter(id => statusMap.has(id))  // 只保留有记录的阶段
    .map(id => {
      const info = statusMap.get(id)!
      const duration = info.started_at && info.completed_at
        ? formatDuration(info.started_at, info.completed_at)
        : null
      return {
        id,
        label: phaseLabel(id),
        status: info.status as PhaseStatus['status'],
        iteration: info.iteration,
        duration,
      }
    })
})
```

添加样式：

```css
.phase-flow-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 20px;
  margin-bottom: 16px;
}

.phase-flow {
  display: flex;
  align-items: center;
  gap: 0;
}

.phase-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 80px;
}

.phase-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}

.phase-dot.done {
  background: rgba(34, 197, 94, 0.15);
  color: var(--st-done);
  border: 1px solid var(--st-done);
}

.phase-dot.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--st-failed);
  border: 1px solid var(--st-failed);
}

.phase-dot.running {
  background: rgba(34, 211, 238, 0.15);
  color: var(--st-running);
  border: 1px solid var(--st-running);
  animation: v2-pulse 1.5s ease-in-out infinite;
}

.phase-label {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}

.phase-duration {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
}

.phase-connector {
  flex: 1;
  height: 2px;
  background: var(--border);
  margin: 0 8px;
  margin-bottom: 30px;
}

.phase-connector.done {
  background: var(--st-done);
}
```

- [ ] **Step 3: Rewrite Zone C (主内容区)**

添加 Zone C 的双列布局：

```vue
<!-- Zone C: 主内容区 -->
<div class="main-content-grid" v-if="detail">
  <!-- 左列 -->
  <div class="main-col">
    <!-- 任务要求卡 -->
    <section class="content-card">
      <h2 class="card-title">任务要求</h2>
      <div v-if="!parsedBreakdown" class="empty-state">此任务未提供详细要求</div>
      <div v-else class="breakdown-content">
        <template v-if="parsedBreakdown.kind === 'json'">
          <div v-for="(v, k) in otherBreakdownFields" :key="k" class="breakdown-field">
            <span class="breakdown-field-label">{{ fieldLabel(String(k)) }}</span>
            <pre v-if="typeof v === 'object' && v !== null" class="breakdown-field-value">{{ formatFieldValue(v) }}</pre>
            <p v-else class="breakdown-field-text">{{ formatFieldValue(v) }}</p>
          </div>
          <p v-if="!Object.keys(otherBreakdownFields).length" class="empty-state">无其他拆分字段</p>
        </template>
        <pre v-else class="breakdown-raw">{{ parsedBreakdown.text }}</pre>
      </div>
    </section>

    <!-- 阶段结果卡 -->
    <section v-if="detail.phase_outputs.length" class="content-card">
      <h2 class="card-title">阶段结果</h2>
      <div v-for="po in detail.phase_outputs" :key="po.id" class="phase-result">
        <div class="phase-result-header">
          <span class="phase-result-title">{{ phaseLabel(po.node_id) }}</span>
          <span class="phase-result-time">{{ formatTime(po.created_at) }}</span>
        </div>
        <div class="phase-result-body" v-html="renderMarkdown(po.value || '')"></div>
      </div>
    </section>
    <section v-else class="content-card">
      <h2 class="card-title">阶段结果</h2>
      <div class="empty-state">此任务无阶段产出记录</div>
    </section>
  </div>

  <!-- 右列 -->
  <div class="side-col">
    <!-- 元信息卡 -->
    <section class="content-card">
      <h2 class="card-title">元信息</h2>
      <div class="meta-list">
        <div class="meta-row">
          <span class="meta-label">执行 ID</span>
          <span class="meta-value mono">{{ detail.id }}</span>
        </div>
        <div v-if="detail.requirement_id" class="meta-row">
          <span class="meta-label">需求 ID</span>
          <span class="meta-value mono">{{ detail.requirement_id.slice(0, 8) }}...</span>
        </div>
        <div v-if="detail.rate_limited_count" class="meta-row">
          <span class="meta-label">限流次数</span>
          <span class="meta-value">{{ detail.rate_limited_count }}</span>
        </div>
      </div>
    </section>

    <!-- 产出物索引卡 -->
    <section v-if="detail.phase_outputs.length" class="content-card">
      <h2 class="card-title">产出物索引</h2>
      <div class="output-index">
        <div v-for="po in detail.phase_outputs" :key="po.id" class="output-index-item">
          <span class="output-index-label">{{ phaseLabel(po.node_id) }}</span>
          <span class="output-index-time">{{ formatTime(po.created_at) }}</span>
        </div>
      </div>
    </section>
  </div>
</div>
```

添加样式：

```css
.main-content-grid {
  display: grid;
  grid-template-columns: 65% 35%;
  gap: 16px;
}

@media (max-width: 1024px) {
  .main-content-grid {
    grid-template-columns: 1fr;
  }
}

.content-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
}

.phase-result {
  background: var(--surface);
  border-left: 3px solid var(--ai);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  margin-bottom: 12px;
}

.phase-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.phase-result-title {
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
  color: var(--ai);
}

.phase-result-time {
  font-size: 12px;
  color: var(--faint);
}

.phase-result-body {
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}

.phase-result-body :deep(h1),
.phase-result-body :deep(h2),
.phase-result-body :deep(h3) {
  margin: 12px 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.phase-result-body :deep(ul),
.phase-result-body :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.phase-result-body :deep(code) {
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.meta-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.meta-label {
  color: var(--muted);
}

.meta-value {
  color: var(--text);
  text-align: right;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.output-index {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.output-index-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding: 6px 8px;
  background: var(--surface);
  border-radius: var(--radius-sm);
}

.output-index-label {
  color: var(--text);
}

.output-index-time {
  color: var(--faint);
  font-family: var(--font-mono);
}
```

- [ ] **Step 4: Add markdown rendering function**

在 `<script setup>` 中添加：

```ts
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({
  breaks: true,
  gfm: true,
})

function renderMarkdown(md: string): string {
  if (!md) return ''
  const html = marked.parse(md) as string
  return DOMPurify.sanitize(html)
}
```

- [ ] **Step 5: Verify manually in browser**

打开 `http://localhost:5173/tasks/728fbb58-bd42-4492-9424-38500eaa4532` 验证：

- [ ] 标题条正确显示状态、标题、时间
- [ ] 流程条只显示 3 个已执行阶段，每个带耗时
- [ ] 任务要求区显示验收标准
- [ ] 阶段结果区展示 3 条 markdown 内容
- [ ] 右侧元信息卡显示 Token/会话 ID 等

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/views/TaskDetail.vue packages/dashboard/package.json
git commit -m "feat(dashboard): redesign TaskDetail page

- Zone A: Single title bar (status + title + time + actions)
- Zone B: Phase flow showing only executed phases with durations
- Zone C: Two-column layout (task requirements + phase results | metadata)
- Render phase_outputs as markdown using marked + DOMPurify
- Fallback breakdown_content to acceptance_criteria

Fixes P1, P4, P5 from spec"
```

---

## Task 7: 手动测试与视觉验证

**Files:** 无（纯验证任务）

- [ ] **Step 1: Test with existing execution**

打开 `http://localhost:5173/tasks/728fbb58-bd42-4492-9424-38500eaa4532`

验证清单：
- [ ] 标题条显示"✓ 已完成" + "实现图书分类后端API" + "开始 09:16" + "用时 48m"
- [ ] 流程条显示 3 个节点：write_tests ✓、develop ✓、test ✓，每个带耗时
- [ ] 流程条不显示 code_review、code_fix、final_review
- [ ] 任务要求区显示"提供 /library/category 的 CRUD 接口..."
- [ ] 阶段结果区展示 3 条 markdown，内容可读
- [ ] 右侧元信息卡显示执行 ID
- [ ] 点击"查看画布"跳转到画布页
- [ ] 点击"日志"打开日志抽屉

- [ ] **Step 2: Test edge case - pending task**

创建一个新任务（不执行），验证：
- [ ] 标题条显示"待执行"
- [ ] 流程条不显示
- [ ] 阶段结果区显示"此任务无阶段产出记录"

- [ ] **Step 3: Test responsive layout**

调整浏览器窗口宽度到 1024px 以下，验证：
- [ ] 双列布局变为上下堆叠
- [ ] 内容仍然可读

- [ ] **Step 4: Take screenshot for visual regression**

Run: `screencapture -w /tmp/task-detail-after-redesign.png`

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(dashboard): address visual issues from manual testing

[describe any fixes made]"
```

---

## Summary

| Task | 产出 | 依赖 |
|------|------|------|
| 1 | 后端填充 phase_outputs | 无 |
| 2 | 后端 breakdown_content 回退 | 无 |
| 3 | 后端 /outputs 端点 | 无 |
| 4 | 前端 API 类型更新 | 无 |
| 5 | 安装 marked + DOMPurify | 无 |
| 6 | 前端重写布局 | 1, 2, 4, 5 |
| 7 | 手动测试 | 6 |

**并行机会**：Task 1, 2, 3, 4, 5 可以并行；Task 6 依赖 1, 2, 4, 5；Task 7 依赖 6。

## Spec 覆盖验证

| Spec 问题 | Plan 任务 | 修复方式 |
|-----------|-----------|---------|
| P1: 3/6 阶段显示冲突 | Task 6 Zone B | `phaseStatuses` 只渲染 `session_refs` 中有的阶段，去掉 N/M 分数 |
| P2: phase_outputs 为空 | Task 1 + Task 6 | 后端查询 phase_outputs 表；前端渲染 markdown |
| P3: breakdown_content 为空 | Task 2 + Task 6 | 后端回退到 acceptance_criteria；前端已有渲染逻辑 |
| P4: 双卡并列浪费空间 | Task 6 Zone A | 合并为单行标题条 |
| P5: AI 工作藏抽屉 | Task 6 Zone C | 阶段结果直接展示在主内容区 |
| P6: stage 字段未更新 | Task 6 Zone A | **隐式修复**：新 UI 不再显示 `current_node_id`，改为显示时间/ID |
