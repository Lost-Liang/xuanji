<script setup lang="ts">
// core/web/src/views/Requirements.vue —— 需求列表页（V3 重构）
// 卡片列表替代表格 + 概览统计 + 详情抽屉分层
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type RequirementListItem, type RequirementDetail, type CreateRequirement } from '../api/requirements'
import { api as projectApi, type Project } from '../api/projects'
import RequirementLogDrawer from '../components/drawers/RequirementLogDrawer.vue'
import RequirementTreeView from '../components/RequirementTreeView.vue'

const router = useRouter()

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

// 详情抽屉
const drawerVisible = ref(false)
const detail = ref<RequirementDetail | null>(null)
const detailLoading = ref(false)
const logDrawerVisible = ref(false)

// 状态映射
function statusTagType(status: string | null): '' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'running': return 'warning'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    case 'cancelled':
    case 'stopped': return 'info'
    case 'paused': return 'info'
    default: return 'info'
  }
}

function statusText(status: string | null): string {
  const map: Record<string, string> = {
    pending: '待执行', running: '执行中', completed: '已完成',
    failed: '失败', stopped: '已停止', cancelled: '已取消',
    paused: '已暂停', planned: '待执行',
  }
  return map[status || ''] || '待执行'
}

// 聚合状态
function aggStatus(item: RequirementListItem) {
  return item.execution_status || item.status
}

function formatTime(ts: string): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
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

// 打开详情
async function openDetail(item: RequirementListItem) {
  drawerVisible.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await api.get(item.id)
  } catch (e: any) {
    ElMessage.error(e?.message || '加载详情失败')
  } finally {
    detailLoading.value = false
  }
}

// 停止执行
async function stopRequirement() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm('确定停止该需求的执行吗？此操作不可恢复。', '停止确认', { type: 'warning' })
  } catch { return }
  try {
    await api.stop(detail.value.id)
    ElMessage.success('已停止')
    detail.value = await api.get(detail.value.id)
    loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '停止失败')
  }
}

// Review gate 决策
async function gateDecision(decision: 'approve' | 'reject') {
  if (!detail.value?.execution_id) {
    ElMessage.warning('无关联执行，无法操作 gate')
    return
  }
  let comments: string | undefined
  if (decision === 'reject') {
    try {
      const { value } = await ElMessageBox.prompt('请输入驳回意见（将带回上游节点重做）', '驳回', {
        confirmButtonText: '驳回', cancelButtonText: '取消', inputType: 'textarea', inputPlaceholder: '驳回意见...',
      })
      comments = value?.trim()
      if (!comments) { ElMessage.warning('驳回需填写意见'); return }
    } catch { return }
  }
  try {
    await api.gate(detail.value.execution_id, decision, comments)
    ElMessage.success(decision === 'approve' ? '已通过' : '已驳回')
    detail.value = await api.get(detail.value.id)
    loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || 'gate 操作失败')
  }
}

function openLog() {
  logDrawerVisible.value = true
}

function goToCanvas() {
  if (!detail.value?.execution_id) return
  router.push({ path: '/canvas', query: { execution_id: detail.value.execution_id } })
}

const hasSpec = computed(() => !!detail.value?.spec_content)

