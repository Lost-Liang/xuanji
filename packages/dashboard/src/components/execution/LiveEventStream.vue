<template>
  <div class="live-stream">
    <div class="ls-header">
      <span class="ls-title">实时事件流</span>
      <span class="ls-meta" :class="state">{{ stateLabel }}</span>
    </div>
    <div class="ls-body" ref="bodyRef" @scroll="onScroll">
      <!-- 提问卡片 - 只显示输入框，内容已在事件流中渲染 -->
      <div v-for="elicit in pendingElicitations" :key="elicit.id" class="elicit-card">
        <div v-if="elicit.requested_schema" class="elicit-form">
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
          <el-input v-model="elicitAnswers[elicit.id]" type="textarea" :rows="3" placeholder="输入回复..." />
        </div>
        <div class="elicit-actions">
          <el-button type="primary" size="small" :loading="isSubmitting(elicit.id)" :disabled="isSubmitting(elicit.id)" @click="submitAnswer(elicit)">提交回复</el-button>
          <el-button v-if="isDialogType(elicit)" size="small" type="warning" plain :loading="isSubmitting(elicit.id)" :disabled="isSubmitting(elicit.id)" @click="skipElicitation(elicit)">结束对话（采用当前结果）</el-button>
          <el-button v-else size="small" :loading="isSubmitting(elicit.id)" :disabled="isSubmitting(elicit.id)" @click="skipElicitation(elicit)">跳过</el-button>
        </div>
      </div>
      <div v-if="!events.length && state==='idle'" class="ls-empty">输入 execution ID 后连接</div>
      <div v-else-if="!events.length && state==='open'" class="ls-empty">等待事件…</div>
      <div v-else-if="!events.length && state==='error'" class="ls-empty">连接失败，请检查 execution ID 或后端 SSE</div>
      <div v-for="(e, i) in events" :key="i" class="ls-msg" :class="`t-${e.type}`">
        <div v-if="e.type === 'done'" class="ls-done">
          <span class="ls-done-node" :title="e.node_id">{{ e.node_id }}</span>
          <el-tag size="small" type="success">完成</el-tag>
        </div>
        <div v-else class="ls-bubble">
          <div class="ls-msg-head">
            <span class="ls-node" :title="e.node_id">{{ e.node_id }}</span>
            <span class="ls-time">{{ e.ts }}</span>
          </div>
          <!-- 性能优化：延迟渲染 markdown，使用 renderedHtml 而非实时解析 -->
          <div v-if="e.text" class="ls-md" :id="'md-' + i" v-html="getRenderedHtml(i, e.text)"></div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onUnmounted, shallowRef } from 'vue'
import { marked } from 'marked'

const props = defineProps<{ executionId?: string }>()

// Elicitation 状态
const pendingElicitations = ref<any[]>([])
const elicitAnswers = ref<Record<string, any>>({})
const submittingIds = ref(new Set<string>())  // 防双击：正在提交的 elicit id

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

// 判断是否是对话类型（无 requested_schema 或 id 以 dialog- 开头）
function isDialogType(elicit: any): boolean {
  return elicit.id?.startsWith('dialog-') || !elicit.requested_schema
}

