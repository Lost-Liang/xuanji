<script setup lang="ts">
// core/web/src/views/ExecutionOverview.vue —— 执行总览页（spec §9.3 line 444-447）
// 顶层图实例卡片列表 + 进度条（已完成 phase 占比，非 48h 倒计时）
// 详情下钻：引用 5.5/5.3 组件（StateTransitionDag + PhaseTimelineGantt + LiveEventStream）+ 并发子图实例
// worktree 展示 deferred（omnigent_session_refs 无 git_branch 列，不造数据）
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { execApi, type ExecutionListItem, type SubExecution } from '../api/agent-bindings'
import { api as taskApi } from '../api/tasks'
import StateTransitionDag from '../components/execution/StateTransitionDag.vue'
import PhaseTimelineGantt from '../components/execution/PhaseTimelineGantt.vue'
import LiveEventStream from '../components/execution/LiveEventStream.vue'

const list = ref<ExecutionListItem[]>([])
const loading = ref(false)
const selectedId = ref<string>('')
const subExecs = ref<SubExecution[]>([])

// 状态文本
function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待执行', running: '执行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
    rate_limited: '限流中',
  }
  return map[status] || status
}

// 格式化时间
function formatTime(ts: string | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

// 用时计算
function elapsed(start: string | null): string {
  if (!start) return '-'
  const startTime = new Date(start).getTime()
  const diff = Math.floor((Date.now() - startTime) / 1000)
  const min = Math.floor(diff / 60)
  const sec = diff % 60
  return min > 0 ? `${min}分${sec}秒` : `${sec}秒`
}

// 进度：phase_count 作为已完成 phase 计数（简化，无总 phase 分母时显示绝对值）
function progressPct(row: ExecutionListItem): number {
  // loop_counters 含 phase 推进信息；若无则用 phase_count>0 视为部分完成
  // 简化：有 finished_at 视为 100%，否则按 phase_count 占比（假设典型 ~6 phase）
  if (row.status === 'completed') return 100
  if (row.status === 'failed' || row.status === 'cancelled') return 0
  const total = row.task_count > 0 ? row.task_count : 6
  return Math.min(100, Math.round((row.phase_count / total) * 100))
}

const summary = computed(() => {
  const total = list.value.length
  const running = list.value.filter(r => r.status === 'running').length
  const completed = list.value.filter(r => r.status === 'completed').length
  const failed = list.value.filter(r => r.status === 'failed').length
  return { total, running, completed, failed }
})

async function loadList() {
  loading.value = true
  try {
    list.value = await execApi.list()
  } catch {
    ElMessage.error('加载执行列表失败')
  } finally {
    loading.value = false
  }
}

// 干预操作
async function pauseExec(id: string) {
  try {
    await taskApi.pause(id)
    ElMessage.success('已暂停')
    loadList()
  } catch {
    ElMessage.error('暂停失败')
  }
}

async function resumeExec(id: string) {
  try {
    await taskApi.resume(id)
    ElMessage.success('已继续')
    loadList()
  } catch {
    ElMessage.error('继续失败')
  }
}

async function cancelExec(id: string) {
  try {
    await taskApi.cancel(id)
    ElMessage.success('已取消')
    loadList()
  } catch {
    ElMessage.error('取消失败')
  }
}

async function openDetail(row: ExecutionListItem) {
  selectedId.value = row.id
  subExecs.value = []
  try {
    subExecs.value = await execApi.subExecutions(row.id)
  } catch {
    // 子图查询失败不阻塞详情展示
  }
}

onMounted(() => loadList())
</script>

<template>
  <div class="exec-overview">
    <!-- 工具栏 -->
    <div class="toolbar">
      <span class="title">执行总览</span>
      <button class="btn-secondary" @click="loadList">刷新</button>
    </div>

    <!-- 汇总条 -->
    <div class="summary-bar" v-if="list.length">
      <span class="summary-stat total">{{ summary.total }} 个实例</span>
      <span v-if="summary.running" class="summary-stat is-running">{{ summary.running }} 执行中</span>
      <span v-if="summary.completed" class="summary-stat">{{ summary.completed }} 已完成</span>
      <span v-if="summary.failed" class="summary-stat is-failed">{{ summary.failed }} 失败</span>
    </div>

    <!-- 实例卡片列表 -->
    <div class="card-list" v-loading="loading">
      <div v-if="!list.length && !loading" class="empty">暂无执行实例</div>
      <div
        v-for="row in list"
        :key="row.id"
        class="exec-card"
        :class="{ active: selectedId === row.id }"
        @click="openDetail(row)"
      >
        <div class="card-header">
          <span class="card-title">{{ row.requirement_text || row.subject_id || row.id }}</span>
          <span class="status-tag" :class="row.status">{{ statusText(row.status) }}</span>
        </div>
        <div class="card-meta">
          <span class="meta-badge">#{{ row.id.slice(-8) }}</span>
          <span v-if="row.started_at" class="meta-time">{{ formatTime(row.started_at) }}</span>
          <span v-if="row.started_at && row.status === 'running'" class="meta-elapsed">已运行 {{ elapsed(row.started_at) }}</span>
          <span v-if="row.current_node_id" class="meta-node">当前阶段: {{ row.current_node_id }}</span>
          <span class="meta-count">{{ row.task_count }} 任务 / {{ row.phase_count }} phase</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPct(row) + '%' }" :class="row.status"></div>
          <span class="progress-text">{{ progressPct(row) }}%</span>
        </div>
        <!-- 干预操作按钮 -->
        <div class="card-actions" @click.stop>
          <el-button v-if="row.status === 'running'" type="warning" size="small" @click="pauseExec(row.id)">暂停</el-button>
          <el-button v-if="row.status === 'paused' || row.status === 'rate_limited'" type="success" size="small" @click="resumeExec(row.id)">继续</el-button>
          <el-button v-if="row.status === 'failed'" type="primary" size="small" @click="resumeExec(row.id)">重试</el-button>
          <el-button v-if="row.status === 'running' || row.status === 'paused'" type="danger" size="small" plain @click="cancelExec(row.id)">取消</el-button>
        </div>
      </div>
    </div>

    <!-- 详情下钻 -->
    <div v-if="selectedId" class="detail-section">
      <div class="detail-header">
        <span class="detail-title">执行详情: {{ selectedId.slice(-8) }}</span>
        <el-button link size="small" @click="selectedId = ''">收起</el-button>
      </div>

      <!-- 状态转移 DAG（5.5 组件） -->
      <div class="detail-block">
        <div class="block-title">状态转移 DAG</div>
        <StateTransitionDag :execution-id="selectedId" />
      </div>

      <!-- Phase 时间线甘特（5.5 组件） -->
      <div class="detail-block">
        <div class="block-title">Phase 时间线</div>
        <PhaseTimelineGantt :execution-id="selectedId" />
      </div>

      <!-- 并发子图实例列表 -->
      <div class="detail-block" v-if="subExecs.length">
        <div class="block-title">并发子图实例 ({{ subExecs.length }})</div>
        <el-table :data="subExecs" size="small">
          <el-table-column label="实例" prop="id" min-width="160">
            <template #default="{ row }">
              <span class="mono">#{{ row.id.slice(-8) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <span class="status-dot" :class="row.status"></span>{{ statusText(row.status) }}
            </template>
          </el-table-column>
          <el-table-column label="当前节点" prop="current_node_id" min-width="140" />
          <el-table-column label="开始" prop="started_at" min-width="160" />
        </el-table>
      </div>

      <!-- 实时事件流（5.3 组件） -->
      <div class="detail-block">
        <div class="block-title">实时事件流</div>
        <LiveEventStream :execution-id="selectedId" />
      </div>

      <!-- worktree 展示 deferred：V4 暂未接入 git_branch 数据 -->
      <div class="detail-block deferred">
        <div class="block-title">Worktree</div>
        <div class="placeholder">Worktree 展示待接入（当前无 git_branch 数据源）</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.exec-overview { padding: 20px; min-height: calc(100vh - 120px); }

