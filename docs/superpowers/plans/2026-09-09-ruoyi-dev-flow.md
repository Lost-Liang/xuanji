# 璇玑 V4 若依研发流程

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建若依研发工作流和 ruoyi-developer 入口 Agent，支持智能路由前后端开发。

**Architecture:** 线性流程 develop → quality_review → security_review → final_review，ruoyi-developer Agent 根据任务类型自动选择 skill。

**Tech Stack:** TypeScript, YAML, Vue 3

**Spec:** `docs/superpowers/specs/2026-09-09-xuanji-architectural-issues.md` 第六章

## Global Constraints

- 语言：中文
- 工作流目录：`packages/core/workflows/`
- Agent 定义目录：`packages/core/agents/ruoyi/`
- Skill 已复制（依赖计划 1 完成）

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `packages/core/workflows/ruoyi-dev-flow.yaml` | 若依研发工作流定义 | 新增 |
| `packages/core/agents/ruoyi/ruoyi-developer.md` | 入口 Agent 定义 | 新增 |
| `packages/core/src/seed/agent-bindings-seed.mts` | Seed ruoyi-developer | 修改 |

---

### Task 1: 创建若依研发工作流 YAML

**Files:**
- Create: `packages/core/workflows/ruoyi-dev-flow.yaml`

**Interfaces:**
- Produces: `ruoyi-dev-flow` 工作流定义，可供执行使用

- [ ] **Step 1: 创建工作流文件**

```yaml
# packages/core/workflows/ruoyi-dev-flow.yaml
# 若依研发流程
#
# 流程：开发 → 质量审查 → 安全审查 → 最终审查
# - develop Agent 自己验证编译和测试
# - 验证失败时 Agent 自己修复，无需单独的 fix 节点
# - 流程大幅简化，减少状态管理复杂度

version: "1"
id: ruoyi-dev-flow
name: 若依研发流程
description: 开发 → 质量审查 → 安全审查 → 最终审查

nodes:
  # 1. 开发阶段（Agent 自己验证编译和测试）
  - id: develop
    type: agent
    name: 开发
    agent_binding_ids: [ruoyi-developer]
    write_key: results

  # 2. 质量审查
  - id: quality_review
    type: agent
    name: 质量审查
    agent_binding_ids: [reviewer]
    write_key: results

  # 3. 安全审查
  - id: security_review
    type: agent
    name: 安全审查
    agent_binding_ids: [reviewer]
    write_key: results

  # 4. 最终审查（人审 gate）
  - id: final_review
    type: gate
    name: 最终审查

edges:
  - from: develop
    to: quality_review

  - from: quality_review
    to: security_review

  - from: security_review
    to: final_review

  - from: final_review
    to: __end__

start:
  - develop
```

- [ ] **Step 2: 验证 YAML 格式**

```bash
cd packages/core && node -e "const yaml = require('yaml'); const fs = require('fs'); const doc = yaml.parse(fs.readFileSync('workflows/ruoyi-dev-flow.yaml', 'utf8')); console.log('Nodes:', doc.nodes.length); console.log('Edges:', doc.edges.length);"
```

预期：Nodes: 4, Edges: 4

- [ ] **Step 3: 提交**

```bash
git add packages/core/workflows/ruoyi-dev-flow.yaml
git commit -m "feat: 添加若依研发工作流 ruoyi-dev-flow"
```

---

### Task 2: 创建 ruoyi-developer Agent 定义

**Files:**
- Create: `packages/core/agents/ruoyi/ruoyi-developer.md`

**Interfaces:**
- Produces: `ruoyi-developer` Agent 定义，可被 seed 到 DB

- [ ] **Step 1: 确保 agents/ruoyi 目录存在**

```bash
mkdir -p packages/core/agents/ruoyi
```

- [ ] **Step 2: 创建 Agent 定义文件**

```markdown
<!-- packages/core/agents/ruoyi/ruoyi-developer.md -->
---
id: ruoyi-developer
name: 若依全栈开发 Agent
description: 智能路由前后端开发，根据任务类型自动选择 skill
skillId: null  # 不绑定单一 skill，Agent 自己选择
---

# 若依全栈开发 Agent

你是一个若依框架的全栈开发 Agent。你的任务是完成用户的需求开发。

## 可用 Skill

| Skill | 适用场景 |
|-------|----------|
| `ruoyi-plus-ai-coding` | 后端开发：Controller、Service、Mapper、MyBatis |
| `frontend-crud-coding` | 前端开发：Vue 页面、API 类型、表单组件 |

使用方式：查看 `.claude/skills/{skill-name}/SKILL.md` 了解规范。

## 任务类型判断

1. **后端任务**：涉及 Controller、Service、Mapper、数据库表、权限配置
   → 使用 `ruoyi-plus-ai-coding` skill

2. **前端任务**：涉及 Vue 页面、Element Plus、API 类型、表单验证
   → 使用 `frontend-crud-coding` skill

3. **全栈任务**：同时涉及前后端
   → 先后端（ruoyi-plus-ai-coding），再前端（frontend-crud-coding）

## 执行流程

1. 分析任务内容，判断是后端/前端/全栈
2. 查看对应 skill 的 SKILL.md 了解规范
3. 按规范完成任务
4. **验证**：完成后执行编译和测试，确保代码正确
   - 后端：`mvn compile && mvn test`
   - 前端：`npm run build && npm test`
   - 如有失败，修复后重新验证

## 输出要求

完成后提供：
1. 修改的文件列表
2. 主要变更说明
3. 测试结果（编译/测试是否通过）
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/agents/ruoyi/ruoyi-developer.md
git commit -m "feat: 添加 ruoyi-developer Agent 定义"
```

