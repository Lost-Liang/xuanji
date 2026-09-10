<script setup lang="ts">
// views/Requirements.vue —— 需求列表页（V4 树形布局）
// 顶部：创建框 + 概览统计 + 搜索工具栏
// 主体：RequirementTreeView（全宽树 + 行操作，内部管理日志抽屉）
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { api, type RequirementListItem, type CreateRequirement } from '../api/requirements'
import { api as projectApi, type Project } from '../api/projects'
import RequirementTreeView from '../components/RequirementTreeView.vue'

const list = ref<RequirementListItem[]>([])
const loading = ref(false)
const newInput = ref('')
const creating = ref(false)
const searchText = ref('')

// 项目选择
const projects = ref<Project[]>([])
const selectedProjectId = ref<string>('')
const customPath = ref('')

// 计算实际使用的路径
const targetRepoPath = computed(() => {
  if (selectedProjectId.value) {
    const p = projects.value.find(x => x.id === selectedProjectId.value)
    return p?.path || ''
  }
  return customPath.value.trim()
})

// 工作流选择
const workflows = ref<{ id: string; name: string }[]>([])
const selectedWorkflowId = ref('requirement-decomposition')

// 聚合状态
function aggStatus(item: RequirementListItem) {
  return item.execution_status || item.status
}

// 汇总统计
const summary = computed(() => {
  const total = list.value.length
  const running = list.value.filter(r => aggStatus(r) === 'running').length
  const paused = list.value.filter(r => aggStatus(r) === 'paused').length
  const completed = list.value.filter(r => aggStatus(r) === 'completed').length
  const failed = list.value.filter(r => aggStatus(r) === 'failed').length
  return { total, running, paused, completed, failed }
})

// 过滤列表
const filteredList = computed(() => {
  if (!searchText.value) return list.value
  const kw = searchText.value.toLowerCase()
  return list.value.filter(r =>
    r.id.toLowerCase().includes(kw) ||
    r.input_text?.toLowerCase().includes(kw)
  )
})

