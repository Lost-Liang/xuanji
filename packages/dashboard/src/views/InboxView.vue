<script setup lang="ts">
// packages/dashboard/src/views/InboxView.vue —— 人机交互：待回答问题列表
//
// 轮询 GET /api/inbox/pending 获取 Agent 通过 inbox_ask 提出的待回答问题。
// 用户在表格行展开的回答表单中提交答案，Core 通过 notifyHumanAnswered() 解除
// agent-node 中 waitForHumanAnswer 的阻塞，Agent 在同一 CLI 会话中继续执行。
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inboxApi, type InboxQuestion } from '../api/inbox'

const router = useRouter()

// ─── 状态 ─────────────────────────────────────────────────────────────────────
const questions = ref<InboxQuestion[]>([])
const loading = ref(false)
const answeringIds = ref<Set<string>>(new Set())  // 正在提交回答的问题 ID
const answerDrafts = ref<Record<string, string>>({})  // 每个问题的回答草稿
const polling = ref(true)
let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 5_000  // 轮询间隔 5 秒

// ─── 计算属性 ──────────────────────────────────────────────────────────────────
const pendingCount = computed(() => questions.value.length)
const oldestAge = computed(() => {
  if (!questions.value.length) return null
  const oldest = new Date(questions.value[0].createdAt).getTime()
  const seconds = Math.floor((Date.now() - oldest) / 1000)
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
})

// ─── 数据加载 ──────────────────────────────────────────────────────────────────
async function loadPending() {
  try {
    const list = await inboxApi.getPending()
    // 保留用户正在编辑的回答草稿（避免轮询覆盖输入框）
    questions.value = list
  } catch (err) {
    // 静默失败，避免轮询错误频繁弹出 Message
    console.warn('[inbox] 加载失败:', (err as Error).message)
  } finally {
    loading.value = false
  }
}

function startPolling() {
  stopPolling()
  polling.value = true
  pollTimer = setInterval(loadPending, POLL_INTERVAL_MS)
}

