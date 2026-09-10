# 璇玑 V4 前端阶段动态化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让前端阶段列表从工作流定义动态读取，解决阶段列表硬编码问题。

**Architecture:** YAML 节点增加 `name` 字段 → 前端从 graph_definitions 读取节点列表 → 根据执行状态标记节点状态。

**Tech Stack:** TypeScript, Prisma, Vue 3

**Spec:** `docs/superpowers/specs/2026-09-09-xuanji-architectural-issues.md` 第八章

## Global Constraints

- 语言：中文
- 类型定义：`packages/core/src/graph/types.mts`
- 前端类型：`packages/dashboard/src/api/tasks.ts`

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `packages/core/src/graph/types.mts` | WorkflowNode 增加 name 字段 | 修改 |
| `packages/core/src/graph/yaml-loader.mts` | 验证 name 字段（可选） | 修改 |
| `packages/core/src/routes/tasks.mts` | API 返回 graphDefinitionId | 修改 |
| `packages/dashboard/src/api/tasks.ts` | 类型定义增加字段 | 修改 |
| `packages/dashboard/src/views/TaskDetail.vue` | 动态读取阶段 | 修改 |
| `packages/core/workflows/*.yaml` | 节点添加 name 字段 | 修改 |

---

### Task 1: 类型定义增加 name 字段

**Files:**
- Modify: `packages/core/src/graph/types.mts`

**Interfaces:**
- Produces: `WorkflowNode.name?: string` 可选字段

- [ ] **Step 1: 修改 WorkflowNode 接口**

在 `packages/core/src/graph/types.mts` 中找到 `WorkflowNode` 接口，添加 `name` 字段：

```typescript
export interface WorkflowNode {
  id: string
  type: NodeType
  name?: string             // 新增：节点显示名称（中文标签）
  agent_binding_id?: string
  agent_binding_ids?: string[]
  // ... 其他字段保持不变
}
```

- [ ] **Step 2: 修改 GraphNode 接口**

同样在 `GraphNode` 接口中添加：

```typescript
export interface GraphNode {
  id: string
  type: NodeType
  name?: string             // 新增：节点显示名称
  // ... 其他字段保持不变
}
```

- [ ] **Step 3: 验证类型**

```bash
cd packages/core && pnpm build
```