async function loadList() {
  loading.value = true
  try {
    list.value = await api.list()
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// 加载工作流列表
async function loadWorkflows() {
  try {
    const r = await fetch('/api/workflows')
    const data = await r.json()
    // 合并 presets 和 user workflows
    workflows.value = [
      ...(data.presets || []).map((w: any) => ({ id: w.id, name: w.name || w.id })),
      ...(data.user || []).map((w: any) => ({ id: w.id, name: w.name || w.id })),
    ]
  } catch (e: any) {
    console.error('加载工作流失败:', e)
  }
}

// 加载项目列表
async function loadProjects() {
  try {
    projects.value = await projectApi.list()
  } catch (e: any) {
    console.error('加载项目列表失败:', e)
  }
}

// 创建需求
async function createAndExecute() {
  const text = newInput.value.trim()
  if (!text) return
  creating.value = true
  try {
    const reqId = `req-${Date.now()}`
    const payload: CreateRequirement = {
      id: reqId,
      input_text: text,
      workflow_id: selectedWorkflowId.value,
      targetRepoPath: targetRepoPath.value || undefined,
    }
    const cr = await fetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!cr.ok) {
      const e = await cr.json()
      ElMessage.error(e.error || '创建失败')
      return
    }
    await api.execute(reqId, text)
    newInput.value = ''
    selectedProjectId.value = ''
    customPath.value = ''
    ElMessage.success('已创建并执行')
    loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    creating.value = false
  }
}

onMounted(() => { loadList(); loadWorkflows(); loadProjects() })
</script>

<template>
  <div class="requirements-page">
    <!-- 创建区 -->
    <div class="create-section">
      <div class="create-box">
        <div class="create-header">
          <select v-model="selectedWorkflowId" class="workflow-select" :disabled="creating">
            <option v-for="wf in workflows" :key="wf.id" :value="wf.id">{{ wf.name }}</option>
          </select>
        </div>
        <textarea
          v-model="newInput"
          class="create-input"
          placeholder="一句话描述需求，回车创建并执行..."
          @keyup.ctrl.enter="createAndExecute"
          :disabled="creating"
          rows="2"
        ></textarea>
        <div class="workdir-input-row">
          <select v-model="selectedProjectId" class="project-select" :disabled="creating">
            <option value="">选择项目（可选）</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <span class="input-separator">或</span>
          <input
            v-model="customPath"
            type="text"
            class="workdir-input"
            placeholder="手动输入路径"
            :disabled="creating || !!selectedProjectId"
          />
        </div>
        <div class="create-footer">
          <button class="create-btn" :disabled="!newInput.trim()" @click="createAndExecute">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            创建并执行
          </button>
        </div>
      </div>
    </div>

    <!-- 概览统计 -->
    <div class="dashboard" v-if="list.length">
      <div class="stat-card total">
        <span class="stat-value">{{ summary.total }}</span>
        <span class="stat-label">总数</span>
      </div>
      <div class="stat-card running" v-if="summary.running">
        <span class="stat-value">{{ summary.running }}</span>
        <span class="stat-label">执行中</span>
      </div>
      <div class="stat-card paused" v-if="summary.paused">
        <span class="stat-value">{{ summary.paused }}</span>
        <span class="stat-label">暂停</span>
      </div>
      <div class="stat-card completed" v-if="summary.completed">
        <span class="stat-value">{{ summary.completed }}</span>
        <span class="stat-label">已完成</span>
      </div>
      <div class="stat-card failed" v-if="summary.failed">
        <span class="stat-value">{{ summary.failed }}</span>
        <span class="stat-label">失败</span>
      </div>
    </div>

    <!-- 搜索和操作栏 -->
    <div class="toolbar">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          v-model="searchText"
          type="text"
          class="search-input"
          placeholder="搜索需求..."
        />
      </div>
      <button class="btn-refresh" @click="loadList">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        刷新
      </button>
    </div>

    <!-- 需求树形视图（全宽树 + 行操作，内部管理日志抽屉） -->
    <RequirementTreeView :requirements="filteredList" @refresh="loadList" />
  </div>
</template>

<style scoped>
.requirements-page {
  padding: 16px;
  min-height: calc(100vh - 120px);
  max-width: 1000px;
  margin: 0 auto;
}

/* ========== 创建区 ========== */
.create-section {
  margin-bottom: 16px;
}

.create-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.create-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workflow-select {
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.workflow-select:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.create-footer {
  display: flex;
  justify-content: flex-end;
}

.create-input {
  flex: 1;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  resize: none;
  transition: border-color 0.16s;
}

.create-input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.workdir-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.project-select {
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  min-width: 180px;
}

.project-select:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.project-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.input-separator {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}

.workdir-input {
  flex: 1;
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-mono);
  transition: border-color 0.16s;
}

.workdir-input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.workdir-input::placeholder {
  color: var(--muted);
  font-family: var(--font-sans);
}

.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 20px;
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: #001016;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s;
  white-space: nowrap;
}

.create-btn:hover:not(:disabled) {
  background: #06B6D4;
  border-color: #06B6D4;
}

.create-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ========== 概览统计 ========== */
.dashboard {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 20px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 70px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-mono);
  line-height: 1;
}

.stat-label {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-card.running {
  border-color: rgba(34, 211, 238, 0.3);
  background: rgba(34, 211, 238, 0.08);
}
.stat-card.running .stat-value { color: var(--st-running); }

.stat-card.paused {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.08);
}
.stat-card.paused .stat-value { color: var(--st-paused); }

.stat-card.completed {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.08);
}
.stat-card.completed .stat-value { color: var(--st-done); }

.stat-card.failed {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
}
.stat-card.failed .stat-value { color: var(--st-failed); }

/* ========== 工具栏 ========== */
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.search-box {
  position: relative;
  flex: 1;
  max-width: 320px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--faint);
}

.search-input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.btn-refresh:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .create-box {
    flex-direction: column;
  }
  .create-btn {
    width: 100%;
    justify-content: center;
  }
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .search-box {
    max-width: none;
  }
}
</style>
