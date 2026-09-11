<script setup lang="ts">
// core/web/src/views/TaskDetail.vue —— 任务详情页（V4 重构）
// 设计简报：任务详情页重设计 Plan
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type TaskDetail, type SessionRef, type PhaseOutput } from '../api/tasks'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import LiveEventStream from '../components/execution/LiveEventStream.vue'
import ChatDrawer from '../components/drawers/ChatDrawer.vue'
import LogDrawer from '../components/drawers/LogDrawer.vue'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => route.params.id as string)
const detail = ref<TaskDetail | null>(null)
const loading = ref(true)
const workflow = ref<any>(null)

// 折叠状态
const rightDrawerVisible = ref(false)
const rightDrawerTab = ref<'log' | 'chat'>('log')

// review gate
const gateDecision = ref('approve')
const gateComments = ref('')
const gateSubmitting = ref(false)

// 状态文本映射
function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待执行', running: '执行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
    rate_limited: '限流中',
  }
  return map[status] || status
}

// Markdown 渲染（Task 6c）
function renderMarkdown(text: string): string {
  if (!text) return ''
  try {
    const rawHtml = marked(text) as string
    return DOMPurify.sanitize(rawHtml)
  } catch {
    return text
  }
}

// 解析 breakdown_content
type ParsedBreakdown =
  | { kind: 'json'; obj: Record<string, any> }
  | { kind: 'text'; text: string }
  | null

const parsedBreakdown = computed<ParsedBreakdown>(() => {
  const c = detail.value?.breakdown_content
  if (!c) return null
  if (typeof c === 'object') {
    return { kind: 'json', obj: c as Record<string, any> }
  }
  try {
    const obj = JSON.parse(c)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return { kind: 'json', obj }
    }
  } catch { /* 非 JSON，按文本处理 */ }
  return { kind: 'text', text: c }
})

const title = computed(() => {
  // 优先使用 API 返回的 title 字段
  if (detail.value?.title) return detail.value.title
  const p = parsedBreakdown.value
  if (!p) return '(无标题)'
  if (p.kind === 'json') return p.obj.title || p.obj.task_type || '(无标题)'
  const firstLine = p.text.split('\n')[0] || ''
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine || '(无标题)'
})

const taskType = computed(() => parsedBreakdown.value?.kind === 'json' ? parsedBreakdown.value.obj.task_type : null)
const taskDescription = computed(() => parsedBreakdown.value?.kind === 'json' ? parsedBreakdown.value.obj.description : null)

// 拆分内容其余字段
const otherBreakdownFields = computed<Record<string, any>>(() => {
  const p = parsedBreakdown.value
  if (!p || p.kind !== 'json') return {}
  const { title: _t, task_type: _tt, description: _d, ...rest } = p.obj
  return rest
})

function fieldLabel(k: string): string {
  const m: Record<string, string> = {
    acceptance_criteria: '验收标准', acceptance: '验收标准',
    priority: '优先级', files: '涉及文件', dependencies: '依赖',
    estimated_effort: '预估工作量', notes: '备注',
  }
  return m[k] || k
}

function formatFieldValue(v: any): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(i => typeof i === 'object' && i !== null ? JSON.stringify(i) : String(i)).join('\n')
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

// 主 session ref
const mainSessionRef = computed(() => {
  if (!detail.value?.session_refs) return null
  return detail.value.session_refs.find(r => r.role === 'main') || null
})

// 推导状态
const effectiveStatus = computed(() => {
  const d = detail.value
  if (!d) return 'pending'
  if (d.status !== 'pending') return d.status
  const pos = d.phase_outputs
  if (!pos.length) return 'pending'
  return pos.some(po => po.node_id === 'archive') ? 'completed' : 'running'
})