预期：无类型错误。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/graph/types.mts
git commit -m "feat: WorkflowNode/GraphNode 增加 name 字段"
```

---

### Task 2: YAML Loader 支持 name 字段

**Files:**
- Modify: `packages/core/src/graph/yaml-loader.mts`

**Interfaces:**
- Produces: `mapYamlToGraphDef` 正确映射 `name` 字段

- [ ] **Step 1: 修改 mapYamlToGraphDef**

在 `packages/core/src/graph/yaml-loader.mts` 的 `mapYamlToGraphDef` 函数中，确保 `name` 字段被映射：

```typescript
const nodes: GraphNode[] = def.nodes.map((wn: WorkflowNode): GraphNode => {
  const gn: GraphNode = {
    id: wn.id,
    type: wn.type,
    name: wn.name,  // 新增：映射 name 字段
  }

  // ... 其他字段映射保持不变
  return gn
})
```

- [ ] **Step 2: 运行构建**

```bash
cd packages/core && pnpm build
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/graph/yaml-loader.mts
git commit -m "feat: yaml-loader 映射节点 name 字段"
```

---

### Task 3: Tasks API 返回 graphDefinitionId

**Files:**
- Modify: `packages/core/src/routes/tasks.mts`
- Modify: `packages/dashboard/src/api/tasks.ts`

**Interfaces:**
- Produces: `TaskDetail.graph_definition_id` 字段

- [ ] **Step 1: 修改后端 API**

在 `packages/core/src/routes/tasks.mts` 的 GET `/:id` 路由中，确保 `graphDefinitionId` 被返回：

```typescript
const item: any = {
  id: execution.executionId,
  // ... 现有字段
  graph_definition_id: execution.graphDefinitionId,  // 新增
  // ...
};
```

检查 `findUnique` 的 `select` 是否包含此字段：

```typescript
const execution = await db.taskExecution.findUnique({
  where: { executionId: req.params.id },
  select: {
    // ... 现有字段
    graphDefinitionId: true,  // 确保选中
  },
});
```

- [ ] **Step 2: 修改前端类型**

在 `packages/dashboard/src/api/tasks.ts` 的 `TaskDetail` 接口中添加：

```typescript
export interface TaskDetail {
  id: string
  title: string
  // ... 现有字段
  graph_definition_id: string | null  // 新增
  // ...
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/routes/tasks.mts packages/dashboard/src/api/tasks.ts
git commit -m "feat: TaskDetail API 返回 graph_definition_id"
```

---

### Task 4: 前端动态读取阶段列表

**Files:**
- Modify: `packages/dashboard/src/views/TaskDetail.vue`

**Interfaces:**
- Consumes: `graph_definition_id` 从 TaskDetail 获取
- Produces: 动态的阶段列表和状态

- [ ] **Step 1: 添加工作流 API 调用**

在 TaskDetail.vue 的 script 部分，添加获取工作流定义的逻辑：

```typescript
// 添加 imports
import { ref, computed, watch } from 'vue'

// 添加状态
const workflow = ref<any>(null)

// 添加获取工作流的函数
async function loadWorkflow() {
  if (!detail.value?.graph_definition_id) {
    workflow.value = null
    return
  }
  try {
    const res = await fetch(`/api/graph-definitions/${detail.value.graph_definition_id}`)
    workflow.value = await res.json()
  } catch (e) {
    console.warn('[TaskDetail] 加载工作流失败:', e)
    workflow.value = null
  }
}

// 在 loadData 后调用
watch(taskId, () => {
  loadData().then(() => {
    loadWorkflow()
  })
})
```

- [ ] **Step 2: 修改 phaseStatuses 计算属性**

```typescript
const phaseStatuses = computed<PhaseStatus[]>(() => {
  const d = detail.value
  if (!d) return []

  // 从工作流定义获取阶段列表
  const workflowNodes = workflow.value?.definition_json?.nodes || []
  if (workflowNodes.length === 0) {
    // 回退到硬编码（兼容旧数据）
    return phaseOrder.map(id => ({ id, label: phaseLabel(id), status: 'pending' as const, iteration: 0 }))
  }

  // 构建状态映射
  const statusMap = new Map<string, string>()
  for (const po of d.phase_outputs) {
    statusMap.set(po.node_id, 'completed')
  }

  // 当前节点
  const currentNode = d.current_node_id

  // 从工作流节点生成阶段列表
  return workflowNodes.map((n: any) => ({
    id: n.id,
    label: n.name || n.id,  // 使用 name，无则回退 id
    status: statusMap.get(n.id)
      || (n.id === currentNode ? 'running' : 'pending'),
    iteration: 0,
  }))
})
```

- [ ] **Step 3: 移除硬编码的 phaseOrder**

保留 `phaseOrder` 和 `phaseLabel` 作为兼容旧数据的回退，但主逻辑使用工作流定义。

- [ ] **Step 4: 验证前端构建**

```bash
cd packages/dashboard && pnpm build
```

预期：无构建错误。

- [ ] **Step 5: 提交**

```bash
git add packages/dashboard/src/views/TaskDetail.vue
git commit -m "feat: TaskDetail 从工作流定义动态读取阶段列表"
```

---

### Task 5: 为现有工作流添加节点 name

**Files:**
- Modify: `packages/core/workflows/default-dev-flow.yaml`
- Modify: `packages/core/workflows/ruoyi-dev-flow.yaml` (已创建)

- [ ] **Step 1: 修改 default-dev-flow.yaml**

为每个节点添加 `name` 字段：

```yaml
nodes:
  - id: develop
    type: agent
    name: 开发
    agent_binding_ids: [backend-crud, backend-module-enhancement, frontend-crud-page]
    selector:
      by: task_type
    write_key: results

  - id: quality_review
    type: agent
    name: 质量审查
    agent_binding_ids: [reviewer]
    write_key: results

  - id: security_review
    type: agent
    name: 安全审查
    agent_binding_ids: [reviewer]
    write_key: results

  - id: final_review
    type: gate
    name: 最终审查
```

- [ ] **Step 2: 验证 YAML 格式**

```bash
cd packages/core && node -e "const yaml = require('yaml'); const fs = require('fs'); yaml.parse(fs.readFileSync('workflows/default-dev-flow.yaml', 'utf8')); console.log('OK')"
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/workflows/*.yaml
git commit -m "feat: 工作流节点添加 name 字段"
```

---

### Task 6: 端到端测试

**验证点**：
1. 工作流节点有 name 字段
2. API 返回 graph_definition_id
3. 前端显示正确的阶段列表

- [ ] **Step 1: 验证工作流 API**

```bash
curl http://localhost:3000/api/graph-definitions/default-dev-flow | jq '.definition_json.nodes[] | {id, name}'
```

预期：每个节点都有 `name` 字段。

- [ ] **Step 2: 验证 TaskDetail API**

创建一个执行实例后：

```bash
curl http://localhost:3000/api/tasks/{execution_id} | jq '.graph_definition_id'
```

预期：返回工作流 ID。

- [ ] **Step 3: 前端验证**

打开 TaskDetail 页面，确认：
- 阶段列表与工作流定义一致
- 进度显示正确（如 "1/4 阶段完成"）

---

## 完成标准

- [ ] WorkflowNode/GraphNode 有 name 字段
- [ ] yaml-loader 正确映射 name 字段
- [ ] TaskDetail API 返回 graph_definition_id
- [ ] TaskDetail.vue 动态读取阶段列表
- [ ] 现有工作流 YAML 有 name 字段
- [ ] 端到端测试通过