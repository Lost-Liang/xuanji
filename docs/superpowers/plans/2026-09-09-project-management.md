# 璇玑 V4 项目管理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添加项目注册功能，用户可以添加常用项目路径，创建需求时下拉选择。

**Architecture:** 新增 Project 表 + CRUD API + 前端项目选择组件。

**Tech Stack:** TypeScript, Prisma, Vue 3, Element Plus

**Spec:** `docs/superpowers/specs/2026-09-09-xuanji-architectural-issues.md` 第九章

## Global Constraints

- 语言：中文
- 数据库：PostgreSQL (端口 5433)
- Prisma schema 位置：`packages/core/prisma/schema.prisma`
- 前端框架：Vue 3 + Element Plus

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `packages/core/prisma/schema.prisma` | Project 表定义 | 修改 |
| `packages/core/src/routes/projects.mts` | 项目 CRUD API | 新增 |
| `packages/dashboard/src/api/projects.ts` | 前端 API | 新增 |
| `packages/dashboard/src/views/Projects.vue` | 项目管理页面 | 新增 |
| `packages/dashboard/src/views/Requirements.vue` | 项目选择组件 | 修改 |

---

### Task 1: 添加 Project 表

**Files:**
- Modify: `packages/core/prisma/schema.prisma`

**Interfaces:**
- Produces: `Project` 表在数据库中创建

- [ ] **Step 1: 添加 Project model**

在 `packages/core/prisma/schema.prisma` 中添加：

```prisma
model Project {
  id          String   @id @default(uuid())
  name        String   // 项目名称（用户自定义）
  path        String   @unique // 项目路径
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("projects")
}
```

- [ ] **Step 2: 运行迁移**

```bash
cd packages/core && npx prisma migrate dev --name add_projects_table
```

预期：迁移成功，表创建。

- [ ] **Step 3: 验证表结构**

```bash
psql -h localhost -p 5433 -U v2 -d xuanji -c "\d projects"
```

预期：返回表结构。

- [ ] **Step 4: 提交**

```bash
git add packages/core/prisma/
git commit -m "feat: 添加 Project 表"
```

---

### Task 2: 创建项目 CRUD API

**Files:**
- Create: `packages/core/src/routes/projects.mts`
- Modify: `packages/core/src/index.ts` (注册路由)

**Interfaces:**
- Produces: `/api/projects` CRUD API

- [ ] **Step 1: 创建 projects.mts**

```typescript
// packages/core/src/routes/projects.mts
import { Router } from 'express';
import { db } from '../db.mjs';

export const projectsRouter: Router = Router();

/**
 * GET /api/projects
 * 项目列表
 */
projectsRouter.get('/', async (_req, res) => {
  try {
    const projects = await db.project.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    res.json(projects.map(p => ({
      id: p.id,
      name: p.name,
      path: p.path,
      description: p.description,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: '查询项目失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/projects
 * 添加项目
 */
projectsRouter.post('/', async (req, res) => {
  try {
    const { name, path, description } = req.body;

    if (!name || !path) {
      res.status(400).json({ error: 'name 和 path 必填' });
      return;
    }

    const project = await db.project.create({
      data: { name, path, description },
    });

    res.status(201).json({
      id: project.id,
      name: project.name,
      path: project.path,
      description: project.description,
      created_at: project.createdAt.toISOString(),
      updated_at: project.updatedAt.toISOString(),
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: '项目路径已存在' });
      return;
    }
    res.status(500).json({ error: '创建项目失败', detail: err.message });
  }
});

/**
 * DELETE /api/projects/:id
 * 删除项目
 */
projectsRouter.delete('/:id', async (req, res) => {
  try {
    await db.project.delete({
      where: { id: req.params.id },
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: '项目不存在' });
      return;
    }
    res.status(500).json({ error: '删除项目失败', detail: err.message });
  }
});
```

- [ ] **Step 2: 注册路由**

在 `packages/core/src/index.ts` 中：

```typescript
import { projectsRouter } from './routes/projects.mjs';

// 在其他路由注册后添加
app.use('/api/projects', projectsRouter);
```

- [ ] **Step 3: 运行构建**

```bash
cd packages/core && pnpm build
```

