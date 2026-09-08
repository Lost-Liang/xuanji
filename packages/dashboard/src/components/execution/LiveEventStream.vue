<template>
  <div class="live-stream">
    <div class="ls-header">
      <span class="ls-title">执行日志</span>
      <span class="ls-meta" :class="state">{{ stateLabel }}</span>
    </div>
    <div class="ls-body" ref="bodyRef">
      <!-- 提问卡片 -->
      <div v-for="elicit in pendingElicitations" :key="elicit.id" class="elicit-card">
        <!-- 有预设选项时显示选项按钮 -->
        <div v-if="elicit.choices && elicit.choices.length > 0" class="elicit-choices">
          <p class="elicit-question">{{ elicit.body }}</p>
          <div class="choice-buttons">
            <el-button
              v-for="(choice, idx) in elicit.choices"
              :key="idx"
              :type="elicitAnswers[elicit.id] === choice ? 'primary' : 'default'"
              size="small"
              @click="elicitAnswers[elicit.id] = choice"
            >
              {{ choice }}
            </el-button>
          </div>
        </div>
        <div v-else-if="elicit.requested_schema" class="elicit-form">
          <el-form :model="elicitAnswers[elicit.id]" label-position="top">
            <el-form-item
              v-for="field in parseSchema(elicit.requested_schema)"
              :key="field.key"
              :label="field.label"
            >
              <el-input v-if="field.type === 'string'" v-model="elicitAnswers[elicit.id][field.key]" />
              <el-select v-else-if="field.type === 'enum'" v-model="elicitAnswers[elicit.id][field.key]">
                <el-option v-for="opt in field.options" :key="opt" :label="opt" :value="opt" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
        <div v-else class="elicit-input">
          <p class="elicit-question">{{ elicit.body }}</p>
          <el-input v-model="elicitAnswers[elicit.id]" type="textarea" :rows="3" placeholder="输入回复..." />
        </div>
        <div class="elicit-actions">
          <el-button type="primary" size="small" :loading="isSubmitting(elicit.id)" :disabled="isSubmitting(elicit.id) || !elicitAnswers[elicit.id]" @click="submitAnswer(elicit)">提交回复</el-button>
          <el-button v-if="isDialogType(elicit)" size="small" type="warning" plain :loading="isSubmitting(elicit.id)" :disabled="isSubmitting(elicit.id)" @click="skipElicitation(elicit)">结束对话</el-button>
          <el-button v-else size="small" :loading="isSubmitting(elicit.id)" :disabled="isSubmitting(elicit.id)" @click="skipElicitation(elicit)">跳过</el-button>
        </div>
      </div>

      <div v-if="!messages.length && state==='idle'" class="ls-empty">选择执行实例后连接</div>
      <div v-else-if="!messages.length && state==='open'" class="ls-empty">等待事件…</div>
      <div v-else-if="!messages.length && state==='error'" class="ls-empty">连接失败</div>

      <!-- 按时间顺序显示对话 -->
      <div class="message-list">
        <div v-for="(msg, idx) in messages" :key="idx" class="message" :class="msg.role">
          <div class="msg-header">
            <span class="msg-role">{{ msg.roleLabel }}</span>
            <span class="msg-time">{{ msg.ts }}</span>
          </div>
          <div class="msg-content" v-html="renderMarkdown(msg.text)"></div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue'
import { marked } from 'marked'

const props = defineProps<{ executionId?: string }>()

// Elicitation 状态
const pendingElicitations = ref<any[]>([])
const elicitAnswers = ref<Record<string, any>>({})
const submittingIds = ref(new Set<string>())

// 获取待回复的提问
async function fetchElicitations() {
  if (!props.executionId) return
  try {
    const r = await fetch(`/api/executions/${props.executionId}/elicitations`)
    pendingElicitations.value = await r.json()
  } catch { /* 忽略 */ }
}

// 防双击：检查是否正在提交
function isSubmitting(id: string) {
  return submittingIds.value.has(id)
}

// 判断是否是对话类型
function isDialogType(elicit: any): boolean {
  return elicit.id?.startsWith('dialog-') || !elicit.requested_schema
}

// 提交回复
async function submitAnswer(elicit: any) {
  if (submittingIds.value.has(elicit.id)) return
  submittingIds.value.add(elicit.id)

  const answer = elicitAnswers.value[elicit.id]
  const message = typeof answer === 'string' ? answer.trim() : (answer?.text || '').trim()

  if (isDialogType(elicit)) {
    if (!message) {
      submittingIds.value.delete(elicit.id)
      return
    }
    try {
      await fetch(`/api/executions/${props.executionId}/dialog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      delete elicitAnswers.value[elicit.id]
      await fetchElicitations()
    } catch { /* 忽略 */ }
    finally { submittingIds.value.delete(elicit.id) }
  } else {
    try {
      await fetch(`/api/executions/${props.executionId}/elicitations/${elicit.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: { action: 'accept', content: answer } }),
      })
      delete elicitAnswers.value[elicit.id]
      await fetchElicitations()
    } catch { /* 忽略 */ }
    finally { submittingIds.value.delete(elicit.id) }
  }
}