.toolbar {
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color); border-radius: 12px; margin-bottom: 12px;
}
.toolbar .title { font-size: 18px; font-weight: 600; color: var(--el-text-color-primary); }

.btn-secondary {
  padding: 8px 18px; border: 1px solid var(--el-border-color); border-radius: 8px;
  background: var(--el-bg-color-overlay); color: var(--el-text-color-primary);
  cursor: pointer; font-size: 14px;
}
.btn-secondary:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }

.summary-bar {
  display: flex; gap: 16px; align-items: center; padding: 10px 20px; margin-bottom: 12px;
  background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color);
  border-radius: 10px; font-size: 13px; color: var(--el-text-color-secondary);
}
.summary-stat { display: inline-flex; align-items: center; gap: 5px; }
.summary-stat.total { font-weight: 600; color: var(--el-text-color-primary); }
.summary-stat.is-running { color: var(--el-color-primary); font-weight: 500; }
.summary-stat.is-failed { color: var(--el-color-danger); font-weight: 500; }

.card-list { display: flex; flex-direction: column; gap: 10px; }
.empty { padding: 40px; text-align: center; color: var(--el-text-color-placeholder); }

.exec-card {
  padding: 16px 20px; background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color); border-radius: 12px; cursor: pointer;
  transition: border-color 0.2s;
}
.exec-card:hover { border-color: var(--el-color-primary); }
.exec-card.active { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px var(--el-color-primary-light-9); }

.card-actions {
  display: flex; gap: 8px; margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.card-title { font-size: 15px; font-weight: 500; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 12px; }

.status-tag {
  font-size: 12px; padding: 2px 10px; border-radius: 10px; white-space: nowrap;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.status-tag.running { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.status-tag.completed { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.status-tag.failed { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.status-tag.rate_limited { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.status-tag.paused { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }

.card-meta { display: flex; gap: 12px; align-items: center; font-size: 12px; color: var(--el-text-color-placeholder); margin-bottom: 10px; }
.meta-badge { font-family: var(--font-mono); padding: 1px 5px; border-radius: 3px; background: var(--el-fill-color); }
.meta-node { color: var(--el-text-color-secondary); }

.progress-bar {
  position: relative; height: 8px; background: var(--el-fill-color-light);
  border-radius: 4px; overflow: hidden;
}
.progress-fill {
  height: 100%; border-radius: 4px; transition: width 0.3s;
  background: var(--el-color-primary);
}
.progress-fill.completed { background: var(--el-color-success); }
.progress-fill.failed { background: var(--el-color-danger); }
.progress-fill.rate_limited, .progress-fill.paused { background: var(--el-color-warning); }
.progress-text {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 11px; color: var(--el-text-color-secondary); line-height: 1;
}

.detail-section {
  margin-top: 16px; padding: 20px; background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color); border-radius: 12px;
}
.detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.detail-title { font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }

.detail-block { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter); }
.detail-block:first-of-type { border-top: none; padding-top: 0; }
.block-title { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); margin-bottom: 10px; }

.detail-block.deferred .placeholder {
  padding: 20px; text-align: center; color: var(--el-text-color-placeholder);
  background: var(--el-fill-color-light); border-radius: 8px; font-size: 13px;
}

.mono { font-family: var(--font-mono); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.status-dot.running { background: var(--el-color-primary); }
.status-dot.completed { background: var(--el-color-success); }
.status-dot.failed { background: var(--el-color-danger); }
</style>