预期：无错误。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/routes/projects.mts packages/core/src/index.ts
git commit -m "feat: 添加项目 CRUD API"
```

---

### Task 3: 创建前端 API

**Files:**
- Create: `packages/dashboard/src/api/projects.ts`

**Interfaces:**
- Produces: 前端项目 API 调用函数

- [ ] **Step 1: 创建 API 文件**

```typescript
// packages/dashboard/src/api/projects.ts
const base = '/api/projects'

export interface Project {
  id: string
  name: string
  path: string
  description: string | null
  created_at: string
  updated_at: string
}

export const api = {
  async list(): Promise<Project[]> {
    const r = await fetch(base)
    return r.json()
  },

  async create(data: { name: string; path: string; description?: string }): Promise<Project> {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error || '创建失败')
    }
    return r.json()
  },

  async delete(id: string): Promise<void> {
    const r = await fetch(`${base}/${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error || '删除失败')
    }
  },
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/dashboard/src/api/projects.ts
git commit -m "feat: 添加前端项目 API"
```

---

### Task 4: 创建项目管理页面

**Files:**
- Create: `packages/dashboard/src/views/Projects.vue`
- Modify: `packages/dashboard/src/router/index.ts` (添加路由)

**Interfaces:**
- Produces: 项目管理页面，可以添加/删除项目

- [ ] **Step 1: 创建 Projects.vue**

```vue
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
          <el-input v-model="form.path" placeholder="/path/to/project" />
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
```

- [ ] **Step 2: 添加路由**

在 `packages/dashboard/src/router/index.ts` 中添加：

```typescript
{
  path: '/projects',
  name: 'Projects',
  component: () => import('../views/Projects.vue'),
}
```

- [ ] **Step 3: 添加导航入口**

在侧边栏或顶部导航添加"项目管理"链接。

- [ ] **Step 4: 运行构建**

```bash
cd packages/dashboard && pnpm build
```

预期：无错误。

- [ ] **Step 5: 提交**

```bash
git add packages/dashboard/
git commit -m "feat: 添加项目管理页面"
```

---

### Task 5: 创建需求页面集成项目选择

**Files:**
- Modify: `packages/dashboard/src/views/Requirements.vue` (或对应的创建需求组件)

**Interfaces:**
- Consumes: `/api/projects` 项目列表
- Produces: 选择项目后传递 `targetRepoPath`

- [ ] **Step 1: 添加项目选择组件**

在创建需求的表单中：

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api as projectApi, type Project } from '../api/projects'

const projects = ref<Project[]>([])
const selectedProjectId = ref<string>('')
const customPath = ref('')

onMounted(async () => {
  projects.value = await projectApi.list()
})

// 计算实际使用的路径
const targetRepoPath = computed(() => {
  if (selectedProjectId.value) {
    const p = projects.value.find(x => x.id === selectedProjectId.value)
    return p?.path || ''
  }
  return customPath.value
})
</script>

<template>
  <el-form-item label="目标项目">
    <el-select v-model="selectedProjectId" placeholder="选择已注册项目" clearable style="width: 300px">
      <el-option
        v-for="p in projects"
        :key="p.id"
        :label="p.name"
        :value="p.id"
      />
    </el-select>
    <span style="margin: 0 10px">或</span>
    <el-input v-model="customPath" placeholder="手动输入路径" style="width: 300px" :disabled="!!selectedProjectId" />
  </el-form-item>
</template>
```

- [ ] **Step 2: 提交时传递 targetRepoPath**

确保创建需求时传递 `targetRepoPath`。

- [ ] **Step 3: 提交**

```bash
git add packages/dashboard/src/views/
git commit -m "feat: 创建需求页面集成项目选择"
```

---

### Task 6: 端到端测试

**验证点**：
1. 项目列表 API 正常
2. 可以添加/删除项目
3. 创建需求时可以选择项目

- [ ] **Step 1: 测试项目 API**

```bash
# 添加项目
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"若依后端","path":"/path/to/ruoyi"}'

# 列表
curl http://localhost:3000/api/projects
```

- [ ] **Step 2: 前端测试**

1. 打开 http://localhost:5173/projects
2. 添加项目
3. 创建需求时选择项目

---

## 完成标准

- [ ] Project 表存在
- [ ] 项目 CRUD API 正常
- [ ] 前端项目管理页面存在
- [ ] 创建需求时可以选择项目
- [ ] 端到端测试通过