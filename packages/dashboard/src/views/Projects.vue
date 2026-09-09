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

// 选择目录
async function selectFolder() {
  try {
    // @ts-ignore - File System Access API
    const dirHandle = await window.showDirectoryPicker()
    // 获取目录路径（从 entries 中提取）
    const entries = []
    for await (const entry of dirHandle.values()) {
      entries.push(entry.name)
    }
    // 用户需要手动确认完整路径，因为浏览器安全限制无法获取绝对路径
    // 但我们可以显示目录名作为提示
    form.value.name = form.value.name || dirHandle.name
    ElMessage.info(`已选择目录 "${dirHandle.name}"，请确认完整路径`)
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      ElMessage.warning('浏览器不支持目录选择，请手动输入路径')
    }
  }
}

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

    <el-table :data="projects" v-loading="loading" stripe>
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="path" label="路径" />
      <el-table-column prop="description" label="描述" />
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button type="danger" text @click="deleteProject(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加对话框 -->
    <el-dialog v-model="showDialog" title="添加项目" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="项目名称" />
        </el-form-item>
        <el-form-item label="路径" required>
          <el-input v-model="form.path" placeholder="/path/to/project">
            <template #append>
              <el-button @click="selectFolder">选择</el-button>
            </template>
          </el-input>
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
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.page-header h1 {
  margin: 0;
  font-size: 24px;
}
</style>