// 删除需求
async function deleteRequirement(item: RequirementListItem, event?: Event) {
  event?.stopPropagation()
  const status = aggStatus(item)
  if (status === 'running') {
    ElMessage.warning('需求正在执行中，请先停止后再删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确定删除该需求吗？关联的任务和执行记录将被标记为已删除。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }

  try {
    const res = await api.delete(item.id)
    if (res.ok) {
      ElMessage.success('已删除')
      loadList()
    } else {
      ElMessage.error(res.error || '删除失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

// 详情抽屉中删除
async function deleteFromDetail() {
  if (!detail.value) return
  if (detail.value.execution?.status === 'running') {
    ElMessage.warning('需求正在执行中，请先停止后再删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确定删除该需求吗？关联的任务和执行记录将被标记为已删除。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }

  try {
    const res = await api.delete(detail.value.id)
    if (res.ok) {
      ElMessage.success('已删除')
      drawerVisible.value = false
      loadList()
    } else {
      ElMessage.error(res.error || '删除失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
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
          <button class="create-btn" :loading="creating" :disabled="!newInput.trim()" @click="createAndExecute">
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

    <!-- 需求卡片列表 -->
    <div class="requirement-list" v-loading="loading">
      <div v-if="!filteredList.length && !loading" class="empty-state">
        <p>暂无需求</p>
        <p class="hint">在上方输入框中描述需求，创建并执行</p>
      </div>

      <article
        v-for="item in filteredList"
        :key="item.id"
        class="requirement-card"
        :class="aggStatus(item)"
        @click="openDetail(item)"
      >
        <div class="card-header">
          <div class="status-badge" :class="aggStatus(item)">
            <span class="status-icon"></span>
            <span class="status-text">{{ statusText(aggStatus(item)) }}</span>
          </div>
          <span class="card-id">{{ item.id.slice(-12) }}</span>
        </div>

        <p class="card-content">{{ item.input_text }}</p>

        <div class="card-footer">
          <span class="card-time">{{ formatTime(item.created_at) }}</span>
          <span v-if="item.execution_status" class="card-exec-status">
            执行: {{ statusText(item.execution_status) }}
          </span>
          <button
            class="btn-delete-card"
            @click="deleteRequirement(item, $event)"
            :disabled="aggStatus(item) === 'running'"
            title="删除"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </article>
    </div>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      title="需求详情"
      size="600px"
      direction="rtl"
      class="detail-drawer"
    >
      <div v-loading="detailLoading" v-if="detail" class="drawer-content">
        <!-- 状态概览 -->
        <section class="detail-section status-section">
          <div class="status-badge-lg" :class="detail.status">
            <span class="status-icon"></span>
            <span class="status-text">{{ statusText(detail.status) }}</span>
          </div>
          <h2 class="detail-title">{{ detail.input_text }}</h2>
          <div class="detail-meta">
            <span class="meta-id">{{ detail.id }}</span>
            <span class="meta-time">{{ formatTime(detail.created_at) }}</span>
          </div>
          <div v-if="detail.execution?.status" class="exec-status-row">
            <span class="exec-label">执行状态</span>
            <span class="exec-value" :class="detail.execution.status">{{ statusText(detail.execution.status) }}</span>
          </div>
        </section>

        <!-- 操作按钮 -->
        <section class="detail-actions">
          <button class="btn btn-secondary" @click="openLog">日志</button>
          <button v-if="detail.execution_id" class="btn btn-primary" @click="goToCanvas">查看执行画布</button>
          <template v-if="detail.execution_id && detail.execution?.status === 'running'">
            <button class="btn btn-warning" @click="stopRequirement">停止</button>
          </template>
          <template v-if="detail.execution_id && detail.execution?.status === 'paused'">
            <button class="btn btn-success" @click="gateDecision('approve')">通过</button>
            <button class="btn btn-danger" @click="gateDecision('reject')">拒绝</button>
          </template>
          <button
            class="btn btn-delete"
            @click="deleteFromDetail"
            :disabled="detail.execution?.status === 'running'"
          >
            删除
          </button>
        </section>

        <!-- 需求规格（折叠） -->
        <section class="detail-section collapsible" v-if="hasSpec">
          <details>
            <summary class="section-title">需求规格</summary>
            <pre class="spec-content">{{ detail.spec_content }}</pre>
          </details>
        </section>

        <!-- 需求结构树 -->
        <section class="detail-section" v-if="detail.execution_id">
          <h3 class="section-header">分解结构</h3>
          <RequirementTreeView :requirement-id="detail.id" />
        </section>

        <!-- Session 记录（折叠） -->
        <section class="detail-section collapsible" v-if="detail.session_refs.length > 0">
          <details>
            <summary class="section-title">Session 记录 ({{ detail.session_refs.length }})</summary>
            <div class="session-list">
              <div v-for="s in detail.session_refs" :key="s.id" class="session-item">
                <div class="session-meta">
                  <span class="phase-name">{{ s.node_id }}</span>
                  <span class="session-status" :class="s.omnigent_status">{{ statusText(s.omnigent_status) }}</span>
                  <span class="session-iter">iter {{ s.iteration }}</span>
                </div>
                <code class="session-id">{{ s.omnigent_session_id }}</code>
              </div>
            </div>
          </details>
        </section>
      </div>
    </el-drawer>

    <!-- 日志抽屉 -->
    <RequirementLogDrawer
      v-model="logDrawerVisible"
      :requirement-id="detail?.id || ''"
    />
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

/* ========== 需求卡片列表 ========== */
.requirement-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.requirement-card {
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.16s;
}

.requirement-card:hover {
  border-color: var(--accent-dim);
  background: var(--surface);
}

.requirement-card.running {
  border-left: 3px solid var(--st-running);
  background: rgba(34, 211, 238, 0.04);
}

.requirement-card.paused {
  border-left: 3px solid var(--st-paused);
}

.requirement-card.completed {
  border-left: 3px solid var(--st-done);
}

.requirement-card.failed {
  border-left: 3px solid var(--st-failed);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.status-icon {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-badge.running {
  background: rgba(34, 211, 238, 0.15);
  color: var(--st-running);
}
.status-badge.running .status-icon { background: var(--st-running); }

.status-badge.completed {
  background: rgba(34, 197, 94, 0.15);
  color: var(--st-done);
}
.status-badge.completed .status-icon { background: var(--st-done); }

.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--st-failed);
}
.status-badge.failed .status-icon { background: var(--st-failed); }

.status-badge.paused {
  background: rgba(245, 158, 11, 0.15);
  color: var(--st-paused);
}
.status-badge.paused .status-icon { background: var(--st-paused); }

.status-badge.pending, .status-badge.planned {
  background: var(--surface);
  color: var(--muted);
}
.status-badge.pending .status-icon, .status-badge.planned .status-icon { background: var(--faint); }

.card-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
}

.card-content {
  font-size: 14px;
  color: var(--text);
  line-height: 1.6;
  margin: 0 0 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--muted);
}

.card-time {
  font-variant-numeric: tabular-nums;
}

.card-exec-status {
  color: var(--accent);
}

.btn-delete-card {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
  margin-left: auto;
  transition: all 0.16s;
}

.btn-delete-card:hover:not(:disabled) {
  border-color: var(--st-failed);
  color: var(--st-failed);
  background: rgba(239, 68, 68, 0.1);
}

.btn-delete-card:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ========== 空状态 ========== */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--faint);
}

.empty-state .hint {
  font-size: 13px;
  margin-top: 8px;
}

/* ========== 详情抽屉 ========== */
.drawer-content {
  padding: 0 8px;
}

.detail-section {
  margin-bottom: 20px;
  padding: 16px;
  background: var(--surface);
  border-radius: 8px;
}

.status-section {
  text-align: center;
}

.status-badge-lg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.status-badge-lg .status-icon {
  width: 8px;
  height: 8px;
}

.detail-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 8px;
  line-height: 1.4;
}

.detail-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-size: 12px;
  color: var(--muted);
}

.meta-id {
  font-family: var(--font-mono);
  font-size: 11px;
}

.exec-status-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
}

.exec-label { color: var(--muted); }
.exec-value.running { color: var(--st-running); }
.exec-value.completed { color: var(--st-done); }
.exec-value.failed { color: var(--st-failed); }
.exec-value.paused { color: var(--st-paused); }

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  justify-content: center;
}

.btn {
  padding: 10px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.16s;
  border: 1px solid;
}

.btn-secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text);
}
.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #001016;
}
.btn-primary:hover {
  background: #06B6D4;
  border-color: #06B6D4;
}

.btn-warning {
  background: transparent;
  border-color: var(--st-paused);
  color: var(--st-paused);
}
.btn-warning:hover {
  background: rgba(245, 158, 11, 0.15);
}

.btn-success {
  background: var(--st-done);
  border-color: var(--st-done);
  color: white;
}

.btn-danger {
  background: transparent;
  border-color: var(--st-failed);
  color: var(--st-failed);
}
.btn-danger:hover {
  background: rgba(239, 68, 68, 0.15);
}

.btn-delete {
  background: transparent;
  border-color: var(--border);
  color: var(--muted);
}
.btn-delete:hover:not(:disabled) {
  border-color: var(--st-failed);
  color: var(--st-failed);
  background: rgba(239, 68, 68, 0.1);
}
.btn-delete:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ========== 折叠区域 ========== */
.collapsible details {
  border: none;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title::-webkit-details-marker {
  display: none;
}

.section-title::before {
  content: '▶';
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.16s;
}

details[open] .section-title::before {
  transform: rotate(90deg);
}

.spec-content {
  margin: 12px 0 0;
  padding: 12px;
  background: var(--panel);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.session-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-item {
  padding: 10px 12px;
  background: var(--panel);
  border-radius: 6px;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.phase-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.session-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--muted);
}
.session-status.running {
  background: rgba(34, 211, 238, 0.15);
  color: var(--st-running);
}

.session-iter {
  font-size: 11px;
  color: var(--faint);
}

.session-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  background: var(--surface);
  padding: 4px 8px;
  border-radius: 4px;
  word-break: break-all;
}

.section-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 12px;
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
  .detail-actions {
    flex-direction: column;
  }
  .btn {
    width: 100%;
    text-align: center;
  }
}
</style>