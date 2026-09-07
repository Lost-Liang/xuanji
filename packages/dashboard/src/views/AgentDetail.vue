<script setup lang="ts">
// core/web/src/views/AgentDetail.vue —— Agent 详情页
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type AgentBinding } from '../api/agent-bindings'

const route = useRoute()
const router = useRouter()
const agent = ref<AgentBinding | null>(null)
const loading = ref(false)
const editing = ref(false)
const form = ref<Partial<AgentBinding>>({})
const triggersText = ref('[]')

const isNew = computed(() => route.params.id === 'new')

// harness 选项
const harnessOptions = ['claude-sdk', 'codex', 'codex-native']
const effortOptions = ['minimal', 'low', 'medium', 'high']

// skill 选项
const skillOptions = ref<{ id: string; description: string | null }[]>([])

async function loadAgent() {
  if (isNew.value) {
    agent.value = {
      id: '',
      agent_id: '',
      harness: 'claude-sdk',
      triggers: [],
      reasoning_effort: 'medium',
      session_count: 0
    } as AgentBinding
    editing.value = true
    return
  }

  loading.value = true
  try {
    const res = await fetch(`/api/agent-bindings/${route.params.id}`)
    if (!res.ok) throw new Error('加载失败')
    agent.value = await res.json()
    form.value = { ...agent.value }
    triggersText.value = JSON.stringify(agent.value?.triggers ?? [], null, 2)
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadSkills() {
  try {
    const data = await fetch('/api/skills').then(r => r.json())
    skillOptions.value = [...(data.presets || []), ...(data.user || [])]
  } catch {}
}

async function save() {
  if (!form.value.agent_id || !form.value.harness) {
    ElMessage.warning('请填写必填字段')
    return
  }

  let triggers: any
  try {
    triggers = JSON.parse(triggersText.value)
  } catch {
    ElMessage.error('triggers 不是合法 JSON')
    return
  }

  const payload = { ...form.value, triggers }

  try {
    let result: any
    if (isNew.value) {
      result = await api.create(payload)
      ElMessage.success('已创建')
    } else {
      result = await api.update(form.value.id!, payload)
      ElMessage.success('已更新')
    }

    // 检查是否需要重启提示
    if (result?.requires_restart) {
      ElMessage({
        type: 'info',
        message: result.restart_message || '正在重启服务，请稍候约 10 秒...',
        duration: 8000,
        showClose: true
      })
    }

    editing.value = false
    if (isNew.value) {
      router.replace(`/agents/${form.value.id}`)
    }
    loadAgent()
  } catch (e: any) {
    ElMessage.error('保存失败')
  }
}

async function remove() {
  if (!agent.value) return
  try {
    await ElMessageBox.confirm(`确定删除 ${agent.value.agent_id}?`, '删除确认', { type: 'warning' })
    const result = await api.remove(agent.value.id)
    ElMessage.success('已删除')

    // 检查是否需要重启提示
    if (result?.requires_restart) {
      ElMessage({
        type: 'info',
        message: result.restart_message || '正在重启服务，请稍候约 10 秒...',
        duration: 8000,
        showClose: true
      })
    }

    router.push('/agents')
  } catch {}
}

onMounted(() => {
  loadAgent()
  loadSkills()
})
</script>

<template>
  <div class="agent-detail" v-loading="loading">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <button class="back-btn" @click="router.back()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 class="page-title">
          {{ isNew ? '新建 Agent 绑定' : (agent?.agent_id || 'Agent 详情') }}
        </h1>
      </div>
      <div class="header-actions">
        <template v-if="!editing && agent">
          <button class="btn btn-secondary" @click="editing = true">编辑</button>
          <button class="btn btn-danger" @click="remove">删除</button>
        </template>
        <template v-if="editing">
          <button class="btn btn-secondary" @click="editing = false; loadAgent()">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </template>
      </div>
    </div>

    <!-- 内容 -->
    <div class="page-content" v-if="agent">
      <!-- 编辑模式 -->
      <template v-if="editing">
        <div class="form-section">
          <div class="form-item">
            <label>ID <span class="required">*</span></label>
            <input v-model="form.id" :disabled="!isNew" placeholder="binding 唯一 ID" />
          </div>
          <div class="form-item">
            <label>Agent ID <span class="required">*</span></label>
            <input v-model="form.agent_id" placeholder="图内 agent 节点标识" />
          </div>
          <div class="form-item">
            <label>Harness <span class="required">*</span></label>
            <select v-model="form.harness">
              <option v-for="h in harnessOptions" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>
          <div class="form-item">
            <label>Model</label>
            <input v-model="form.model" placeholder="如 claude-sonnet-4-6" />
          </div>
          <div class="form-item">
            <label>Plugin ID</label>
            <input v-model="form.plugin_id" placeholder="所属插件" />
          </div>
          <div class="form-item">
            <label>Skill ID</label>
            <select v-model="form.skill_id">
              <option value="">无</option>
              <option v-for="s in skillOptions" :key="s.id" :value="s.id">{{ s.id }}</option>
            </select>
          </div>
          <div class="form-item">
            <label>Reasoning Effort</label>
            <select v-model="form.reasoning_effort">
              <option v-for="e in effortOptions" :key="e" :value="e">{{ e }}</option>
            </select>
          </div>
          <div class="form-item full">
            <label>Prompt Content</label>
            <textarea v-model="form.prompt_content" rows="8" placeholder="系统提示词" />
          </div>
          <div class="form-item full">
            <label>Triggers (JSON)</label>
            <textarea v-model="triggersText" rows="4" placeholder='如 ["manual", "on-failure"]' />
          </div>
        </div>
      </template>

      <!-- 查看模式 -->
      <template v-else>
        <div class="info-grid">
          <div class="info-card">
            <h3 class="card-title">基本信息</h3>
            <div class="info-rows">
              <div class="info-row">
                <span class="info-label">ID</span>
                <span class="info-value mono">{{ agent.id }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Agent ID</span>
                <span class="info-value mono">{{ agent.agent_id }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Harness</span>
                <span class="info-value">{{ agent.harness }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Plugin ID</span>
                <span class="info-value">{{ agent.plugin_id || '-' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Skill ID</span>
                <span class="info-value">{{ agent.skill_id || '-' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Model</span>
                <span class="info-value mono">{{ agent.model || '-' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Reasoning Effort</span>
                <span class="info-value">{{ agent.reasoning_effort || '-' }}</span>
              </div>
            </div>
          </div>

          <div class="info-card">
            <h3 class="card-title">执行状态</h3>
            <div class="info-rows">
              <div class="info-row">
                <span class="info-label">Agent 绑定</span>
                <span class="info-value mono">
                  {{ agent.omnigent_agent_id ? agent.omnigent_agent_id.slice(0, 20) + '...' : '未注册' }}
                </span>
              </div>
              <div class="info-row">
                <span class="info-label">执行次数</span>
                <span class="info-value">{{ agent.session_count ?? 0 }} 次</span>
              </div>
            </div>
          </div>
        </div>

        <div class="content-section" v-if="agent.prompt_content">
          <h3 class="section-title">Prompt Content</h3>
          <pre class="code-block">{{ agent.prompt_content }}</pre>
        </div>

        <div class="content-section" v-if="agent.triggers?.length">
          <h3 class="section-title">Triggers</h3>
          <div class="tags">
            <span v-for="t in agent.triggers" :key="t" class="tag">{{ t }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.agent-detail {
  padding: 16px;
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.16s;
}

.back-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.16s;
  border: 1px solid transparent;
}

.btn-primary {
  background: var(--accent);
  color: #001016;
}

.btn-secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text);
}

.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-danger {
  background: transparent;
  border-color: #f56c6c;
  color: #f56c6c;
}

.page-content {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}

.form-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-item.full {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.required {
  color: #f56c6c;
}

.form-item input,
.form-item select,
.form-item textarea {
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  transition: border-color 0.16s;
}

.form-item input:focus,
.form-item select:focus,
.form-item textarea:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.form-item textarea {
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 13px;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.info-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.info-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-label {
  font-size: 12px;
  color: var(--muted);
}

.info-value {
  font-size: 13px;
  color: var(--text);
}

.info-value.mono {
  font-family: var(--font-mono);
}

.content-section {
  margin-top: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 12px;
}

.code-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 400px;
  overflow: auto;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  padding: 4px 12px;
  background: rgba(34, 211, 238, 0.1);
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
}
</style>