// 格式化时间
function formatTime(ts: string | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '-'
  const startTime = new Date(start).getTime()
  const endTime = end ? new Date(end).getTime() : Date.now()
  const diff = Math.floor((endTime - startTime) / 1000)
  const min = Math.floor(diff / 60)
  const sec = diff % 60
  return min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`
}

// 阶段定义（按典型执行顺序）
// 支持两种命名体系：旧版（breakdown/planning/code/test/review/deploy/archive）
// 和新版工作流（develop/compile_check/test_check/quality_review/security_review/final_review）
const phaseOrder = ['breakdown', 'planning', 'develop', 'code', 'compile_check', 'test', 'test_check', 'review', 'quality_review', 'security_review', 'deploy', 'archive', 'final_review']

// 计算阶段状态（Task 6b: 只显示已执行阶段，带耗时）
interface PhaseStatus {
  id: string
  label: string
  status: 'done' | 'running' | 'pending' | 'failed' | 'skipped'
  iteration: number
  duration: string | null
}

const phaseStatuses = computed<PhaseStatus[]>(() => {
  const d = detail.value
  if (!d) return []

  // 从工作流定义获取阶段列表
  const workflowNodes = workflow.value?.definition_json?.nodes || []

  // 构建状态映射（从 session_refs，使用新的 started_at/completed_at 字段）
  const statusMap = new Map<string, { status: string; iteration: number; started_at: string | null; completed_at: string | null }>()

  // 从 session_refs 获取状态
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

  // 按照 workflow 定义的顺序排序
  const order = workflowNodes.length > 0
    ? workflowNodes.map((n: any) => n.id)
    : phaseOrder

  // 只保留有记录的阶段（不展示未执行的阶段）
  return order
    .filter((id: string) => statusMap.has(id))
    .map((id: string) => {
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

function phaseLabel(id: string): string {
  const map: Record<string, string> = {
    breakdown: '拆分', planning: '规划', code: '编码',
    test: '测试', review: '审查', deploy: '部署', archive: '归档',
    // 新版工作流节点
    develop: '开发', compile_check: '编译', test_check: '测试',
    quality_review: '质量审查', security_review: '安全审查', final_review: '终审',
    bug_fix: '修复', quality_issue_fix: '质量修复', security_issue_fix: '安全修复',
  }
  return map[id] || id
}

// 加载数据
async function loadData() {
  loading.value = true
  try {
    const data = await api.get(taskId.value)
    detail.value = data
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// 加载工作流定义
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

// 定时刷新
let refreshTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  loadData().then(() => {
    loadWorkflow()
  })
  refreshTimer = setInterval(() => {
    if (detail.value && ['running', 'rate_limited', 'paused', 'pending'].includes(effectiveStatus.value)) {
      loadData()
    }
  }, 5000)
})
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

// 操作
async function pauseTask() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm('确定暂停此任务吗？', '暂停确认', { type: 'warning' })
    await api.pause(detail.value.id)
    ElMessage.success('已暂停')
    loadData()
  } catch {}
}

async function cancelTask() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm('确定取消此任务吗？取消后不可恢复', '取消确认', { type: 'warning' })
    await api.cancel(detail.value.id)
    ElMessage.success('已取消')
    loadData()
  } catch {}
}

async function resumeTask() {
  if (!detail.value) return
  try {
    await api.resume(detail.value.id)
    ElMessage.success('已继续执行')
    loadData()
  } catch { ElMessage.error('继续失败') }
}

async function retryTask() {
  if (!detail.value) return
  try {
    await api.retry(detail.value.id, detail.value.current_node_id || '')
    ElMessage.success('已重试')
    loadData()
  } catch { ElMessage.error('重试失败') }
}

// review gate 提交
async function submitGate() {
  if (!detail.value?.parent_execution_id) return
  gateSubmitting.value = true
  try {
    await api.gate(detail.value.parent_execution_id, gateDecision.value, gateComments.value)
    ElMessage.success('已提交审查决策')
    gateComments.value = ''
    loadData()
  } catch { ElMessage.error('提交失败') }
  finally { gateSubmitting.value = false }
}

// 打开右侧抽屉
function openRightDrawer(tab: 'log' | 'chat') {
  rightDrawerTab.value = tab
  rightDrawerVisible.value = true
}

// 查看执行画布
function goToCanvas() {
  if (!detail.value) return
  router.push({ path: '/canvas', query: { execution_id: detail.value.id } })
}

// 解析 JSONB 字段
function parseJson(v: any): any {
  if (!v) return null
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return null }
  }
  return v
}
</script>

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

    <!-- Zone C: 主内容区 -->
    <div class="main-content-grid" v-if="detail && !loading">
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
    <div v-else-if="loading" class="loading-state">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 右侧抽屉（日志 + 对话） -->
    <el-drawer
      v-model="rightDrawerVisible"
      :title="rightDrawerTab === 'log' ? '执行日志' : '对话'"
      size="480px"
      direction="rtl"
      class="right-drawer"
    >
      <template #header>
        <div class="drawer-tabs">
          <button
            class="drawer-tab"
            :class="{ active: rightDrawerTab === 'log' }"
            @click="rightDrawerTab = 'log'"
          >日志</button>
          <button
            class="drawer-tab"
            :class="{ active: rightDrawerTab === 'chat' }"
            @click="rightDrawerTab = 'chat'"
          >对话</button>
        </div>
      </template>

      <div class="drawer-body">
        <LiveEventStream v-if="rightDrawerTab === 'log'" :execution-id="detail?.id" />
        <div v-else-if="mainSessionRef" class="chat-placeholder">
          <p>对话功能需要使用 ChatDrawer 组件</p>
          <p class="muted">Session ID: {{ mainSessionRef.id }}</p>
        </div>
        <div v-else class="empty-state">
          无可用 session，无法对话
        </div>
      </div>
    </el-drawer>

    <!-- 保留原有抽屉组件 -->
    <ChatDrawer />
    <LogDrawer />
  </div>
</template>

<style scoped>
/* ========== 页面容器 ========== */
.task-detail {
  padding: 16px;
  min-height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
}

/* ========== 面包屑 ========== */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}
.breadcrumb-link {
  color: var(--muted);
  text-decoration: none;
  transition: color 0.16s;
}
.breadcrumb-link:hover { color: var(--accent); }
.breadcrumb-sep { color: var(--faint); }
.breadcrumb-current {
  color: var(--text);
  font-weight: 500;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== Zone A: 标题条 ========== */
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

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
}

.status-badge.running {
  background: rgba(34, 211, 238, 0.15);
  color: var(--st-running);
}
.status-badge.running .status-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--st-running);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.15);
  color: var(--st-done);
}
.status-badge.completed .status-icon::before { content: '✓'; }

.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--st-failed);
}
.status-badge.failed .status-icon::before { content: '✗'; }

.status-badge.paused, .status-badge.rate_limited {
  background: rgba(245, 158, 11, 0.15);
  color: var(--st-paused);
}
.status-badge.paused .status-icon::before { content: '⏸'; }
.status-badge.rate_limited .status-icon::before { content: '⏳'; }

.status-badge.pending {
  background: var(--surface);
  color: var(--muted);
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

.mono {
  font-family: var(--font-mono);
}

.title-bar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* ========== Zone B: 流程条 ========== */
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
  animation: pulse 1.5s ease-in-out infinite;
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

/* ========== Zone C: 主内容区 ========== */
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

.main-col, .side-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ========== 内容卡片 ========== */
.content-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 12px;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: var(--faint);
  font-size: 13px;
}

/* ========== 任务要求 ========== */
.breakdown-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.breakdown-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.breakdown-field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.breakdown-field-value {
  margin: 0;
  padding: 10px;
  background: var(--surface);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.breakdown-field-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.breakdown-raw {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ========== 阶段结果 ========== */
.phase-result {
  background: var(--surface);
  border-left: 3px solid var(--ai);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  margin-bottom: 12px;
}

.phase-result:last-child {
  margin-bottom: 0;
}

.phase-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.phase-result-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ai);
}

.phase-result-time {
  font-size: 12px;
  color: var(--faint);
}

.phase-result-body {
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

.phase-result-body :deep(pre) {
  background: var(--surface-2);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

/* ========== 元信息 ========== */
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

/* ========== 产出物索引 ========== */
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

/* ========== 按钮样式 ========== */
.btn {
  font-family: var(--font-ui);
  font-weight: 500;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s, color 0.16s;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent-dim);
  background: var(--surface-2);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #001016;
}
.btn-primary:hover:not(:disabled) {
  background: #06B6D4;
  border-color: #06B6D4;
}

.btn-secondary {
  background: transparent;
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-warning {
  border-color: var(--st-paused);
  color: var(--st-paused);
}
.btn-warning:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.1);
}

/* ========== 右侧抽屉 ========== */
.right-drawer :deep(.el-drawer__header) {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0;
}

.drawer-tabs {
  display: flex;
  gap: 4px;
}

.drawer-tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.16s, background 0.16s;
}

.drawer-tab:hover {
  color: var(--text);
}

.drawer-tab.active {
  background: var(--surface);
  color: var(--accent);
}

.drawer-body {
  height: calc(100vh - 120px);
  overflow: hidden;
}

.chat-placeholder {
  padding: 20px;
  text-align: center;
}

.chat-placeholder .muted {
  font-size: 12px;
  color: var(--faint);
  margin-top: 8px;
}

/* ========== 加载状态 ========== */
.loading-state {
  padding: 40px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>