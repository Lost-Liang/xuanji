<script setup lang="ts">
// core/web/src/views/Tasks.vue —— 任务列表页（V3 重构）
// 状态分组列表 + 概览仪表板 + 改进的筛选交互
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type TaskListItem } from '../api/tasks'
import {
  tasks, loading, loadList,
  openChatDrawer, openLogDrawer,
} from '../stores/tasks'
import ChatDrawer from '../components/drawers/ChatDrawer.vue'
import LogDrawer from '../components/drawers/LogDrawer.vue'

// 需求列表用于筛选
interface ReqItem { id: string; input_text: string }
const requirements = ref<ReqItem[]>([])
const selectedReqId = ref<string>('')

const router = useRouter()
const searchText = ref('')
const statusFilter = ref<string[]>([])

// 状态优先级排序
const statusPriority: string[] = ['running', 'rate_limited', 'paused', 'draft', 'pending', 'failed', 'cancelled', 'completed']
const filterableStatuses = ['draft', 'pending', 'running', 'rate_limited', 'paused', 'completed', 'failed', 'cancelled'] as const

// 状态文本
function statusText(status: string): string {
  const map: Record<string, string> = {
    draft: '待确认', pending: '待执行', running: '执行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
    rate_limited: '限流中',
  }
  return map[status] || status
}

// 标题提取
function taskTitle(row: TaskListItem): string {
  // 优先使用 title 字段（V4 Task 模型）
  if (row.title) return row.title
  // fallback: 从 breakdown_content 解析（V3 兼容）
  const c = row.breakdown_content || ''
  try {
    const obj = JSON.parse(c)
    if (obj && typeof obj === 'object' && obj.title) {
      return obj.title
    }
  } catch {}
  // fallback: 首行
  const firstLine = c.split('\n')[0] || ''
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine || '(无标题)'
}

// 过滤 + 排序后的列表
const filteredTasks = computed(() => {
  let list = tasks.value
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    list = list.filter(t =>
      taskTitle(t).toLowerCase().includes(kw) ||
      t.id.toLowerCase().includes(kw)
    )
  }
  if (statusFilter.value.length > 0) {
    list = list.filter(t => statusFilter.value.includes(t.status))
  }
  return [...list].sort((a, b) => {
    const pa = statusPriority.indexOf(a.status)
    const pb = statusPriority.indexOf(b.status)
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
  })
})

// 按状态分组
const groupedTasks = computed(() => {
  const groups: Record<string, TaskListItem[]> = {
    running: [],
    rate_limited: [],
    paused: [],
    draft: [],
    pending: [],
    failed: [],
    completed: [],
    cancelled: [],
  }
  for (const t of filteredTasks.value) {
    if (groups[t.status]) {
      groups[t.status].push(t)
    }
  }
  return groups
})

// 汇总统计
const taskSummary = computed(() => {
  const total = tasks.value.length
  const running = tasks.value.filter(t => t.status === 'running').length
  const rateLimited = tasks.value.filter(t => t.status === 'rate_limited').length
  const draft = tasks.value.filter(t => t.status === 'draft').length
  const pending = tasks.value.filter(t => t.status === 'pending').length
  const paused = tasks.value.filter(t => t.status === 'paused').length
  const completed = tasks.value.filter(t => t.status === 'completed').length
  const failed = tasks.value.filter(t => t.status === 'failed').length
  const cancelled = tasks.value.filter(t => t.status === 'cancelled').length
  return { total, running, rateLimited, draft, pending, paused, completed, failed, cancelled }
})

// 重要的状态组（优先显示）
const priorityGroups = ['running', 'rate_limited', 'paused', 'draft', 'failed']
const normalGroups = ['pending', 'completed', 'cancelled']

// 加载需求列表
async function loadRequirements() {
  try {
    const r = await fetch('/api/requirements')
    requirements.value = await r.json()
  } catch (e) {
    console.error('加载需求列表失败', e)
  }
}

// 监听需求筛选变化
watch(selectedReqId, (newVal) => {
  loadList(newVal || undefined)
})

onMounted(() => {
  loadRequirements()
  loadList()
})

function toggleStatus(status: string) {
  const idx = statusFilter.value.indexOf(status)
  if (idx >= 0) {
    statusFilter.value = statusFilter.value.filter(s => s !== status)
  } else {
    statusFilter.value = [...statusFilter.value, status]
  }
}

function openDetail(task: TaskListItem) {
  router.push(`/tasks/${task.id}`)
}

async function pauseTask(task: TaskListItem) {
  try {
    await ElMessageBox.confirm('确定要暂停吗？', '暂停确认', { type: 'warning' })
    await api.pause(task.id)
    ElMessage.success('已请求暂停')
    loadList()
  } catch {}
}