// 提交回复
async function submitAnswer(elicit: any) {
  // 防双击：已在提交中则忽略
  if (submittingIds.value.has(elicit.id)) return
  submittingIds.value.add(elicit.id)

  const answer = elicitAnswers.value[elicit.id]
  // 获取消息内容：如果是字符串直接用，如果是对象取 text 字段
  const message = typeof answer === 'string' ? answer.trim() : (answer?.text || '').trim()

  // 区分 dialog 类型（简单对话）和 elicitation 类型（系统级审批）
  if (isDialogType(elicit)) {
    // 检查是否有有效消息
    if (!message) {
      // 没有输入内容，提示用户
      submittingIds.value.delete(elicit.id)
      return
    }
    // 使用 /dialog 端点
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
    // 使用 /elicitations/:id/reply 端点（系统级 elicitation）
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
  // 防双击
  if (submittingIds.value.has(elicit.id)) return
  submittingIds.value.add(elicit.id)

  if (isDialogType(elicit)) {
    // 使用 /dialog 端点跳过
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
    // 本地移除
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

// 性能优化：使用 Map 存储已渲染的 HTML，避免重复解析
const renderedHtmlMap = new Map<number, string>()
// 记录哪些索引需要渲染（滚动到可见时渲染）
const pendingRender = new Set<number>()

// 延迟渲染队列
let renderQueueTimer: ReturnType<typeof requestIdleCallback> | number | null = null

// 获取渲染后的 HTML（延迟渲染策略）
function getRenderedHtml(index: number, text: string): string {
  // 如果已经渲染过，直接返回
  const cached = renderedHtmlMap.get(index)
  if (cached) return cached

  // 如果文本很短（<500字符），直接渲染
  if (text.length < 500) {
    const html = marked.parse(text) as string
    renderedHtmlMap.set(index, html)
    return html
  }

  // 长文本：加入待渲染队列，先返回纯文本
  pendingRender.add(index)
  scheduleRender()

  // 先返回纯文本占位（转义 HTML）
  return escapeHtml(text.slice(0, 200)) + (text.length > 200 ? '...' : '')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// 调度延迟渲染（使用 requestIdleCallback）
function scheduleRender() {
  if (renderQueueTimer) return

  // @ts-ignore - requestIdleCallback 可能不存在
  if (typeof requestIdleCallback !== 'undefined') {
    // @ts-ignore
    renderQueueTimer = requestIdleCallback(processRenderQueue, { timeout: 500 })
  } else {
    renderQueueTimer = window.setTimeout(processRenderQueue, 100) as unknown as number
  }
}

// 处理渲染队列
function processRenderQueue() {
  renderQueueTimer = null
  if (pendingRender.size === 0) return

  // 取出待渲染的索引
  const indices = Array.from(pendingRender)
  pendingRender.clear()

  // 批量渲染
  for (const index of indices) {
    const event = events.value[index]
    if (event?.text && !renderedHtmlMap.has(index)) {
      const html = marked.parse(event.text) as string
      renderedHtmlMap.set(index, html)
    }
  }

  // 触发重新渲染
  events.value = [...events.value]
}

type Ev = { ts: string; node_id: string; type: 'token' | 'done'; text?: string }
const events = shallowRef<Ev[]>([])
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

// 性能优化：直接处理 SSE token（服务端已聚合），使用 throttle 减少渲染频率
let lastUpdateTime = 0
const UPDATE_THROTTLE_MS = 200  // 最小更新间隔 200ms
let pendingUpdate = false

function pushToken(nodeId: string, text: string, ts: string) {
  const top = events.value[0]
  if (top && top.type === 'token' && top.node_id === nodeId) {
    // 更新现有事件的文本（直接修改，不创建新数组）
    top.text = (top.text || '') + text
    top.ts = ts
    // 清除该索引的 markdown 缓存
    renderedHtmlMap.delete(0)
  } else {
    // 新建事件
    const newEvent: Ev = { ts, node_id: nodeId, type: 'token', text }
    // 使用 splice 而不是创建新数组
    events.value.splice(0, 0, newEvent)
    // 限制最大数量
    if (events.value.length > 200) {
      events.value.splice(200)
    }
    // 清除所有缓存的索引
    renderedHtmlMap.clear()
  }

  // 节流渲染
  const now = performance.now()
  if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
    lastUpdateTime = now
    // 触发重新渲染（使用浅拷贝触发 shallowRef 更新）
    events.value = [...events.value]
    pendingUpdate = false
  } else if (!pendingUpdate) {
    pendingUpdate = true
    setTimeout(() => {
      if (pendingUpdate) {
        lastUpdateTime = performance.now()
        events.value = [...events.value]
        pendingUpdate = false
      }
    }, UPDATE_THROTTLE_MS)
  }
}

// 滚动时触发可见区域的 markdown 渲染
function onScroll() {
  // 如果有待渲染的项目，立即处理
  if (pendingRender.size > 0) {
    scheduleRender()
  }
}

function open(id: string) {
  close()
  renderedHtmlMap.clear()
  pendingRender.clear()
  if (!id) { setState('idle'); return }
  // 先拉历史事件并聚合成气泡
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
          agg.push({ ts: timeFromISO(e.created_at), node_id: e.node_id, type: 'done' })
        }
      }
      events.value = agg.reverse()  // 最新的气泡在最上
    })
    .catch(() => {})
  try {
    es = new EventSource(`/api/executions/${encodeURIComponent(id)}/stream`)
    es.onopen = () => setState('open')
    es.onerror = () => {
      if (es && es.readyState === EventSource.CLOSED) {
        if (events.value.length > 0) setState('open')
        else setState('error')
      }
    }
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data) as { node_id: string; type: 'token' | 'done' | 'execution_done'; text?: string; status?: string }
        if (d.type === 'execution_done') {
          setState('open')
          // execution_done 时拉取 elicitation（可能有待回复的提问）
          if (d.status === 'waiting' || d.status === 'paused') {
            fetchElicitations()
          }
          return
        }
        if (d.type === 'done') {
          events.value = [{ ts: nowStr(), node_id: d.node_id, type: 'done' }, ...events.value.slice(0, 199)]
          renderedHtmlMap.clear() // 数组变了，清除缓存
        } else if (d.type === 'token') {
          pushToken(d.node_id, d.text || '', nowStr())
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
  renderedHtmlMap.clear()
  open(id || '')
  fetchElicitations()
}, { immediate: true })

