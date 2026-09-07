<script setup lang="ts">
// core/web/src/views/AgentConfig.vue —— Agent 列表页
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, type AgentBinding } from '../api/agent-bindings'

const router = useRouter()
const list = ref<AgentBinding[]>([])
const loading = ref(false)

async function loadList() {
  loading.value = true
  try {
    list.value = await api.list()
  } catch {
    ElMessage.error('加载 Agent 绑定列表失败')
  } finally {
    loading.value = false
  }
}

function goToDetail(row: AgentBinding) {
  router.push(`/agents/${row.id}`)
}

function createAgent() {
  router.push('/agents/new')
}

onMounted(loadList)
</script>

<template>
  <div class="agent-config">
    <!-- 工具栏 -->
    <div class="toolbar">
      <span class="title">Agent 配置</span>
      <div class="actions">
        <button class="btn-primary" @click="createAgent">新建 Agent 绑定</button>
        <button class="btn-secondary" @click="loadList">刷新</button>
      </div>
    </div>

    <!-- 列表 -->
    <el-table :data="list" v-loading="loading" @row-click="goToDetail" class="clickable-table">
      <el-table-column label="Agent ID" prop="agent_id" min-width="160">
        <template #default="{ row }">
          <span class="mono">{{ row.agent_id }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Harness" prop="harness" width="140" />
      <el-table-column label="Skill" prop="skill_id" min-width="140" />
      <el-table-column label="Plugin" prop="plugin_id" min-width="120" />
      <el-table-column label="Agent 绑定" min-width="160">
        <template #default="{ row }">
          <span v-if="row.omnigent_agent_id" class="mono">{{ row.omnigent_agent_id.slice(0, 12) }}...</span>
          <span v-else class="muted">未注册</span>
        </template>
      </el-table-column>
      <el-table-column label="Model" prop="model" width="120" />
      <el-table-column label="执行历史" width="100">
        <template #default="{ row }">
          <span class="session-count">{{ row.session_count ?? 0 }} 次</span>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && list.length === 0" description="暂无 Agent 绑定" />
  </div>
</template>

<style scoped>
.agent-config { padding: 16px; min-height: calc(100vh - 120px); }

.toolbar {
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--panel);
  border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 12px;
}
.toolbar .title { font-size: 18px; font-weight: 600; color: var(--text); }
.toolbar .actions { display: flex; gap: 8px; align-items: center; }

.btn-primary {
  padding: 8px 18px; border-radius: 6px;
  background: var(--accent); color: #001016;
  border: none; cursor: pointer; font-size: 14px; font-weight: 500;
}
.btn-primary:hover { opacity: 0.9; }

.btn-secondary {
  padding: 8px 18px; border-radius: 6px;
  background: transparent; color: var(--text);
  border: 1px solid var(--border); cursor: pointer; font-size: 14px;
}
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }

.mono { font-family: var(--font-mono); font-size: 12px; }
.muted { color: var(--muted); font-size: 12px; }
.session-count { font-size: 13px; color: var(--muted); }

.clickable-table :deep(.el-table__row) {
  cursor: pointer;
}

.clickable-table :deep(.el-table__row:hover) {
  background: var(--surface) !important;
}

:deep(.el-table) {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--surface);
}
:deep(.el-table th.el-table__cell) { font-weight: 600; font-size: 12px; color: var(--muted); }
</style>