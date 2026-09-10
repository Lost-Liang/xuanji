# 璇玑 V4 工作目录核心改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 在错误目录执行的问题，让 Agent 在用户指定的目标项目目录工作。

**Architecture:** 三层分离：平台(DB) → 目标项目(.claude/) → Agent Runtime。创建需求时用户指定工作目录，复制 skill 到工作目录，Agent 在工作目录启动。

**Tech Stack:** TypeScript, Prisma, Vue 3, Element Plus

**Spec:** `docs/superpowers/specs/2026-09-09-xuanji-architectural-issues.md`

## Global Constraints

- 语言：中文
- 数据库：PostgreSQL (端口 5433)
- Prisma schema 位置：`packages/core/prisma/schema.prisma`
- 前端框架：Vue 3 + Element Plus
- 后端框架：Express + TypeScript

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `packages/core/src/graph/agent-node.mts` | Agent 执行节点，读取 workDir | 修改 |
| `packages/core/src/routes/requirements.mts` | 创建需求 API，复制 skill | 修改 |
| `packages/dashboard/src/views/Requirements.vue` | 需求创建页面，文件夹选择器 | 修改 |
| `packages/core/skills/presets/frontend-crud-coding/` | 前端 skill | 新增 |

---

### Task 1: 复制前端 Skill 到 presets

**Files:**
- Create: `packages/core/skills/presets/frontend-crud-coding/SKILL.md`
- Create: `packages/core/skills/presets/frontend-crud-coding/references/` (目录)

**Interfaces:**
- Produces: `frontend-crud-coding` skill 可被复制到工作目录

**背景**：spec 发现 5 指出 `frontend-crud-coding` skill 未复制到璇玑核心。

- [ ] **Step 1: 检查源 skill 目录是否存在**

```bash
ls -la workspace/plus-ui/.codex/skills/frontend-crud-coding/
```

**如果目录不存在**，跳过此 Task，在日志中记录警告。

- [ ] **Step 2: 创建目标目录**

```bash
mkdir -p packages/core/skills/presets/frontend-crud-coding/references
```

- [ ] **Step 3: 复制 skill 文件**

```bash
cp -r workspace/plus-ui/.codex/skills/frontend-crud-coding/* packages/core/skills/presets/frontend-crud-coding/
```

- [ ] **Step 4: 验证复制成功**

```bash
ls -la packages/core/skills/presets/frontend-crud-coding/
```

预期：看到 SKILL.md 和 references 目录。

- [ ] **Step 5: 提交**

```bash
git add packages/core/skills/presets/frontend-crud-coding/
git commit -m "feat: 添加 frontend-crud-coding skill"
```

---

### Task 2: 修改 agent-node 使用 targetRepoPath

**Files:**
- Modify: `packages/core/src/graph/agent-node.mts:306-311`

**Interfaces:**
- Consumes: `task.targetRepoPath` 从 Task 对象读取
- Produces: `workDir` 正确传递给 `runLocal()`

**背景**：当前 agent-node 默认使用 `process.cwd()` 作为工作目录，应该使用 `task.targetRepoPath`。

- [ ] **Step 1: 阅读当前代码**

```typescript
// packages/core/src/graph/agent-node.mts:306-311
// 确定工作目录
let workDir = process.cwd();
if (opts.isSubgraph && task) {
  const wtPath = await ensureTaskWorktree(task.shortid, execShortid);
  workDir = wtPath;
}
```

- [ ] **Step 2: 修改逻辑**

修改 `packages/core/src/graph/agent-node.mts`：

```typescript
// 确定工作目录
let workDir = process.cwd();

// 优先使用 task.targetRepoPath（用户指定的目标项目目录）
if (task?.targetRepoPath) {
  workDir = task.targetRepoPath;
} else if (opts.isSubgraph && task) {
  const wtPath = await ensureTaskWorktree(task.shortid, execShortid);
  workDir = wtPath;
}
```

- [ ] **Step 3: 运行类型检查**

```bash
cd packages/core && pnpm build
```