onUnmounted(() => {
  close()
  if (renderQueueTimer) {
    // @ts-ignore
    if (typeof cancelIdleCallback !== 'undefined') {
      // @ts-ignore
      cancelIdleCallback(renderQueueTimer)
    } else {
      clearTimeout(renderQueueTimer)
    }
    renderQueueTimer = null
  }
})
</script>
<style scoped>
.live-stream { display: flex; flex-direction: column; height: 100%; min-height: 0; border-left: 1px solid var(--border); background: var(--panel); overflow: hidden; }
.ls-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ls-title { font-size: 12px; font-weight: 600; color: var(--text); font-family: var(--font-ui); }
.ls-meta { font-size: 10px; padding: 2px 7px; border-radius: 4px; background: var(--surface); color: var(--muted); font-family: var(--font-mono); }
.ls-meta.open { background: rgba(34,197,94,.12); color: var(--st-done); }
.ls-meta.open::before { content: '● '; }
.ls-meta.error { background: rgba(239,68,68,.12); color: var(--st-failed); }
.ls-body { flex: 1; min-height: 0; overflow-y: auto; padding: 11px 12px; }
.ls-empty { font-size: 12px; color: var(--faint); text-align: center; padding: 24px 0; }

.ls-msg { margin-bottom: 11px; content-visibility: auto; contain: content; }
/* content-visibility: auto - 浏览器可跳过不可见内容的布局/渲染 */
/* contain: content - 隔离 DOM 更新影响，防止全局重绘 */
.ls-done { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 5px 9px; margin: 4px 0; border-radius: var(--radius-sm); background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.25); }
.ls-done-node { font-size: 11px; color: var(--st-done); font-family: var(--font-mono); }

.ls-bubble { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 10px; overflow: hidden; }
.ls-msg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.ls-node { font-size: 11px; font-weight: 600; color: var(--accent); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.ls-time { font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; flex-shrink: 0; font-family: var(--font-mono); }

/* —— agent markdown 渲染区 —— */
.ls-md { font-size: 12.5px; line-height: 1.7; color: var(--text); word-break: break-word; overflow-wrap: break-word; }
.ls-md > :first-child { margin-top: 0; }
.ls-md > :last-child { margin-bottom: 0; }
.ls-md p { margin: 6px 0; }
.ls-md h1, .ls-md h2, .ls-md h3, .ls-md h4, .ls-md h5, .ls-md h6 {
  font-family: var(--font-ui); color: var(--text); margin: 10px 0 5px; font-weight: 600; line-height: 1.35;
}
.ls-md h1 { font-size: 15px; } .ls-md h2 { font-size: 14px; } .ls-md h3 { font-size: 13px; }
.ls-md h4, .ls-md h5, .ls-md h6 { font-size: 12.5px; color: var(--accent); }
.ls-md ul, .ls-md ol { margin: 6px 0; padding-left: 20px; }
.ls-md li { margin: 2px 0; }
.ls-md strong { color: var(--text); font-weight: 600; }
.ls-md a { color: var(--accent); text-decoration: none; }
.ls-md a:hover { text-decoration: underline; }
.ls-md blockquote { margin: 6px 0; padding: 2px 10px; border-left: 2px solid var(--accent-dim); color: var(--muted); }
.ls-md code { font-family: var(--font-mono); font-size: 11.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; color: var(--accent); }
.ls-md pre { margin: 8px 0; padding: 8px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow-x: auto; }
.ls-md pre code { font-family: var(--font-mono); font-size: 11.5px; background: none; border: none; padding: 0; color: var(--text); line-height: 1.6; }
.ls-md table { display: block; width: max-content; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.ls-md th, .ls-md td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; white-space: nowrap; }
.ls-md th { background: var(--surface-2); color: var(--muted); font-weight: 600; }
.ls-md hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }

/* 提问卡片 */
.elicit-card {
  background: var(--surface);
  border: 2px solid var(--accent);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 12px;
}
.elicit-label {
  font-weight: 600;
  color: var(--accent);
}
.elicit-question {
  margin-bottom: 12px;
  line-height: 1.5;
}
.elicit-form, .elicit-input {
  margin-bottom: 12px;
}
.elicit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>