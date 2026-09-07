<script setup lang="ts">
// core/web/src/views/SkillDetail.vue —— Skill 详情页
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

interface Skill {
  id: string
  name: string
  description: string
  user_invocable: boolean
  content: string
  type: 'preset' | 'user'
}

const route = useRoute()
const router = useRouter()
const skill = ref<Skill | null>(null)
const loading = ref(false)
const editing = ref(false)
const form = ref({ name: '', description: '', content: '' })

const isNew = computed(() => route.params.id === 'new')
const isPreset = computed(() => skill.value?.type === 'preset')

async function loadSkill() {
  if (isNew.value) {
    skill.value = { id: '', name: '', description: '', user_invocable: true, content: '', type: 'user' }
    editing.value = true
    return
  }

  loading.value = true
  try {
    const res = await fetch(`/api/skills/${route.params.id}`)
    if (!res.ok) throw new Error('加载失败')
    skill.value = await res.json()
    const s = skill.value!
    form.value = {
      name: s.name,
      description: s.description,
      content: s.content
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!form.value.name || !form.value.description || !form.value.content) {
    ElMessage.warning('请填写所有必填字段')
    return
  }

  try {
    const url = isNew.value ? '/api/skills' : `/api/skills/${route.params.id}`
    const method = isNew.value ? 'POST' : 'PUT'
    const body = isNew.value
      ? { id: skill.value?.id || route.query.id, ...form.value }
      : form.value

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '保存失败')
    }

    ElMessage.success(isNew.value ? '已创建' : '已更新')
    editing.value = false
    if (isNew.value) {
      const data = await res.json()
      router.replace(`/skills/${data.id}`)
    }
    loadSkill()
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  }
}

async function remove() {
  if (!skill.value || isPreset.value) return
  try {
    const res = await fetch(`/api/skills/${skill.value.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('删除失败')
    ElMessage.success('已删除')
    router.push('/skills')
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(loadSkill)
</script>

<template>
  <div class="skill-detail" v-loading="loading">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <button class="back-btn" @click="router.back()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 class="page-title">
          {{ isNew ? '新建 Skill' : (skill?.name || skill?.id || 'Skill 详情') }}
        </h1>
        <span v-if="skill && !isNew" class="type-tag" :class="skill.type">
          {{ skill.type === 'preset' ? '预设' : '用户' }}
        </span>
      </div>
      <div class="header-actions">
        <template v-if="!editing && skill">
          <button class="btn btn-secondary" @click="editing = true">编辑</button>
          <button v-if="!isPreset" class="btn btn-danger" @click="remove">删除</button>
        </template>
        <template v-if="editing">
          <button class="btn btn-secondary" @click="editing = false; loadSkill()">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </template>
      </div>
    </div>

    <!-- 内容 -->
    <div class="page-content" v-if="skill">
      <!-- 编辑模式 -->
      <template v-if="editing">
        <div class="form-section">
          <div class="form-item">
            <label>ID <span class="required">*</span></label>
            <input
              v-model="skill.id"
              :disabled="!isNew"
              placeholder="skill 唯一标识"
            />
          </div>
          <div class="form-item">
            <label>名称 <span class="required">*</span></label>
            <input v-model="form.name" placeholder="Skill 显示名称" />
          </div>
          <div class="form-item">
            <label>描述 <span class="required">*</span></label>
            <input v-model="form.description" placeholder="Skill 用途描述" />
          </div>
          <div class="form-item full">
            <label>内容 (Markdown) <span class="required">*</span></label>
            <textarea v-model="form.content" rows="20" placeholder="Skill 指令内容" />
          </div>
        </div>
      </template>

      <!-- 查看模式 -->
      <template v-else>
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">ID</span>
            <span class="info-value mono">{{ skill.id }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">名称</span>
            <span class="info-value">{{ skill.name }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">描述</span>
            <span class="info-value">{{ skill.description }}</span>
          </div>
        </div>

        <div class="content-section">
          <h3 class="section-title">内容</h3>
          <pre class="skill-content">{{ skill.content }}</pre>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.skill-detail {
  padding: 16px;
  max-width: 900px;
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

.type-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
}

.type-tag.preset {
  background: rgba(103, 194, 96, 0.15);
  color: #67c23a;
}

.type-tag.user {
  background: rgba(230, 162, 60, 0.15);
  color: #e6a23c;
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

.btn-primary:hover {
  opacity: 0.9;
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

.btn-danger:hover {
  background: rgba(245, 108, 108, 0.1);
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
.form-item textarea {
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.16s;
}

.form-item input:focus,
.form-item textarea:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.form-item textarea {
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 13px;
}

.info-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}

.info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
}

.info-value {
  font-size: 14px;
  color: var(--text);
}

.info-value.mono {
  font-family: var(--font-mono);
  font-size: 13px;
}

.content-section {
  margin-top: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 12px;
}

.skill-content {
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
  max-height: 600px;
  overflow: auto;
}
</style>