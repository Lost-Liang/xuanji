<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type Project } from '../api/projects'

const projects = ref<Project[]>([])
const loading = ref(false)

// 新建表单
const showDialog = ref(false)
const form = ref({ name: '', path: '', description: '' })
const submitting = ref(false)

// 目录浏览器
const browseDialog = ref(false)
const browsePath = ref('')
const browseDirs = ref<{name: string, path: string}[]>([])
const browseLoading = ref(false)

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

async function browseDir(path?: string) {
  browseLoading.value = true
  try {
    const url = `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`
    const res = await fetch(url)
    const data = await res.json()
    browsePath.value = data.current_path
    browseDirs.value = data.directories
    // 添加 "返回上级" 选项
    if (data.parent_path) {
      browseDirs.value.unshift({ name: '..', path: data.parent_path })
    }
  } catch (e) {
    ElMessage.error('读取目录失败')
  } finally {
    browseLoading.value = false
  }
}

function openBrowseDialog() {
  browseDir()
  browseDialog.value = true
}

function selectPath(path: string) {
  form.value.path = path
  browseDialog.value = false
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
          <el-input v-model="form.path" placeholder="点击浏览选择目录" readonly>
            <template #append>
              <el-button @click="openBrowseDialog">浏览</el-button>
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

    <!-- 目录浏览对话框 -->
    <el-dialog v-model="browseDialog" title="选择目录" width="600px">
      <div class="browse-header">
        <span>当前目录：</span>
        <el-input v-model="browsePath" readonly style="flex: 1" />
      </div>
      <el-table :data="browseDirs" v-loading="browseLoading" height="400px" stripe
        @row-click="(row: any) => browseDir(row.path)">
        <el-table-column prop="name" label="目录名" />
        <el-table-column prop="path" label="路径" show-overflow-tooltip />
        <el-table-column width="100">
          <template #default="{ row }">
            <el-button v-if="row.name !== '..'" type="primary" text @click.stop="selectPath(row.path)">选择</el-button>
          </template>
        </el-table-column>
      </el-table>
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
.browse-header {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
  gap: 10px;
}
</style>