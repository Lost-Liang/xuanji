<script setup lang="ts">
// core/web/src/views/SkillConfig.vue —— Skill 列表页
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

interface Skill {
  id: string
  name: string
  description: string
  type: 'preset' | 'user'
}

const router = useRouter()
const presets = ref<Skill[]>([])
const userSkills = ref<Skill[]>([])
const loading = ref(false)
const activeTab = ref('presets')

async function loadSkills() {
  loading.value = true
  try {
    const res = await fetch('/api/skills')
    const data = await res.json()
    presets.value = data.presets || []
    userSkills.value = data.user || []
  } catch {
    ElMessage.error('加载 Skill 列表失败')
  } finally {
    loading.value = false
  }
}

function goToDetail(row: Skill) {
  router.push(`/skills/${row.id}`)
}

function createSkill() {
  router.push('/skills/new')
}

onMounted(loadSkills)
</script>

<template>
  <div class="skill-config">
    <!-- 工具栏 -->
    <div class="toolbar">
      <span class="title">Skill 配置</span>
      <div class="actions">
        <button class="btn-primary" @click="createSkill">新建 Skill</button>
        <button class="btn-secondary" @click="loadSkills">刷新</button>
      </div>
    </div>

    <!-- 标签页 -->
    <el-tabs v-model="activeTab" class="tabs">
      <el-tab-pane label="预设 Skill" name="presets">
        <el-table :data="presets" v-loading="loading" @row-click="goToDetail" class="clickable-table">
          <el-table-column label="ID" prop="id" min-width="180" />
          <el-table-column label="名称" prop="name" min-width="160" />
          <el-table-column label="描述" prop="description" min-width="300" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="!loading && presets.length === 0" description="暂无预设 Skill" />
      </el-tab-pane>

      <el-tab-pane label="用户 Skill" name="user">
        <el-table :data="userSkills" v-loading="loading" @row-click="goToDetail" class="clickable-table">
          <el-table-column label="ID" prop="id" min-width="180" />
          <el-table-column label="名称" prop="name" min-width="160" />
          <el-table-column label="描述" prop="description" min-width="300" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="!loading && userSkills.length === 0" description="暂无用户 Skill" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.skill-config { padding: 16px; min-height: calc(100vh - 120px); }

.toolbar {
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--panel);
  border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 12px;
}
.toolbar .title { font-size: 18px; font-weight: 600; color: var(--text); }
.toolbar .actions { display: flex; gap: 8px; align-items: center; }

.btn-primary {
  padding: 8px 18px; border-radius: 6px;
  background: var(--accent); color: #001016;
  border: none; cursor: pointer; font-size: 14px; font-weight: 500;
}
.btn-primary:hover { opacity: 0.9; }

.btn-secondary {
  padding: 8px 18px; border-radius: 6px;
  background: transparent; color: var(--text);
  border: 1px solid var(--border); cursor: pointer; font-size: 14px;
}
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }

.tabs {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 12px;
}

.clickable-table :deep(.el-table__row) {
  cursor: pointer;
}

.clickable-table :deep(.el-table__row:hover) {
  background: var(--surface) !important;
}

:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--surface);
}
:deep(.el-table th.el-table__cell) { font-weight: 600; font-size: 12px; color: var(--muted); }
</style>