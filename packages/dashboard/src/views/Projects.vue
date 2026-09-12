<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type Project } from '../api/projects'

const projects = ref<Project[]>([])
const loading = ref(false)

// 新建表单
const showDialog = ref(false)
const form = ref({ name: '', path: '', description: '' })
const submitting = ref(false)

async function loadProjects() {
  loading.value = true
  try {
    projects.value = await api.list()
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function createProject() {
  if (!form.value.name || !form.value.path) {
    ElMessage.warning('名称和路径必填')
    return
  }
  submitting.value = true
  try {
    await api.create(form.value)
    ElMessage.success('添加成功')
    showDialog.value = false
    form.value = { name: '', path: '', description: '' }
    loadProjects()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}

async function deleteProject(p: Project) {
  try {
    await ElMessageBox.confirm(`确定删除项目 "${p.name}" 吗？`, '删除确认', { type: 'warning' })
    await api.delete(p.id)
    ElMessage.success('已删除')
    loadProjects()
  } catch {}
}

onMounted(loadProjects)
</script>

<template>
  <div class="projects-page">
    <header class="page-header">
      <h1>项目管理</h1>
      <el-button type="primary" @click="showDialog = true">添加项目</el-button>
    </header>

    <div class="table-wrap">
      <el-table :data="projects" v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column prop="path" label="路径" min-width="200">
          <template #default="{ row }">
            <span class="mono-path">{{ row.path }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" link @click="deleteProject(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && projects.length === 0" description="暂无项目，点击上方按钮添加" />
    </div>

    <!-- 添加对话框 -->
    <el-dialog v-model="showDialog" title="添加项目" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="项目名称" />
        </el-form-item>
        <el-form-item label="路径" required>
          <el-input v-model="form.path" placeholder="/Users/admin/code/..." />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="createProject">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.projects-page {
  padding: 20px;
  min-height: calc(100vh - 120px);
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.page-header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  font-family: var(--font-ui);
}
.table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.mono-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
}

:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--surface);
}
:deep(.el-table th.el-table__cell) {
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
}
</style>