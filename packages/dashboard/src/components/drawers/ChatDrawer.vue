<script setup lang="ts">
// core/web/src/components/drawers/ChatDrawer.vue —— 对话抽屉（照 framework ChatDrawer.vue，适配 V2）
// SSE 接 /api/sessions/:refId/stream；POST /api/sessions/:refId/chat 乐观更新
import { ref, watch, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  showChatDrawer, closeChatDrawer,
  currentExecId, currentSessionRefId,
} from '../../stores/tasks'
import { api } from '../../api/tasks'

interface ChatMsg { role: 'user' | 'assistant' | 'system'; content: string }

const messages = ref<ChatMsg[]>([])
const newMsg = ref('')
const sending = ref(false)
let es: EventSource | null = null

function openStream() {
  closeStream()
  const refId = currentSessionRefId.value
  if (!refId) return
  try {
    es = new EventSource(`/api/sessions/${encodeURIComponent(refId)}/stream`)
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data) as { type: string; text?: string }
        if (d.type === 'token' && d.text) {
          // 追加到最后一条 assistant 消息（或新建）
          const last = messages.value[messages.value.length - 1]
          if (last && last.role === 'assistant') {
            last.content += d.text
          } else {
            messages.value.push({ role: 'assistant', content: d.text })
          }
        } else if (d.type === 'done') {
          // 流结束，不做额外操作
        }
      } catch { /* 忽略坏帧 */ }
    }
    es.onerror = () => {
      // EventSource 自动重连，仅在 closed 时提示
      if (es && es.readyState === EventSource.CLOSED) {
        ElMessage.warning('SSE 连接断开')
      }
    }
  } catch {
    // EventSource 构造失败，忽略
  }
}

function closeStream() {
  if (es) { es.close(); es = null }
  messages.value = []
}

// 抽屉打开/关闭时管理 SSE
watch(showChatDrawer, (open) => {
  if (open) {
    openStream()
  } else {
    closeStream()
  }
})

onUnmounted(closeStream)

async function sendMsg() {
  const text = newMsg.value.trim()
  if (!text || sending.value || !currentSessionRefId.value) return
  // 乐观更新：先显示用户消息
  const idx = messages.value.push({ role: 'user', content: text }) - 1
  newMsg.value = ''
  sending.value = true
  try {
    await api.chat(currentSessionRefId.value, text)
  } catch (e: any) {
    ElMessage.error('发送失败')
    // 回滚乐观更新：精准删除刚 push 的消息
    messages.value.splice(idx, 1)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <el-drawer
    v-model="showChatDrawer"
    title="对话"
    size="560px"
    @close="closeChatDrawer"
  >
    <div v-if="currentExecId" class="subtitle">
      <el-tag size="small" type="info">{{ currentExecId }}</el-tag>
    </div>

    <div class="chat-list">
      <el-empty
        v-if="messages.length === 0 && !currentSessionRefId"
        description="无可用 session，无法对话"
        :image-size="80"
      />
      <el-empty
        v-else-if="messages.length === 0"
        description="还没有对话，输入一条指令开始吧"
        :image-size="80"
      />
      <template v-else>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['chat-item', msg.role]"
        >
          <div class="chat-bubble">
            <div class="chat-role">
              {{ msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '系统' }}
            </div>
            <div class="chat-text">{{ msg.content }}</div>
          </div>
        </div>
      </template>
    </div>

    <div class="chat-input">
      <el-input
        v-model="newMsg"
        placeholder="输入消息，回车发送"
        :disabled="sending || !currentSessionRefId"
        @keyup.enter="sendMsg"
      />
      <el-button type="primary" :loading="sending" :disabled="!currentSessionRefId" @click="sendMsg">发送</el-button>
    </div>
  </el-drawer>
</template>

<style scoped>
.subtitle { margin-bottom: 12px; }

.chat-list {
  max-height: 460px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.chat-item { display: flex; }
.chat-item.user { justify-content: flex-end; }
.chat-item.user .chat-bubble {
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
}

.chat-bubble {
  max-width: 85%;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 8px 12px;
}

.chat-role { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.chat-text { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.6; }

.chat-input { display: flex; gap: 8px; }
</style>