async function cancelTask(task: TaskListItem) {
  try {
    await ElMessageBox.confirm('确定要取消吗？取消后不可恢复', '取消确认', { type: 'warning' })
    await api.cancel(task.id)
    ElMessage.success('已请求取消')
    loadList()
  } catch {}
}

async function resumeTask(task: TaskListItem) {
  try {
    await api.resume(task.id)
    ElMessage.success('已继续执行')
    loadList()
  } catch (e: any) {
    ElMessage.error('继续失败')
  }
}

async function retryTask(task: TaskListItem) {
  try {
    await api.retry(task.id, task.current_node_id || '')
    ElMessage.success('已重试')
    loadList()
  } catch (e: any) {
    ElMessage.error('重试失败')
  }
}

async function confirmTask(task: TaskListItem, event?: Event) {
  event?.stopPropagation()
  try {
    const res = await api.confirm(task.id)
    if (res.ok) {
      ElMessage.success('已确认，任务将开始执行')
      loadList()
    } else {
      ElMessage.error(res.error || '确认失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '确认失败')
  }
}

// 删除任务
async function deleteTask(task: TaskListItem, event?: Event) {
  event?.stopPropagation()
  if (task.status === 'running') {
    ElMessage.warning('任务正在执行中，请先停止后再删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确定删除该任务吗？执行记录和 Session 数据将被标记为已删除。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }

  try {
    const res = await api.delete(task.id)
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

// 格式化时间
function formatTime(ts: string | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

// 用时计算
function duration(start: string | null, end: string | null): string {
  if (!start) return '-'
  const startTime = new Date(start).getTime()
  const endTime = end ? new Date(end).getTime() : Date.now()
  const diff = Math.floor((endTime - startTime) / 1000)
  const min = Math.floor(diff / 60)
  const sec = diff % 60
  return min > 0 ? `${min}分${sec}秒` : `${sec}秒`
}
</script>

<template>
  <div class="tasks-page">
    <!-- 概览仪表板 -->
    <div class="dashboard">
      <div class="stat-card total">
        <span class="stat-value">{{ taskSummary.total }}</span>
        <span class="stat-label">总数</span>
      </div>
      <div class="stat-card running" v-if="taskSummary.running">
        <span class="stat-value">{{ taskSummary.running }}</span>
        <span class="stat-label">执行中</span>
      </div>
      <div class="stat-card rate-limited" v-if="taskSummary.rateLimited">
        <span class="stat-value">{{ taskSummary.rateLimited }}</span>
        <span class="stat-label">限流</span>
      </div>
      <div class="stat-card paused" v-if="taskSummary.paused">
        <span class="stat-value">{{ taskSummary.paused }}</span>
        <span class="stat-label">暂停</span>
      </div>
      <div class="stat-card draft" v-if="taskSummary.draft">
        <span class="stat-value">{{ taskSummary.draft }}</span>
        <span class="stat-label">待确认</span>
      </div>
      <div class="stat-card pending" v-if="taskSummary.pending">
        <span class="stat-value">{{ taskSummary.pending }}</span>
        <span class="stat-label">待执行</span>
      </div>
      <div class="stat-card failed" v-if="taskSummary.failed">
        <span class="stat-value">{{ taskSummary.failed }}</span>
        <span class="stat-label">失败</span>
      </div>
      <div class="stat-card completed" v-if="taskSummary.completed">
        <span class="stat-value">{{ taskSummary.completed }}</span>
        <span class="stat-label">已完成</span>
      </div>
    </div>

    <!-- 筛选工具栏 -->
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
          placeholder="搜索任务..."
        />
      </div>
      <select v-model="selectedReqId" class="req-filter">
        <option value="">全部需求</option>
        <option v-for="req in requirements" :key="req.id" :value="req.id">
          {{ req.input_text?.slice(0, 30) || req.id }}{{ req.input_text?.length > 30 ? '...' : '' }}
        </option>
      </select>
      <div class="filter-chips">
        <button
          v-for="s in filterableStatuses"
          :key="s"
          class="filter-chip"
          :class="[s, { active: statusFilter.includes(s) }]"
          @click="toggleStatus(s)"
        >
          <span class="chip-dot"></span>
          <span class="chip-label">{{ statusText(s) }}</span>
          <span class="chip-count">{{ groupedTasks[s]?.length || 0 }}</span>
        </button>
      </div>
      <button class="btn-refresh" @click="loadList(selectedReqId || undefined)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        刷新
      </button>
    </div>

    <!-- 任务列表（按状态分组） -->
    <div class="task-groups" v-loading="loading">
      <!-- 优先状态组 -->
      <template v-for="group in priorityGroups" :key="group">
        <section v-if="groupedTasks[group]?.length" class="task-group">
          <header class="group-header" :class="group">
            <span class="group-icon"></span>
            <span class="group-title">{{ statusText(group) }}</span>
            <span class="group-count">{{ groupedTasks[group].length }}</span>
          </header>
          <div class="task-cards">
            <article
              v-for="task in groupedTasks[group]"
              :key="task.id"
              class="task-card"
              :class="group"
              @click="openDetail(task)"
            >
              <div class="card-main">
                <h3 class="card-title">{{ taskTitle(task) }}</h3>
                <div class="card-meta">
                  <span class="card-id">#{{ task.id.slice(-8) }}</span>
                  <span v-if="task.current_node_id" class="card-node">{{ task.current_node_id }}</span>
                  <span v-if="task.rate_limited_count && group === 'rate_limited'" class="card-limit">
                    限流 {{ task.rate_limited_count }} 次
                  </span>
                </div>
              </div>
              <div class="card-actions" @click.stop>
                <button class="action-btn" :disabled="!task.session_ref_id" @click="openChatDrawer(task)">对话</button>
                <button class="action-btn" @click="openLogDrawer(task)">日志</button>
                <template v-if="group === 'running'">
                  <button class="action-btn warn" @click="pauseTask(task)">暂停</button>
                  <button class="action-btn danger" @click="cancelTask(task)">取消</button>
                </template>
                <button v-if="group === 'draft'" class="action-btn primary" @click="confirmTask(task, $event)">确认执行</button>
                <button v-if="group === 'paused'" class="action-btn primary" @click="resumeTask(task)">继续</button>
                <button v-if="group === 'failed'" class="action-btn primary" @click="retryTask(task)">重试</button>
                <button
                  class="action-btn delete"
                  @click="deleteTask(task, $event)"
                  :disabled="task.status === 'running'"
                >
                  删除
                </button>
              </div>
            </article>
          </div>
        </section>
      </template>

      <!-- 普通状态组（折叠） -->
      <template v-for="group in normalGroups" :key="group">
        <section v-if="groupedTasks[group]?.length" class="task-group collapsed">
          <header class="group-header" :class="group">
            <span class="group-icon"></span>
            <span class="group-title">{{ statusText(group) }}</span>
            <span class="group-count">{{ groupedTasks[group].length }}</span>
            <details class="group-details">
              <summary class="group-toggle">展开</summary>
              <div class="task-cards">
                <article
                  v-for="task in groupedTasks[group]"
                  :key="task.id"
                  class="task-card"
                  :class="group"
                  @click="openDetail(task)"
                >
                  <div class="card-main">
                    <h3 class="card-title">{{ taskTitle(task) }}</h3>
                    <div class="card-meta">
                      <span class="card-id">#{{ task.id.slice(-8) }}</span>
                    </div>
                  </div>
                  <div class="card-actions" @click.stop>
                    <button class="action-btn" :disabled="!task.session_ref_id" @click="openChatDrawer(task)">对话</button>
                    <button class="action-btn" @click="openLogDrawer(task)">日志</button>
                    <button
                      class="action-btn delete"
                      @click="deleteTask(task, $event)"
                    >
                      删除
                    </button>
                  </div>
                </article>
              </div>
            </details>
          </header>
        </section>
      </template>

      <!-- 空状态 -->
      <div v-if="!filteredTasks.length && !loading" class="empty-state">
        <p>没有找到匹配的任务</p>
      </div>
    </div>

    <!-- 抽屉 -->
    <ChatDrawer />
    <LogDrawer />
  </div>
</template>

<style scoped>
.tasks-page {
  padding: 16px;
  min-height: calc(100vh - 120px);
  max-width: 1200px;
  margin: 0 auto;
}

/* ========== 概览仪表板 ========== */
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
  padding: 16px 24px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 80px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-mono);
  line-height: 1;
}

.stat-label {
  font-size: 12px;
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

.stat-card.rate-limited {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.08);
}
.stat-card.rate-limited .stat-value { color: var(--st-paused); }

.stat-card.draft {
  border-color: rgba(139, 92, 246, 0.3);
  background: rgba(139, 92, 246, 0.08);
}
.stat-card.draft .stat-value { color: #8b5cf6; }

.stat-card.paused {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.05);
}
.stat-card.paused .stat-value { color: var(--st-paused); }

.stat-card.failed {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
}
.stat-card.failed .stat-value { color: var(--st-failed); }

.stat-card.completed {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.08);
}
.stat-card.completed .stat-value { color: var(--st-done); }

/* ========== 工具栏 ========== */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 16px;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 200px;
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
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  transition: border-color 0.16s;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.req-filter {
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  min-width: 180px;
  max-width: 280px;
  cursor: pointer;
}

.req-filter:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.16s;
}

.filter-chip:hover {
  border-color: var(--accent-dim);
  color: var(--text);
}

.filter-chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #001016;
}

.filter-chip.active .chip-dot { background: #001016; }

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--faint);
}

.filter-chip.running .chip-dot { background: var(--st-running); }
.filter-chip.rate_limited .chip-dot { background: var(--st-paused); }
.filter-chip.paused .chip-dot { background: var(--st-paused); }
.filter-chip.draft .chip-dot { background: #8b5cf6; }
.filter-chip.failed .chip-dot { background: var(--st-failed); }
.filter-chip.completed .chip-dot { background: var(--st-done); }

.chip-count {
  font-family: var(--font-mono);
  font-size: 11px;
  opacity: 0.7;
}

.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.16s;
}

.btn-refresh:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ========== 任务分组 ========== */
.task-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-group {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  cursor: default;
}

.group-header.running { border-left: 3px solid var(--st-running); }
.group-header.rate_limited { border-left: 3px solid var(--st-paused); }
.group-header.paused { border-left: 3px solid var(--st-paused); }
.group-header.draft { border-left: 3px solid #8b5cf6; }
.group-header.failed { border-left: 3px solid var(--st-failed); }
.group-header.pending { border-left: 3px solid var(--faint); }
.group-header.completed { border-left: 3px solid var(--st-done); }
.group-header.cancelled { border-left: 3px solid var(--muted); }

.group-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.group-header.running .group-icon { background: var(--st-running); box-shadow: 0 0 8px var(--st-running); }
.group-header.rate_limited .group-icon { background: var(--st-paused); }
.group-header.paused .group-icon { background: var(--st-paused); }
.group-header.draft .group-icon { background: #8b5cf6; }
.group-header.failed .group-icon { background: var(--st-failed); }
.group-header.pending .group-icon { background: var(--faint); }
.group-header.completed .group-icon { background: var(--st-done); }

.group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.group-count {
  font-size: 12px;
  color: var(--muted);
  font-family: var(--font-mono);
  padding: 2px 8px;
  background: var(--panel);
  border-radius: 10px;
}

/* ========== 任务卡片 ========== */
.task-cards {
  display: flex;
  flex-direction: column;
}

.task-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.16s;
}

.task-card:last-child {
  border-bottom: none;
}

.task-card:hover {
  background: var(--surface);
}

.task-card.running {
  background: rgba(34, 211, 238, 0.04);
}
.task-card.running:hover {
  background: rgba(34, 211, 238, 0.08);
}

.task-card.rate_limited,
.task-card.paused {
  background: rgba(245, 158, 11, 0.04);
}

.task-card.failed {
  background: rgba(239, 68, 68, 0.04);
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  margin: 0;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.card-id {
  font-family: var(--font-mono);
  padding: 1px 6px;
  background: var(--surface);
  border-radius: 3px;
  font-size: 11px;
}

.card-node {
  font-family: var(--font-mono);
  color: var(--accent);
}

.card-limit {
  color: var(--st-paused);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.action-btn {
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.16s;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn.primary {
  border-color: var(--accent);
  color: var(--accent);
}
.action-btn.primary:hover:not(:disabled) {
  background: var(--accent);
  color: #001016;
}

.action-btn.warn {
  border-color: var(--st-paused);
  color: var(--st-paused);
}
.action-btn.warn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.15);
}

.action-btn.danger {
  border-color: var(--st-failed);
  color: var(--st-failed);
}
.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
}

.action-btn.delete {
  border-color: var(--border);
  color: var(--muted);
}
.action-btn.delete:hover:not(:disabled) {
  border-color: var(--st-failed);
  color: var(--st-failed);
  background: rgba(239, 68, 68, 0.1);
}
.action-btn.delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ========== 折叠分组 ========== */
.group-details {
  width: 100%;
}

.group-toggle {
  margin-left: auto;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  list-style: none;
}

.group-toggle::-webkit-details-marker {
  display: none;
}

.group-details[open] .group-toggle::before {
  content: '收起';
}

.group-details:not([open]) .group-toggle::before {
  content: '展开';
}

/* ========== 空状态 ========== */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--faint);
  font-size: 14px;
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .dashboard {
    gap: 8px;
  }
  .stat-card {
    padding: 12px 16px;
    min-width: 60px;
  }
  .stat-value {
    font-size: 22px;
  }
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .search-box {
    max-width: none;
  }
  .filter-chips {
    order: 2;
  }
  .task-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .card-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>