---

### Task 3: 修改 Seed 支持 ruoyi-developer

**Files:**
- Modify: `packages/core/src/seed/agent-bindings-seed.mts`

**Interfaces:**
- Produces: `ruoyi-developer` AgentBinding 记录存入 DB

- [ ] **Step 1: 查看当前 seed 结构**

```bash
head -50 packages/core/src/seed/agent-bindings-seed.mts
```

- [ ] **Step 2: 在 AGENT_CONFIGS 中添加 ruoyi-developer**

在 `packages/core/src/seed/agent-bindings-seed.mts` 的 `AGENT_CONFIGS` 数组中添加：

```typescript
{
  id: 'ruoyi-developer',
  name: '若依全栈开发 Agent',
  role: 'developer',
  harness: 'claude',
  model: 'claude-sonnet-4-20250514',
  skillId: null,  // 不绑定单一 skill
  triggers: { task_type: ['feature', 'bugfix', 'enhancement'] },
  promptFile: 'ruoyi-developer.md',
}
```

- [ ] **Step 3: 确保 promptFile 读取函数支持 ruoyi 目录**

检查 `readPromptContent` 函数是否支持读取 `agents/ruoyi/` 目录下的文件。

如果需要修改，添加对 ruoyi 目录的支持：

```typescript
function readPromptContent(agentId: string): string {
  // 先尝试 ruoyi 目录
  const ruoyiPath = join(AGENTS_DIR, 'ruoyi', `${agentId}.md`);
  if (existsSync(ruoyiPath)) {
    return readFileSync(ruoyiPath, 'utf-8');
  }
  // 再尝试根目录
  const rootPath = join(AGENTS_DIR, `${agentId}.md`);
  if (existsSync(rootPath)) {
    return readFileSync(rootPath, 'utf-8');
  }
  return '';
}
```

- [ ] **Step 4: 运行 seed**

```bash
cd packages/core && pnpm run seed
```

预期：看到 ruoyi-developer 创建成功的日志。

- [ ] **Step 5: 验证 DB 记录**

```bash
psql -h localhost -p 5433 -U v2 -d xuanji -c "SELECT id, name, role FROM agent_bindings WHERE id = 'ruoyi-developer';"
```

预期：返回 ruoyi-developer 记录。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/seed/agent-bindings-seed.mts
git commit -m "feat: seed 支持 ruoyi-developer Agent"
```

---

### Task 4: 确保 reviewer Agent 存在

**Files:**
- Check: `packages/core/src/seed/agent-bindings-seed.mts`

**背景**：工作流使用 `reviewer` agent_binding_ids，需要确认它存在。

- [ ] **Step 1: 检查 reviewer 是否存在**

```bash
psql -h localhost -p 5433 -U v2 -d xuanji -c "SELECT id, name FROM agent_bindings WHERE id = 'reviewer';"
```

**如果返回非空结果**，跳过 Step 2-3，直接进入 Step 4。

- [ ] **Step 2: 如果不存在，添加 reviewer 定义**

在 `AGENT_CONFIGS` 中添加：

```typescript
{
  id: 'reviewer',
  name: '代码审查 Agent',
  role: 'reviewer',
  harness: 'claude',
  model: 'claude-sonnet-4-20250514',
  skillId: 'code-review',
  triggers: {},
  promptFile: 'reviewer.md',  // 如果有的话
}
```

如果没有 reviewer.md，可以创建一个简单的：

```markdown
<!-- packages/core/agents/ruoyi/reviewer.md -->
---
id: reviewer
name: 代码审查 Agent
description: 执行代码质量和安全审查
skillId: code-review
---

# 代码审查 Agent

你是代码审查专家。审查代码的：
1. 代码质量和可维护性
2. 安全漏洞
3. 性能问题
4. 最佳实践

输出审查结果和建议。
```

- [ ] **Step 3: 重新 seed**

```bash
cd packages/core && pnpm run seed
```

---

### Task 5: 端到端测试

**验证点**：
1. ruoyi-dev-flow 工作流可加载
2. ruoyi-developer Agent 存在
3. 工作流可执行

- [ ] **Step 1: 验证工作流 API**

```bash
curl http://localhost:3000/api/graph-definitions/ruoyi-dev-flow
```

预期：返回 ruoyi-dev-flow 定义。

- [ ] **Step 2: 验证 Agent API**

```bash
curl http://localhost:3000/api/agent-bindings/ruoyi-developer
```

预期：返回 ruoyi-developer 定义。

- [ ] **Step 3: 创建测试需求并执行**

1. 打开 Dashboard
2. 创建需求，选择 ruoyi-dev-flow 工作流
3. 指定工作目录（若依项目目录）
4. 执行并观察流程

---

## 完成标准

- [ ] ruoyi-dev-flow.yaml 存在且格式正确
- [ ] ruoyi-developer Agent 定义存在
- [ ] ruoyi-developer 已 seed 到 DB
- [ ] reviewer Agent 存在（或已创建）
- [ ] 工作流 API 返回正确
- [ ] 端到端测试通过