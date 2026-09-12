<script setup lang="ts">
// core/web/src/views/WorkflowList.vue —— 工作流列表页
// 显示预设和用户工作流，支持查看和跳转到画布
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

interface WorkflowNode {
  id: string
  type: string
  agent_binding_id?: string
  agent_binding_ids?: string[]
}

interface WorkflowEdge {
  from: string
  to: string
  condition?: { keyword?: string; function?: string }
  loop_max?: number
}

interface Workflow {
  id: string
  name: string
  description?: string
  version: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  start: string[]
  end: string[]
  type?: 'preset' | 'user'
}

const presets = ref<Workflow[]>([])
const userWorkflows = ref<Workflow[]>([])
const loading = ref(false)
const activeTab = ref('presets')
const router = useRouter()

async function loadWorkflows() {
  loading.value = true
  try {
    const res = await fetch('/api/workflows')
    const data = await res.json()
    presets.value = (data.presets || []).map((w: Workflow) => ({ ...w, type: 'preset' }))
    userWorkflows.value = (data.user || []).map((w: Workflow) => ({ ...w, type: 'user' }))
  } catch {
    ElMessage.error('加载工作流列表失败')
  } finally {
    loading.value = false
  }
}

function openInCanvas(workflow: Workflow) {
  router.push({ path: '/canvas', query: { workflow_id: workflow.id } })
}

async function removeWorkflow(workflow: Workflow) {
  try {
    await ElMessageBox.confirm(
      `确定删除工作流「${workflow.name}」(${workflow.id})？此操作不可恢复。`,
      '删除确认',
      { type: 'warning' }
    )
  } catch {
    return
  }

  try {
    const res = await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '删除失败')
    }
    ElMessage.success('已删除')
    loadWorkflows()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  }
}

function getNodeTypes(nodes: WorkflowNode[]): string {
  const types = new Set(nodes.map(n => n.type))
  return Array.from(types).join(', ')
}

function getEdgeCount(edges: WorkflowEdge[]): number {
  return edges.length
}

onMounted(loadWorkflows)
</script>

<template>
  <div class="workflow-list">
    <!-- 工具栏 -->
    <div class="toolbar">
      <span class="title">工作流列表</span>
      <div class="actions">
        <button class="btn-secondary" @click="loadWorkflows">刷新</button>
      </div>
    </div>

    <!-- 标签页 -->
    <el-tabs v-model="activeTab" class="tabs">
      <el-tab-pane label="预设工作流" name="presets">
        <el-table :data="presets" v-loading="loading">
          <el-table-column label="ID" prop="id" min-width="180" />
          <el-table-column label="名称" prop="name" min-width="160" />
          <el-table-column label="描述" prop="description" min-width="200" show-overflow-tooltip />
          <el-table-column label="节点数" width="80">
            <template #default="{ row }">
              <span class="count">{{ row.nodes?.length || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="边数" width="80">
            <template #default="{ row }">
              <span class="count">{{ getEdgeCount(row.edges) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="节点类型" min-width="140">
            <template #default="{ row }">
              <span class="node-types">{{ getNodeTypes(row.nodes) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" type="primary" @click="openInCanvas(row)">打开画布</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && presets.length === 0" description="暂无预设工作流" />
      </el-tab-pane>

      <el-tab-pane label="用户工作流" name="user">
        <el-table :data="userWorkflows" v-loading="loading">
          <el-table-column label="ID" prop="id" min-width="180" />
          <el-table-column label="名称" prop="name" min-width="160" />
          <el-table-column label="描述" prop="description" min-width="200" show-overflow-tooltip />
          <el-table-column label="节点数" width="80">
            <template #default="{ row }">
              <span class="count">{{ row.nodes?.length || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="边数" width="80">
            <template #default="{ row }">
              <span class="count">{{ getEdgeCount(row.edges) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" type="primary" @click="openInCanvas(row)">打开画布</el-button>
              <el-button link size="small" type="danger" @click="removeWorkflow(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && userWorkflows.length === 0" description="暂无用户工作流" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.workflow-list { padding: 20px; min-height: calc(100vh - 120px); }

.toolbar {
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--panel);
  border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 12px;
}
.toolbar .title { font-size: 18px; font-weight: 600; font-family: var(--font-ui); color: var(--text); }
.toolbar .actions { display: flex; gap: 8px; align-items: center; }

.btn-secondary {
  padding: 8px 18px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
  cursor: pointer; font-size: 14px;
}
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }

.tabs { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; }

.count {
  display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm);
  background: var(--surface); font-size: 13px; font-weight: 500;
  font-family: var(--font-mono);
}

.node-types {
  font-size: 12px; color: var(--muted);
}

:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--surface);
}
:deep(.el-table th.el-table__cell) { font-weight: 600; font-size: 12px; color: var(--muted); }
</style>