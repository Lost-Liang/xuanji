<script setup lang="ts">
// core/web/src/views/TaskDetail.vue —— 任务详情页（V3 重构）
// 设计简报：https://claude.ai/skills/impeccable/shape-brief-taskdetail.md
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type TaskDetail, type SessionRef, type PhaseOutput } from '../api/tasks'
import hljs from 'highlight.js/lib/core'
import diff from 'highlight.js/lib/languages/diff'
import LiveEventStream from '../components/execution/LiveEventStream.vue'
import ChatDrawer from '../components/drawers/ChatDrawer.vue'
import LogDrawer from '../components/drawers/LogDrawer.vue'

// 注册 diff 语言
hljs.registerLanguage('diff', diff)

const route = useRoute()
const router = useRouter()
const taskId = computed(() => route.params.id as string)
const detail = ref<TaskDetail | null>(null)
const loading = ref(true)

// 折叠状态
const phaseOutputsExpanded = ref(false)
const breakdownExpanded = ref(false)
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

// 计算阶段状态
interface PhaseStatus {
  id: string
  label: string
  status: 'done' | 'running' | 'pending' | 'failed' | 'skipped'
  iteration: number
}

const phaseStatuses = computed<PhaseStatus[]>(() => {
  const d = detail.value
  if (!d) return phaseOrder.map(id => ({ id, label: phaseLabel(id), status: 'pending' as const, iteration: 0 }))

  const phaseMap = new Map<string, { status: string; iteration: number }>()

  // 优先从 phase_outputs 读取
  for (const po of d.phase_outputs) {
    const existing = phaseMap.get(po.node_id)
    if (!existing || po.iteration > existing.iteration) {
      phaseMap.set(po.node_id, { status: 'done', iteration: po.iteration })
    }
  }

  // 如果 phase_outputs 为空，从 session_refs 推导（兼容旧数据）
  if (d.phase_outputs.length === 0 && d.session_refs?.length) {
    for (const sr of d.session_refs) {
      if (sr.omnigent_status === 'completed') {
        phaseMap.set(sr.node_id, { status: 'done', iteration: sr.iteration || 1 })
      }
    }
  }

  // 当前节点
  const currentNode = d.current_node_id
  const currentIdx = phaseOrder.findIndex(p => currentNode?.includes(p))

  return phaseOrder.map((id, idx) => {
    const po = phaseMap.get(id)
    let status: PhaseStatus['status'] = 'pending'

    if (po) {
      status = 'done'
    } else if (currentNode?.includes(id)) {
      status = d.status === 'failed' ? 'failed' : 'running'
    } else if (currentIdx > idx && !po) {
      status = 'skipped'
    }

    return {
      id,
      label: phaseLabel(id),
      status,
      iteration: po?.iteration || 0,
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

// 定时刷新
let refreshTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  loadData()
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

// Diff 语法高亮
function highlightDiff(code: string): string {
  try {
    return hljs.highlight(code, { language: 'diff' }).value
  } catch {
    return code
  }
}

// 文件变更类型
type FileChange = { action: string; path: string }

function parseFileChanges(fc: any): FileChange[] {
  if (!fc) return []
  if (Array.isArray(fc)) {
    return fc.map(f => ({
      action: f.action || f.type || 'modified',
      path: f.path || f.file || String(f),
    }))
  }
  return []
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

    <div class="main-content" v-if="detail">
      <!-- 顶部双卡并列 -->
      <div class="top-cards">
        <!-- 状态概览卡片 -->
        <section class="card status-card">
          <div class="status-header">
            <div class="status-badge" :class="effectiveStatus">
              <span class="status-icon"></span>
              <span class="status-label">{{ statusText(effectiveStatus) }}</span>
            </div>
            <span class="task-id">{{ detail.id.slice(-8) }}</span>
          </div>

          <h1 class="task-title">{{ title }}</h1>
          <p v-if="taskDescription" class="task-description">{{ taskDescription }}</p>
          <span v-if="taskType" class="task-type-tag">{{ taskType }}</span>

          <!-- 限流信息 -->
          <div v-if="effectiveStatus === 'rate_limited'" class="rate-limit-banner">
            <span>限流次数: {{ detail.rate_limited_count ?? 0 }}</span>
            <span v-if="detail.rate_limited_until"> · 退避至 {{ formatTime(detail.rate_limited_until) }}</span>
          </div>

          <!-- 元信息 -->
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">开始</span>
              <span class="meta-value">{{ formatTime(detail.started_at) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">用时</span>
              <span class="meta-value">{{ formatDuration(detail.started_at, detail.finished_at) }}</span>
            </div>
            <div class="meta-item" v-if="detail.current_node_id">
              <span class="meta-label">当前</span>
              <span class="meta-value mono">{{ detail.current_node_id }}</span>
            </div>
          </div>

          <!-- Token 聚合 -->
          <div class="token-stats" v-if="detail.token_in || detail.token_out || detail.cost">
            <div class="token-item" v-if="detail.token_in">
              <span class="token-label">Token 入</span>
              <span class="token-value">{{ detail.token_in.toLocaleString() }}</span>
            </div>
            <div class="token-item" v-if="detail.token_out">
              <span class="token-label">Token 出</span>
              <span class="token-value">{{ detail.token_out.toLocaleString() }}</span>
            </div>
            <div class="token-item" v-if="detail.cost">
              <span class="token-label">成本</span>
              <span class="token-value">${{ Number(detail.cost).toFixed(4) }}</span>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="action-bar">
            <button class="btn btn-primary" @click="goToCanvas">查看画布</button>
            <button class="btn btn-secondary" @click="openRightDrawer('chat')" :disabled="!mainSessionRef">对话</button>
            <button class="btn btn-secondary" @click="openRightDrawer('log')">日志</button>
            <template v-if="effectiveStatus === 'running'">
              <button class="btn btn-warning" @click="pauseTask">暂停</button>
              <button class="btn btn-danger" @click="cancelTask">取消</button>
            </template>
            <button v-if="effectiveStatus === 'paused'" class="btn btn-primary" @click="resumeTask">继续</button>
            <button v-if="effectiveStatus === 'failed'" class="btn btn-primary" @click="retryTask">重试</button>
          </div>

          <!-- Review Gate -->
          <div v-if="detail.parent_current_node_id?.startsWith('review_gate_')" class="review-gate-section">
            <div class="review-gate-header">
              <span class="review-gate-title">审查决策</span>
              <span class="review-gate-hint">顶层执行停在 {{ detail.parent_current_node_id }}</span>
            </div>
            <div class="review-gate-body">
              <div class="radio-group">
                <label class="radio-item" :class="{ checked: gateDecision === 'approve' }">
                  <input type="radio" value="approve" v-model="gateDecision" />
                  <span class="radio-label">批准</span>
                </label>
                <label class="radio-item" :class="{ checked: gateDecision === 'reject' }">
                  <input type="radio" value="reject" v-model="gateDecision" />
                  <span class="radio-label">驳回</span>
                </label>
              </div>
              <textarea
                v-model="gateComments"
                class="review-input"
                placeholder="审查意见（可选）"
                rows="2"
              ></textarea>
              <button class="btn btn-primary btn-block" :disabled="gateSubmitting" @click="submitGate">
                {{ gateSubmitting ? '提交中...' : '提交决策' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 执行进度卡片 -->
        <section class="card progress-card">
          <h2 class="card-title">执行进度</h2>
          <div class="phase-flow">
            <div
              v-for="phase in phaseStatuses"
              :key="phase.id"
              class="phase-chip"
              :class="phase.status"
            >
              <span class="phase-icon">
                <template v-if="phase.status === 'done'">✓</template>
                <template v-else-if="phase.status === 'failed'">✗</template>
                <template v-else-if="phase.status === 'running'">●</template>
                <template v-else>○</template>
              </span>
              <span class="phase-label">{{ phase.label }}</span>
              <span v-if="phase.iteration > 0" class="phase-iter">#{{ phase.iteration }}</span>
            </div>
          </div>
          <div class="progress-summary">
            <span>{{ phaseStatuses.filter(p => p.status === 'done').length }} / {{ phaseStatuses.length }} 阶段完成</span>
          </div>
        </section>
      </div>

      <!-- Phase 产出物（折叠） -->
      <section class="card collapsible-card" :class="{ expanded: phaseOutputsExpanded }">
        <header class="collapsible-header" @click="phaseOutputsExpanded = !phaseOutputsExpanded">
          <h2 class="card-title">Phase 产出物</h2>
          <span class="collapsible-meta" v-if="detail.phase_outputs.length">
            {{ detail.phase_outputs.length }} 条记录
          </span>
          <span class="collapsible-toggle">{{ phaseOutputsExpanded ? '收起' : '展开' }}</span>
        </header>
        <div class="collapsible-body" v-if="phaseOutputsExpanded">
          <div v-if="!detail.phase_outputs.length" class="empty-state">
            任务执行中，暂无产出物
          </div>
          <div v-else class="phase-outputs">
            <article
              v-for="po in detail.phase_outputs"
              :key="po.id"
              class="phase-output-item"
            >
              <header class="po-header">
                <span class="po-node">{{ po.node_id }}</span>
                <span class="po-iteration">iter #{{ po.iteration }}</span>
                <span class="po-time">{{ formatTime(po.created_at) }}</span>
              </header>

              <!-- 文件变更 -->
              <div v-if="parseFileChanges(parseJson(po.file_changes)).length" class="po-section">
                <h4 class="po-section-title">文件变更</h4>
                <ul class="file-list">
                  <li
                    v-for="(fc, i) in parseFileChanges(parseJson(po.file_changes))"
                    :key="i"
                    class="file-item"
                    :class="fc.action"
                  >
                    <span class="file-action">{{ fc.action === 'new' || fc.action === 'added' ? '+' : fc.action === 'deleted' ? '-' : 'M' }}</span>
                    <span class="file-path">{{ fc.path }}</span>
                  </li>
                </ul>
              </div>

              <!-- Diff -->
              <div v-if="po.diff_content" class="po-section">
                <h4 class="po-section-title">Diff</h4>
                <pre class="diff-block" v-html="highlightDiff(po.diff_content)"></pre>
              </div>

              <!-- PR -->
              <div v-if="po.pr_url" class="po-section">
                <h4 class="po-section-title">PR</h4>
                <a :href="po.pr_url" target="_blank" class="pr-link">{{ po.pr_url }}</a>
              </div>

              <!-- 测试结果 -->
              <div v-if="parseJson(po.test_result)" class="po-section">
                <h4 class="po-section-title">测试结果</h4>
                <pre class="json-block">{{ JSON.stringify(parseJson(po.test_result), null, 2) }}</pre>
              </div>

              <!-- 审查结果 -->
              <div v-if="parseJson(po.review_result)" class="po-section">
                <h4 class="po-section-title">审查结果</h4>
                <pre class="json-block">{{ JSON.stringify(parseJson(po.review_result), null, 2) }}</pre>
              </div>
            </article>
          </div>
        </div>
      </section>

      <!-- 拆分内容（折叠） -->
      <section class="card collapsible-card" :class="{ expanded: breakdownExpanded }">
        <header class="collapsible-header" @click="breakdownExpanded = !breakdownExpanded">
          <h2 class="card-title">拆分内容</h2>
          <span class="collapsible-toggle">{{ breakdownExpanded ? '收起' : '展开' }}</span>
        </header>
        <div class="collapsible-body" v-if="breakdownExpanded">
          <div v-if="!parsedBreakdown" class="empty-state">
            暂无结构化拆分信息
          </div>
          <div v-else class="breakdown-content">
            <template v-if="parsedBreakdown.kind === 'json'">
              <div v-for="(v, k) in otherBreakdownFields" :key="k" class="breakdown-field">
                <span class="breakdown-field-label">{{ fieldLabel(String(k)) }}</span>
                <pre v-if="typeof v === 'object' && v !== null" class="breakdown-field-value">{{ formatFieldValue(v) }}</pre>
                <p v-else class="breakdown-field-text">{{ formatFieldValue(v) }}</p>
              </div>
              <p v-if="!Object.keys(otherBreakdownFields).length" class="empty-state">
                无其他拆分字段
              </p>
            </template>
            <pre v-else class="breakdown-raw">{{ parsedBreakdown.text }}</pre>
          </div>
        </div>
      </section>
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
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 顶部双卡并列 ========== */
.top-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 900px) {
  .top-cards { grid-template-columns: 1fr; }
}

/* ========== 卡片基础 ========== */
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

/* ========== 状态卡片 ========== */
.status-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.task-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
}

.task-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
  line-height: 1.3;
}

.task-description {
  font-size: 14px;
  color: var(--muted);
  margin: 0;
  line-height: 1.6;
}

.task-type-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface);
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rate-limit-banner {
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
  font-size: 13px;
  color: var(--st-paused);
}

/* ========== 元信息网格 ========== */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 11px;
  color: var(--faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-value {
  font-size: 14px;
  color: var(--text);
  font-weight: 500;
}

.meta-value.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

/* ========== Token 统计 ========== */
.token-stats {
  display: flex;
  gap: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.token-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.token-label {
  font-size: 10px;
  color: var(--faint);
  text-transform: uppercase;
}

.token-value {
  font-size: 13px;
  color: var(--text);
  font-family: var(--font-mono);
}

/* ========== 操作按钮 ========== */
.action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

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

.btn-danger {
  border-color: var(--st-failed);
  color: var(--st-failed);
}
.btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.btn-block {
  width: 100%;
}

/* ========== Review Gate ========== */
.review-gate-section {
  margin-top: 12px;
  padding: 16px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 8px;
}

.review-gate-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.review-gate-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--st-paused);
}

.review-gate-hint {
  font-size: 12px;
  color: var(--muted);
}

.review-gate-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.radio-group {
  display: flex;
  gap: 12px;
}

.radio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.16s, background 0.16s;
}

.radio-item:hover {
  border-color: var(--accent-dim);
}

.radio-item.checked {
  border-color: var(--accent);
  background: rgba(34, 211, 238, 0.08);
}

.radio-item input { display: none; }
.radio-label { font-size: 13px; color: var(--text); }

.review-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.review-input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

/* ========== 进度卡片 ========== */
.progress-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.phase-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.phase-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  transition: border-color 0.2s, background 0.2s, color 0.2s;
}

.phase-chip.done {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--st-done);
}

.phase-chip.running {
  background: rgba(34, 211, 238, 0.08);
  border-color: var(--st-running);
  color: var(--st-running);
}

.phase-chip.running .phase-icon {
  animation: pulse 1.5s ease-in-out infinite;
}

.phase-chip.failed {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--st-failed);
}

.phase-chip.skipped {
  opacity: 0.5;
}

.phase-icon {
  font-size: 12px;
  width: 16px;
  text-align: center;
}

.phase-iter {
  font-size: 10px;
  color: var(--faint);
  font-family: var(--font-mono);
}

.progress-summary {
  font-size: 12px;
  color: var(--muted);
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ========== 折叠卡片 ========== */
.collapsible-card {
  margin-bottom: 12px;
}

.collapsible-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  cursor: pointer;
  transition: background 0.16s;
}

.collapsible-header:hover {
  background: var(--surface);
}

.collapsible-meta {
  font-size: 12px;
  color: var(--muted);
}

.collapsible-toggle {
  margin-left: auto;
  font-size: 12px;
  color: var(--accent);
}

.collapsible-body {
  padding: 0 20px 20px;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: var(--faint);
  font-size: 13px;
}

/* ========== Phase 产出物 ========== */
.phase-outputs {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.phase-output-item {
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.po-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.po-node {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.po-iteration {
  font-size: 11px;
  color: var(--faint);
  font-family: var(--font-mono);
}

.po-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--faint);
}

.po-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.po-section:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.po-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
}

.file-action {
  width: 20px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.file-item.added .file-action { color: var(--st-done); }
.file-item.new .file-action { color: var(--st-done); }
.file-item.deleted .file-action { color: var(--st-failed); }
.file-item.modified .file-action { color: var(--st-paused); }

.file-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}

.diff-block, .json-block {
  margin: 0;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
}

.pr-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
  word-break: break-all;
}
.pr-link:hover { text-decoration: underline; }

/* ========== 拆分内容 ========== */
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
</style>