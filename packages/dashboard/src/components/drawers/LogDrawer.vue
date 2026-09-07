<script setup lang="ts">
// core/web/src/components/drawers/LogDrawer.vue —— 日志抽屉（照 framework LogDrawer.vue，适配 V2）
// SSE 接 /api/executions/:id/stream 显示事件流 + rate_limited_until 退避倒计时
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  showLogDrawer, closeLogDrawer,
  currentExecId, currentRateLimitedUntil, currentStatus,
} from '../../stores/tasks'

interface LogEntry { ts: string; node_id: string; type: string; text?: string; seq: number }
const logs = ref<LogEntry[]>([])
const now = ref(Date.now())
let es: EventSource | null = null
let tick: ReturnType<typeof setInterval> | null = null
let keySeq = 0

// rate_limited 退避倒计时
const countdownText = computed(() => {
  if (currentStatus.value !== 'rate_limited' || !currentRateLimitedUntil.value) return null
  const ms = new Date(currentRateLimitedUntil.value).getTime() - now.value
  if (ms <= 0) return '即将重试'
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m} 分 ${sec} 秒后重试` : `${sec} 秒后重试`
})

function nowStr() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function openStream() {
  closeStream()
  const execId = currentExecId.value
  if (!execId) return
  try {
    es = new EventSource(`/api/executions/${encodeURIComponent(execId)}/stream`)
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data) as { node_id: string; type: string; text?: string }
        logs.value.push({ ts: nowStr(), node_id: d.node_id, type: d.type, text: d.text, seq: keySeq++ })
        if (logs.value.length > 200) logs.value = logs.value.slice(-200)
      } catch { /* 忽略坏帧 */ }
    }
  } catch {
    // EventSource 构造失败，忽略
  }
}

function closeStream() {
  if (es) { es.close(); es = null }
  logs.value = []
}

// 倒序显示（最新在上）
const logsDesc = computed(() => [...logs.value].reverse())

// 抽屉打开/关闭
watch(showLogDrawer, (open) => {
  if (open) {
    openStream()
    tick = setInterval(() => { now.value = Date.now() }, 1000)
  } else {
    closeStream()
    if (tick) { clearInterval(tick); tick = null }
  }
})

onUnmounted(() => {
  closeStream()
  if (tick) clearInterval(tick)
})
</script>

<template>
  <el-drawer
    v-model="showLogDrawer"
    title="执行日志"
    size="720px"
    @close="closeLogDrawer"
  >
    <div class="toolbar">
      <span class="muted">共 {{ logs.length }} 条（最新在上）</span>
      <el-tag v-if="currentExecId" size="small" type="info">
        {{ currentExecId }}
      </el-tag>
    </div>

    <!-- 限流退避倒计时 -->
    <div v-if="countdownText" class="rate-limit-banner">
      限流退避中，{{ countdownText }}
    </div>

    <el-empty v-if="logs.length === 0" description="暂无日志" />

    <div v-else class="log-list">
      <div v-for="l in logsDesc" :key="l.seq" class="log-item">
        <div class="log-meta">
          <span class="log-time">{{ l.ts }}</span>
          <el-tag size="small" type="info">{{ l.node_id }}</el-tag>
          <el-tag v-if="l.type === 'done'" size="small" type="success">完成</el-tag>
        </div>
        <pre v-if="l.text" class="log-msg">{{ l.text }}</pre>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }

.rate-limit-banner {
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-7);
  color: var(--el-color-warning);
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 500;
}

.log-list { display: flex; flex-direction: column; gap: 12px; }
.log-item { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 10px 12px; background: var(--el-bg-color); }
.log-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.log-time { font-size: 12px; color: var(--el-text-color-secondary); }
.log-msg { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; line-height: 1.7; }
</style>