预期：无类型错误。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/graph/agent-node.mts
git commit -m "fix: agent-node 使用 task.targetRepoPath 作为工作目录"
```

---

### Task 3: 添加 Skill 复制功能到 requirements.mts

**Files:**
- Modify: `packages/core/src/routes/requirements.mts`

**Interfaces:**
- Consumes: `targetRepoPath` 从请求体读取
- Produces: `.claude/skills/` 目录下有若依相关 skill

**背景**：创建需求时，需要将系统预置 skill 复制到用户指定的工作目录。

- [ ] **Step 1: 添加导入**

在 `packages/core/src/routes/requirements.mts` 顶部添加：

```typescript
import { join, dirname } from 'path';
import { mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

// 获取当前文件目录（ESM 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// skills 目录路径（编译后从 dist/routes 到 skills）
const SKILLS_DIR = join(__dirname, '../../skills');
```

- [ ] **Step 2: 添加复制函数**

在路由定义前添加：

```typescript
/**
 * 复制系统预置 skill 到工作目录
 * @param targetRepoPath 目标项目路径
 */
async function copySkillsToWorkdir(targetRepoPath: string): Promise<void> {
  const skillsDir = join(targetRepoPath, '.claude', 'skills');
  await mkdir(skillsDir, { recursive: true });

  // 复制若依相关 skill
  const skills = ['ruoyi-plus-ai-coding', 'frontend-crud-coding'];
  for (const skillId of skills) {
    const src = join(SKILLS_DIR, 'presets', skillId);
    if (existsSync(src)) {
      const dest = join(skillsDir, skillId);
      await cp(src, dest, { recursive: true });
      console.log(`[requirements] 已复制 skill: ${skillId}`);
    } else {
      console.warn(`[requirements] skill 不存在: ${skillId}`);
    }
  }
}
```

- [ ] **Step 3: 在创建需求时调用**

找到创建需求的 POST `/` 路由，在创建需求后添加：

```typescript
// 复制 skill 到工作目录
if (body.targetRepoPath) {
  try {
    await copySkillsToWorkdir(body.targetRepoPath);
  } catch (e) {
    console.warn('[requirements] 复制 skill 失败:', e);
    // 不阻塞需求创建
  }
}
```

- [ ] **Step 4: 运行类型检查**

```bash
cd packages/core && pnpm build
```

预期：无类型错误。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/routes/requirements.mts
git commit -m "feat: 创建需求时复制 skill 到工作目录"
```

---

### Task 4: 前端添加工作目录选择器

**Files:**
- Modify: `packages/dashboard/src/views/Requirements.vue` (或对应的创建需求组件)
- Modify: `packages/dashboard/src/api/requirements.ts`

**Interfaces:**
- Produces: 用户可以选择文件夹路径，传给后端 `targetRepoPath`

**背景**：前端需要让用户指定工作目录。

- [ ] **Step 1: 检查前端 API 类型**

```typescript
// packages/dashboard/src/api/requirements.ts
// 确认 CreateRequirement 接口有 targetRepoPath 字段
```

如果没有，添加：

```typescript
export interface CreateRequirement {
  title: string;
  description?: string;
  targetRepoPath?: string;  // 工作目录
}
```

- [ ] **Step 2: 找到创建需求的表单组件**

```bash
find packages/dashboard/src -name "*.vue" | xargs grep -l "targetRepoPath\|创建需求"
```

- [ ] **Step 3: 添加文件夹选择输入**

在创建需求的表单中添加：

```vue
<el-form-item label="工作目录">
  <el-input v-model="form.targetRepoPath" placeholder="选择项目目录">
    <template #append>
      <el-button @click="selectFolder">选择</el-button>
    </template>
  </el-input>
</el-form-item>
```

- [ ] **Step 4: 实现文件夹选择**

使用手动输入路径方案（浏览器环境无法直接访问文件系统）：

```typescript
function showPathHelper() {
  ElMessage.info('请直接输入项目目录的绝对路径');
}
```

- [ ] **Step 5: 验证前端构建**

```bash
cd packages/dashboard && pnpm build
```

预期：无构建错误。

- [ ] **Step 6: 提交**

```bash
git add packages/dashboard/
git commit -m "feat: 前端添加工作目录选择器"
```

---

### Task 5: 端到端测试

**Files:**
- Test: 手动测试

**验证点**：
1. 创建需求时可以指定工作目录
2. Skill 被复制到工作目录
3. Agent 在工作目录执行

- [ ] **Step 1: 启动服务**

```bash
# 终端 1: 启动后端
pnpm --filter @xuanji/core dev

# 终端 2: 启动前端
pnpm --filter @xuanji/dashboard dev
```

- [ ] **Step 2: 创建测试需求**

1. 打开 http://localhost:5173
2. 创建需求，指定工作目录（如 `/tmp/test-project`）
3. 提交需求

- [ ] **Step 3: 验证 skill 复制**

```bash
ls -la /tmp/test-project/.claude/skills/
```

预期：看到 `ruoyi-plus-ai-coding` 和 `frontend-crud-coding` 目录。

- [ ] **Step 4: 验证 agent 工作目录**

查看日志，确认 `runLocal` 使用正确的 `workDir`。

---

## 完成标准

- [ ] agent-node.mts 使用 `task.targetRepoPath` 作为工作目录
- [ ] requirements.mts 创建需求时复制 skill 到工作目录
- [ ] 前端可以指定工作目录
- [ ] frontend-crud-coding skill 已复制到 presets
- [ ] 端到端测试通过