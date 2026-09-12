<script setup lang="ts">
// packages/dashboard/src/views/ConversationView.vue —— 对话历史查看
//
// 根据 sessionId 查询 conversation_events 表，按时间线展示：
// - model_delta:   Assistant 输出的 token（合并为连续文本块）
// - tool_started:  工具调用开始（展示工具名 + 输入）
// - tool_completed: 工具调用完成（展示输出摘要）
// - inbox_ask:     Agent 向人类提问
// - inbox_answer:  人类回答
// - error:         错误事件
//
// 底部提供 followup 输入框，调用 POST /api/conversations/session/:sessionId/followup
// 通过 --resume 恢复已有会话，让 Agent 继续处理人类的新消息。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { conversationsApi, type ConversationEvent } from '../api/conversations'

const route = useRoute()
const router = useRouter()

// ─── 路由参数 ──────────────────────────────────────────────────────────────────
const sessionId = computed(() => String(route.params.sessionId ?? ''))

// ─── 状态 ──────────────────────────────────────────────────────────────────────
const events = ref<ConversationEvent[]>([])
const loading = ref(false)
const followupText = ref('')
const followupBusy = ref(false)
const executionId = ref<string | null>(null)
const autoRefresh = ref(true)
let refreshTimer: ReturnType<typeof setInterval> | null = null

// ─── 数据加载 ──────────────────────────────────────────────────────────────────
async function loadEvents() {
  if (!sessionId.value) return
  loading.value = true
  try {
    const list = await conversationsApi.getEvents(sessionId.value)
    events.value = list
    // 从第一条有 executionId 的事件中提取，供 followup 使用
    if (!executionId.value) {
      const withExec = list.find(e => e.executionId)
      if (withExec) executionId.value = withExec.executionId
    }
  } catch (err) {
    ElMessage.error(`加载对话历史失败: ${(err as Error).message}`)
  } finally {
    loading.value = false
  }
}

// ─── 事件渲染辅助 ──────────────────────────────────────────────────────────────
/** 合并相邻的 model_delta 事件为连续文本块 */
interface TimelineItem {
  key: string
  type: 'text' | 'tool' | 'inbox_ask' | 'inbox_answer' | 'user' | 'system' | 'error' | 'final'
  timestamp: string
  events: ConversationEvent[]
  /** text 类型时合并的完整文本 */
  text?: string
  /** tool 类型时的工具名 */
  toolName?: string
  /** tool 类型的输入 */
  toolInput?: string
  /** tool 类型的输出（截断） */
  toolOutput?: string
  /** inbox 消息体 */
  message?: string
  /** 角色标签 */
  role?: string
  /** 时间线节点样式 */
  nodeClass?: string
  /** 时间线节点类型 */
  nodeType?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
}

