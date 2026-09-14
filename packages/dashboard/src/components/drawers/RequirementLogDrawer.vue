<script setup lang="ts">
// core/web/src/components/drawers/RequirementLogDrawer.vue —— 需求日志抽屉
// 参考 framework RequirementLogDrawer.vue，适配本项目栈（展示 spec_content + session refs）
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, type RequirementDetail } from '../../api/requirements'

const props = defineProps<{
  modelValue: boolean
  requirementId: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const detail = ref<RequirementDetail | null>(null)
const loading = ref(false)

async function loadDetail() {
  if (!props.requirementId) return
  loading.value = true
  try {
    detail.value = await api.get(props.requirementId)
  } catch (e: any) {
    ElMessage.error(e?.message || '加载日志失败')
  } finally {
    loading.value = false
  }
}

// 抽屉打开时加载
watch(
  () => props.modelValue,
  (open) => {
    if (open && props.requirementId) loadDetail()
  },
)

function copySession(sessionId: string) {
  navigator.clipboard.writeText(sessionId).then(() => {
    ElMessage.success('session_id 已复制')
  })
}

function formatTime(ts: string): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function statusText(status: string | null): string {
  const map: Record<string, string> = {
    pending: '待执行', running: '执行中', completed: '已完成',
    failed: '失败', stopped: '已停止', cancelled: '已取消', paused: '已暂停',
  }
  return map[status || ''] || '未知'
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    title="需求日志"
    size="720px"
    direction="rtl"
  >
    <div v-loading="loading">
      <!-- 需求规格（spec 产出，spec §9.2） -->
      <div v-if="detail?.spec_content" class="log-block">
        <div class="section-label">需求规格产出</div>
        <pre class="spec-output">{{ detail.spec_content }}</pre>
      </div>

      <!-- Session 记录（spec §9.3） -->
      <div v-if="detail && detail.session_refs.length > 0" class="log-block">
        <div class="section-label">Session 记录</div>
        <div
          v-for="s in detail.session_refs"
          :key="s.id"
          class="session-item"
        >
          <div class="session-meta">
            <span class="phase-name">{{ s.node_id }}</span>
            <el-tag size="small" :type="s.status === 'running' ? 'warning' : 'info'">
              {{ statusText(s.status) }}
            </el-tag>
            <span class="muted">attempt {{ s.iteration }}</span>
          </div>
          <div class="session-id-row">
            <code class="session-id">{{ s.session_id || '（未匹配到 session）' }}</code>
            <el-button
              v-if="s.session_id"
              size="small"
              link
              type="primary"
              @click="copySession(s.session_id)"
            >复制</el-button>
          </div>
        </div>
      </div>

      <el-empty v-if="!detail || (!detail.spec_content && detail.session_refs.length === 0)" description="暂无日志" />
    </div>
  </el-drawer>
</template>

<style scoped>
.log-block {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--el-border-color-light);
}

.section-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  font-weight: 600;
}

.spec-output {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
  max-height: 400px;
  overflow-y: auto;
}

.muted {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.session-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--el-bg-color);
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.phase-name { font-weight: 600; font-size: 13px; }

.session-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 4px;
  word-break: break-all;
}
</style>