// 跳过提问
async function skipElicitation(elicit: any) {
  if (submittingIds.value.has(elicit.id)) return
  submittingIds.value.add(elicit.id)

  if (isDialogType(elicit)) {
    try {
      await fetch(`/api/executions/${props.executionId}/dialog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      })
      await fetchElicitations()
    } catch { /* 忽略 */ }
    finally { submittingIds.value.delete(elicit.id) }
  } else {
    const idx = pendingElicitations.value.findIndex(e => e.id === elicit.id)
    if (idx !== -1) pendingElicitations.value.splice(idx, 1)
    submittingIds.value.delete(elicit.id)
  }
}

// 解析 requestedSchema
function parseSchema(schema: any): Array<{ key: string; label: string; type: string; options?: string[] }> {
  if (!schema?.properties) return []
  return Object.entries(schema.properties).map(([key, prop]: [string, any]) => ({
    key,
    label: key,
    type: prop.enum ? 'enum' : 'string',
    options: prop.enum,
  }))
}

type Ev = { ts: string; node_id: string; type: 'token' | 'done' | 'inbox_ask' | 'inbox_answer'; text?: string; id?: string }
const events = ref<Ev[]>([])
const state = ref<'idle' | 'open' | 'error'>('idle')
const bodyRef = ref<HTMLElement | null>(null)
let es: EventSource | null = null

const stateLabel = ref('未连接')
function setState(s: 'idle' | 'open' | 'error') {
  state.value = s
  stateLabel.value = s === 'open' ? '已连接' : s === 'error' ? '连接错误' : '未连接'
}

function nowStr() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
function timeFromISO(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  } catch { return nowStr() }
}

// 渲染 markdown
function renderMarkdown(text: string | undefined): string {
  if (!text) return ''
  return marked.parse(text) as string
}

// 转换为消息列表（按时间倒序）
interface Message {
  role: 'assistant' | 'human' | 'system'
  roleLabel: string
  ts: string
  text: string
}

const messages = computed(() => {
  const result: Message[] = []

  // 如果有 pendingElicitations，不显示 inbox_ask 消息（避免重复）
  const hasPendingElicitations = pendingElicitations.value.length > 0

  // 倒序遍历（events 本身是倒序的，最新的在前面）
  for (const e of events.value) {
    if (e.type === 'inbox_ask') {
      // 如果有 elicitations 显示区域，跳过消息列表中的显示
      if (!hasPendingElicitations) {
        result.push({
          role: 'system',
          roleLabel: '🤔 AI 提问',
          ts: e.ts,
          text: e.text || '',
        })
      }
    } else if (e.type === 'inbox_answer') {
      result.push({
        role: 'human',
        roleLabel: '👤 你的回答',
        ts: e.ts,
        text: e.text || '',
      })
    } else if (e.type === 'token' && e.text && e.text.length > 0) {
      result.push({
        role: 'assistant',
        roleLabel: '🤖 AI',
        ts: e.ts,
        text: e.text,
      })
    }
  }

  return result
})

// SSE 处理
function open(id: string) {
  close()
  if (!id) { setState('idle'); return }

  // 先拉历史事件
  fetch(`/api/executions/${encodeURIComponent(id)}/events`)
    .then(r => r.json())
    .then((list: any[]) => {
      const agg: Ev[] = []
      for (const e of list) {
        if (e.type === 'token') {
          const last = agg[agg.length - 1]
          if (last && last.type === 'token' && last.node_id === e.node_id) {
            last.text = (last.text || '') + (e.text || '')
            last.ts = timeFromISO(e.created_at)
          } else {
            agg.push({ ts: timeFromISO(e.created_at), node_id: e.node_id, type: 'token', text: e.text || '' })
          }
        } else if (e.type === 'done') {
          agg.push({ ts: timeFromISO(e.created_at), node_id: e.node_id, type: 'done', text: e.text || '' })
        } else if (e.type === 'inbox_ask' || e.type === 'inbox_answer') {
          agg.push({ ts: timeFromISO(e.created_at), node_id: e.type, type: e.type, text: e.text || '' })
        }
      }
      events.value = agg.reverse()
      // 历史事件加载完成后，如果有数据，设置状态为 open
      if (agg.length > 0) {
        setState('open')
      }
    })
    .catch(() => {})

  try {
    es = new EventSource(`/api/executions/${encodeURIComponent(id)}/stream`)
    es.onopen = () => setState('open')
    es.onerror = () => {
      // SSE 关闭时不再设置 error，让 fetch('/events') 的结果决定状态
      // 如果执行已完成，SSE 会返回 execution_done 后关闭
      // 历史事件应该在 fetch 完成后正确显示
      if (es && es.readyState === EventSource.CLOSED) {
        // SSE 已关闭，但不要覆盖状态
        // 如果 fetch 还没完成，它会在完成后设置正确的状态
        // 如果 fetch 已经完成，events.value 已经有数据
      }
    }
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data) as { node_id: string; type: 'token' | 'done' | 'execution_done' | 'inbox_ask' | 'inbox_answer'; text?: string; status?: string }
        if (d.type === 'execution_done') {
          setState('open')
          if (d.status === 'waiting' || d.status === 'paused') {
            fetchElicitations()
          }
          return
        }
        if (d.type === 'done') {
          events.value = [{ ts: nowStr(), node_id: d.node_id, type: 'done', text: d.text || '' }, ...events.value.slice(0, 199)]
        } else if (d.type === 'inbox_ask') {
          // 去重：检查是否已存在相同文本的 inbox_ask
          const exists = events.value.some(e => e.type === 'inbox_ask' && e.text === d.text)
          if (!exists) {
            events.value = [{ ts: nowStr(), node_id: d.type, type: d.type, text: d.text || '' }, ...events.value.slice(0, 199)]
          }
          // 收到提问时，获取问题详情（包含 choices）
          fetchElicitations()
        } else if (d.type === 'inbox_answer') {
          // 去重：检查是否已存在相同文本的 inbox_answer
          const exists = events.value.some(e => e.type === 'inbox_answer' && e.text === d.text)
          if (!exists) {
            events.value = [{ ts: nowStr(), node_id: d.type, type: d.type, text: d.text || '' }, ...events.value.slice(0, 199)]
          }
        } else if (d.type === 'token') {
          const top = events.value[0]
          if (top && top.type === 'token' && top.node_id === d.node_id) {
            // 替换整个数组元素以触发响应式更新
            events.value = [
              { ...top, text: (top.text || '') + (d.text || ''), ts: nowStr() },
              ...events.value.slice(1, 199)
            ]
          } else {
            events.value = [{ ts: nowStr(), node_id: d.node_id, type: 'token', text: d.text || '' }, ...events.value.slice(0, 199)]
          }
        }
      } catch { /* 忽略坏帧 */ }
    }
  } catch {
    setState('error')
  }
}

function close() {
  if (es) { es.close(); es = null }
}

watch(() => props.executionId, (id) => {
  events.value = []
  open(id || '')
  fetchElicitations()
}, { immediate: true })

onUnmounted(() => {
  close()
})
</script>
<style scoped>
.live-stream {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--panel);
  overflow: hidden;
}

.ls-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.ls-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.ls-meta {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--surface);
  color: var(--muted);
}

.ls-meta.open {
  background: rgba(34, 197, 94, 0.12);
  color: var(--st-done);
}

.ls-meta.open::before {
  content: '● ';
}

.ls-meta.error {
  background: rgba(239, 68, 68, 0.12);
  color: var(--st-failed);
}

.ls-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.ls-empty {
  font-size: 12px;
  color: var(--faint);
  text-align: center;
  padding: 24px 0;
}

/* 消息列表 */
.message-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.message.assistant {
  border-left: 3px solid var(--accent);
}

.message.human {
  border-left: 3px solid var(--st-done);
  background: rgba(34, 197, 94, 0.03);
}

.message.system {
  border-left: 3px solid #f59e0b;
  background: rgba(245, 158, 11, 0.03);
}

.msg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.msg-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}

.msg-time {
  font-size: 10px;
  color: var(--faint);
}

.msg-content {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}

.msg-content :deep(p) {
  margin: 4px 0;
}

.msg-content :deep(ul),
.msg-content :deep(ol) {
  margin: 4px 0;
  padding-left: 16px;
}

.msg-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}

.msg-content :deep(pre) {
  background: var(--surface-2);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 6px 0;
}

.msg-content :deep(h1),
.msg-content :deep(h2),
.msg-content :deep(h3) {
  font-size: 13px;
  font-weight: 600;
  margin: 8px 0 4px;
}

/* 提问卡片 */
.elicit-card {
  background: var(--surface);
  border: 2px solid var(--accent);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.elicit-form,
.elicit-input,
.elicit-choices {
  margin-bottom: 12px;
}

.elicit-question {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.choice-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.choice-buttons .el-button {
  width: 100%;
  white-space: normal;
  text-align: left;
  height: auto;
  padding: 10px 14px;
  line-height: 1.4;
  justify-content: flex-start;
  margin: 0;
}

.elicit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>