const timeline = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = []
  let i = 0
  const evs = events.value

  while (i < evs.length) {
    const e = evs[i]

    if (e.eventType === 'model_delta') {
      // 合并相邻的 model_delta 事件
      const group: ConversationEvent[] = [e]
      let j = i + 1
      while (j < evs.length && evs[j].eventType === 'model_delta') {
        group.push(evs[j])
        j++
      }
      const text = group
        .map(ev => {
          const p = ev.payload as any
          return p?.text ?? p?.content ?? p?.delta ?? ''
        })
        .join('')
      items.push({
        key: `text-${e.id}`,
        type: 'text',
        timestamp: e.createdAt,
        events: group,
        text,
        role: e.role ?? 'assistant',
        nodeClass: 'node-text',
        nodeType: 'primary',
      })
      i = j
      continue
    }

    if (e.eventType === 'model_started') {
      items.push({
        key: `start-${e.id}`,
        type: 'system',
        timestamp: e.createdAt,
        events: [e],
        message: '模型开始生成',
        nodeClass: 'node-system',
        nodeType: 'info',
      })
      i++
      continue
    }

    if (e.eventType === 'tool_started' || e.eventType === 'tool_completed') {
      // 尝试配对 tool_started + tool_completed
      if (e.eventType === 'tool_started') {
        const pair: ConversationEvent[] = [e]
        const next = evs[i + 1]
        if (next && next.eventType === 'tool_completed') {
          pair.push(next)
          i += 2
        } else {
          i++
        }
        const p0 = e.payload as any
        const p1 = pair[1]?.payload as any
        items.push({
          key: `tool-${e.id}`,
          type: 'tool',
          timestamp: e.createdAt,
          events: pair,
          toolName: p0?.name ?? p0?.toolName ?? 'unknown_tool',
          toolInput: truncate(JSON.stringify(p0?.input ?? p0?.parameters ?? {}), 400),
          toolOutput: p1 ? truncate(JSON.stringify(p1?.output ?? p1?.result ?? {}), 400) : undefined,
          nodeClass: 'node-tool',
          nodeType: 'warning',
        })
        continue
      }
      // 单独的 tool_completed
      const p = e.payload as any
      items.push({
        key: `tool-${e.id}`,
        type: 'tool',
        timestamp: e.createdAt,
        events: [e],
        toolName: p?.name ?? p?.toolName ?? 'unknown_tool',
        toolOutput: truncate(JSON.stringify(p?.output ?? p?.result ?? {}), 400),
        nodeClass: 'node-tool',
        nodeType: 'warning',
      })
      i++
      continue
    }

    if (e.eventType === 'inbox_ask') {
      const p = e.payload as any
      items.push({
        key: `ask-${e.id}`,
        type: 'inbox_ask',
        timestamp: e.createdAt,
        events: [e],
        message: p?.question ?? p?.body ?? p?.text ?? '(Agent 提问)',
        nodeClass: 'node-inbox',
        nodeType: 'warning',
      })
      i++
      continue
    }

    if (e.eventType === 'inbox_answer') {
      const p = e.payload as any
      items.push({
        key: `ans-${e.id}`,
        type: 'inbox_answer',
        timestamp: e.createdAt,
        events: [e],
        message: p?.answer ?? p?.text ?? '(人类回答)',
        role: 'user',
        nodeClass: 'node-user',
        nodeType: 'success',
      })
      i++
      continue
    }

    if (e.eventType === 'error') {
      const p = e.payload as any
      items.push({
        key: `err-${e.id}`,
        type: 'error',
        timestamp: e.createdAt,
        events: [e],
        message: p?.message ?? p?.error ?? '(错误)',
        nodeClass: 'node-error',
        nodeType: 'danger',
      })
      i++
      continue
    }

    if (e.eventType === 'final_output') {
      const p = e.payload as any
      items.push({
        key: `final-${e.id}`,
        type: 'final',
        timestamp: e.createdAt,
        events: [e],
        text: p?.output ?? p?.text ?? '',
        nodeClass: 'node-final',
        nodeType: 'success',
      })
      i++
      continue
    }

    // 兜底：其他类型作为系统事件
    items.push({
      key: `sys-${e.id}`,
      type: 'system',
      timestamp: e.createdAt,
      events: [e],
      message: `${e.eventType}`,
      nodeClass: 'node-system',
      nodeType: 'info',
    })
    i++
  }

  return items
})

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return ts
  }
}

// ─── 人类追问 ──────────────────────────────────────────────────────────────────
async function submitFollowup() {
  const message = followupText.value.trim()
  if (!message) {
    ElMessage.warning('请输入追问内容')
    return
  }
  if (!executionId.value) {
    ElMessage.error('无法确定关联的执行实例，无法追问')
    return
  }
  followupBusy.value = true
  try {
    const res = await conversationsApi.followup(sessionId.value, executionId.value, message)
    followupText.value = ''
    if (res.success) {
      ElMessage.success('追问已发送')
      // 立即刷新对话历史
      await loadEvents()
    } else {
      ElMessage.warning(`追问已处理，但 Agent 未返回输出`)
    }
  } catch (err) {
    ElMessage.error(`追问失败: ${(err as Error).message}`)
  } finally {
    followupBusy.value = false
  }
}

// ─── 导航 ──────────────────────────────────────────────────────────────────────
function goBack() {
  router.back()
}

// ─── 生命周期 ──────────────────────────────────────────────────────────────────
watch(sessionId, () => {
  executionId.value = null
  events.value = []
  loadEvents()
})

onMounted(() => {
  loadEvents()
  // 每 3 秒自动刷新（对话进行中体验更好）
  refreshTimer = setInterval(() => {
    if (autoRefresh.value && !loading.value) {
      loadEvents()
    }
  }, 3000)
})
</script>