function stopPolling() {
  polling.value = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ─── 回答提交 ──────────────────────────────────────────────────────────────────
async function submitAnswer(q: InboxQuestion) {
  const answer = (answerDrafts.value[q.id] ?? '').trim()
  if (!answer) {
    ElMessage.warning('请输入回答内容')
    return
  }

  answeringIds.value.add(q.id)
  try {
    const res = await inboxApi.answer(q.id, answer)
    // 从列表中移除已回答的问题
    questions.value = questions.value.filter(item => item.id !== q.id)
    delete answerDrafts.value[q.id]

    if (res._notified === false) {
      // Agent 已不在等待（可能超时），但 DB 已更新
      ElMessage.warning({
        message: '回答已保存，但 Agent 已不再等待（可能已超时）',
        duration: 5000,
      })
    } else {
      ElMessage.success('回答已发送，Agent 将继续执行')
    }
  } catch (err) {
    ElMessage.error(`提交失败: ${(err as Error).message}`)
  } finally {
    answeringIds.value.delete(q.id)
  }
}

function isAnswering(id: string): boolean {
  return answeringIds.value.has(id)
}

function getDraft(id: string): string {
  return answerDrafts.value[id] ?? ''
}

function setDraft(id: string, value: string) {
  answerDrafts.value[id] = value
}

// ─── 导航 ──────────────────────────────────────────────────────────────────────
function openConversation(q: InboxQuestion) {
  if (q.sessionId) {
    router.push(`/conversations/${encodeURIComponent(q.sessionId)}`)
  } else {
    ElMessage.info('该问题尚未关联会话')
  }
}

// ─── 生命周期 ──────────────────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true
  await loadPending()
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="inbox-view">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="title">人机交互</span>
        <el-tag v-if="pendingCount > 0" type="danger" effect="dark" round>
          {{ pendingCount }} 待回答
        </el-tag>
        <el-tag v-else type="success" effect="plain" round>暂无待回答问题</el-tag>
        <span v-if="oldestAge && pendingCount > 0" class="oldest-hint">
          最早问题: {{ oldestAge }}
        </span>
      </div>
      <div class="toolbar-right">
        <el-switch
          v-model="polling"
          active-text="轮询"
          inactive-text="暂停"
          @change="(v: boolean) => (v ? startPolling() : stopPolling())"
        />
        <el-button @click="loadPending" :loading="loading">刷新</el-button>
      </div>
    </div>

    <!-- 问题列表 -->
    <div class="list-wrap" v-loading="loading && !questions.length">
      <el-empty v-if="!questions.length && !loading" description="暂无待回答问题">
        <template #image>
          <div class="empty-icon">💬</div>
        </template>
        <p class="empty-tip">Agent 提问后会在此处显示，回答后 Agent 将继续执行</p>
      </el-empty>

      <div v-else class="question-list">
        <div
          v-for="q in questions"
          :key="q.id"
          class="question-card"
        >
          <!-- 头部：元信息 + 操作 -->
          <div class="card-header">
            <div class="meta">
              <el-tag size="small" type="warning" effect="light">待回答</el-tag>
              <span class="mono-id" :title="q.id">#{{ q.id.slice(-8) }}</span>
              <span v-if="q.executionId" class="mono-id" :title="q.executionId">
                任务 #{{ q.executionId.slice(-8) }}
              </span>
              <span class="time">{{ new Date(q.createdAt).toLocaleString('zh-CN') }}</span>
            </div>
            <div class="actions">
              <el-button
                v-if="q.sessionId"
                size="small"
                text
                @click="openConversation(q)"
              >
                查看对话
              </el-button>
            </div>
          </div>

          <!-- 问题正文 -->
          <div class="card-body">
            <div class="question-label">Agent 提问</div>
            <div class="question-text">{{ q.body }}</div>

            <!-- 可选选项（choices 非空时以按钮形式展示） -->
            <div v-if="q.choices && q.choices.length" class="choices">
              <div class="question-label">可选答案</div>
              <div class="choice-list">
                <el-button
                  v-for="(choice, idx) in q.choices"
                  :key="idx"
                  size="small"
                  @click="setDraft(q.id, choice)"
                >
                  {{ choice }}
                </el-button>
              </div>
            </div>
          </div>

          <!-- 回答表单（常驻展开） -->
          <div class="card-footer">
            <div class="answer-form">
              <el-input
                type="textarea"
                :model-value="getDraft(q.id)"
                @update:model-value="(v: string | number) => setDraft(q.id, String(v))"
                :rows="3"
                placeholder="输入你的回答，Agent 将基于此继续执行…"
                :disabled="isAnswering(q.id)"
                @keydown.meta.enter="submitAnswer(q)"
                @keydown.ctrl.enter="submitAnswer(q)"
              />
              <div class="form-actions">
                <span class="hint">⌘/Ctrl + Enter 提交</span>
                <el-button
                  type="primary"
                  :loading="isAnswering(q.id)"
                  :disabled="!getDraft(q.id).trim()"
                  @click="submitAnswer(q)"
                >
                  发送回答
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inbox-view {
  padding: 20px;
  min-height: calc(100vh - 120px);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.oldest-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.list-wrap {
  min-height: 200px;
}

.empty-icon {
  font-size: 56px;
  line-height: 1;
}
.empty-tip {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  margin-top: 4px;
}

.question-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.question-card {
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  padding: 16px 20px;
  transition: border-color 0.2s;
}
.question-card:hover {
  border-color: var(--el-color-primary-light-5);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.mono-id {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 6px;
  background: var(--el-fill-color);
  border-radius: 4px;
  color: var(--el-text-color-regular);
}
.time {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.card-body {
  padding: 12px 14px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  margin-bottom: 12px;
}
.question-label {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.question-text {
  font-size: 14px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.choices {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.choice-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.card-footer {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 12px;
}
.answer-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.form-actions .hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 响应式 */
@media (max-width: 640px) {
  .inbox-view { padding: 12px; }
  .toolbar { padding: 12px; }
  .title { font-size: 16px; }
  .question-card { padding: 12px 14px; }
  .card-header { flex-direction: column; align-items: flex-start; }
}
</style>