<template>
  <div class="conversation-view">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-button text @click="goBack">← 返回</el-button>
        <span class="title">对话历史</span>
        <span class="mono-id" :title="sessionId">#{{ sessionId.slice(-12) }}</span>
        <el-tag v-if="events.length" size="small" type="info" effect="plain">
          {{ events.length }} 事件
        </el-tag>
      </div>
      <div class="toolbar-right">
        <el-switch v-model="autoRefresh" active-text="自动刷新" size="small" />
        <el-button @click="loadEvents" :loading="loading">刷新</el-button>
      </div>
    </div>

    <!-- 对话时间线 -->
    <div class="timeline-wrap" v-loading="loading && !events.length">
      <el-empty v-if="!events.length && !loading" description="暂无对话记录" />

      <el-timeline v-else>
        <el-timeline-item
          v-for="item in timeline"
          :key="item.key"
          :timestamp="formatTime(item.timestamp)"
          :type="item.nodeType"
          placement="top"
        >
          <div class="tl-card" :class="item.nodeClass">
            <!-- Assistant 文本 -->
            <template v-if="item.type === 'text'">
              <div class="tl-role">Assistant</div>
              <div class="tl-text">{{ item.text }}</div>
            </template>

            <!-- 工具调用 -->
            <template v-else-if="item.type === 'tool'">
              <div class="tl-role">工具调用 · <code>{{ item.toolName }}</code></div>
              <div v-if="item.toolInput" class="tl-block">
                <div class="tl-block-label">输入</div>
                <pre class="tl-pre">{{ item.toolInput }}</pre>
              </div>
              <div v-if="item.toolOutput !== undefined" class="tl-block">
                <div class="tl-block-label">输出</div>
                <pre class="tl-pre">{{ item.toolOutput }}</pre>
              </div>
            </template>

            <!-- Agent 提问 -->
            <template v-else-if="item.type === 'inbox_ask'">
              <div class="tl-role">🗨️ Agent 提问</div>
              <div class="tl-text">{{ item.message }}</div>
            </template>

            <!-- 人类回答 -->
            <template v-else-if="item.type === 'inbox_answer'">
              <div class="tl-role">👤 人类回答</div>
              <div class="tl-text">{{ item.message }}</div>
            </template>

            <!-- 最终输出 -->
            <template v-else-if="item.type === 'final'">
              <div class="tl-role">✨ 最终输出</div>
              <div class="tl-text tl-final">{{ item.text }}</div>
            </template>

            <!-- 错误 -->
            <template v-else-if="item.type === 'error'">
              <div class="tl-role tl-error">⚠️ 错误</div>
              <div class="tl-text tl-error-text">{{ item.message }}</div>
            </template>

            <!-- 系统事件 -->
            <template v-else>
              <div class="tl-role tl-muted">{{ item.message }}</div>
            </template>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>

    <!-- 底部追问表单 -->
    <div class="followup-bar">
      <div class="followup-label">
        <span>👤 人类追问</span>
        <span class="hint" v-if="!executionId">⚠️ 尚未关联执行实例，无法追问</span>
        <span class="hint" v-else>使用 --resume 恢复当前会话</span>
      </div>
      <el-input
        v-model="followupText"
        type="textarea"
        :rows="3"
        placeholder="输入你想让 Agent 继续处理的内容…"
        :disabled="followupBusy || !executionId"
        @keydown.meta.enter="submitFollowup"
        @keydown.ctrl.enter="submitFollowup"
      />
      <div class="followup-actions">
        <span class="hint">⌘/Ctrl + Enter 发送</span>
        <el-button
          type="primary"
          :loading="followupBusy"
          :disabled="!followupText.trim() || !executionId"
          @click="submitFollowup"
        >
          发送追问
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conversation-view {
  padding: 20px;
  min-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  flex-wrap: wrap;
}
.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.mono-id {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 8px;
  background: var(--el-fill-color);
  border-radius: 4px;
  color: var(--el-text-color-regular);
}

.timeline-wrap {
  flex: 1;
  padding: 20px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  min-height: 300px;
  overflow-x: auto;
}

.tl-card {
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  border-top: 2px solid var(--el-border-color);
}
.tl-card.node-text { border-top-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.tl-card.node-tool { border-top-color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.tl-card.node-inbox { border-top-color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.tl-card.node-user { border-top-color: var(--el-color-success); background: var(--el-color-success-light-9); }
.tl-card.node-final { border-top-color: var(--el-color-success); background: var(--el-color-success-light-9); }
.tl-card.node-error { border-top-color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.tl-card.node-system { border-top-color: var(--el-border-color); opacity: 0.75; }

.tl-role {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.tl-role code {
  font-family: var(--font-mono);
  color: var(--el-color-warning);
  background: transparent;
  padding: 0 2px;
}
.tl-role.tl-error, .tl-role.tl-muted { text-transform: none; }

.tl-text {
  font-size: 14px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.tl-text.tl-final {
  font-weight: 500;
  padding: 8px 10px;
  background: var(--el-bg-color-overlay);
  border-radius: 6px;
}
.tl-text.tl-error-text {
  color: var(--el-color-danger);
  font-family: var(--font-mono);
  font-size: 13px;
}

.tl-block {
  margin-top: 8px;
}
.tl-block-label {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 3px;
}
.tl-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

/* 底部追问表单 */
.followup-bar {
  padding: 16px 20px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.followup-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.followup-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.hint {
  font-size: 12px;
  font-weight: normal;
  color: var(--el-text-color-placeholder);
}

/* 响应式 */
@media (max-width: 640px) {
  .conversation-view { padding: 12px; }
  .toolbar { padding: 10px 14px; }
  .title { font-size: 16px; }
  .timeline-wrap { padding: 14px; }
}
</style>
