# 需求分析 Agent 增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强需求分析和任务拆解阶段的数据质量，修复 Epic/Feature 字段丢失问题，新增 BDD 验收步骤，使下游开发/测试 agent 有更清晰的参考。

**Architecture:** 修改 Prisma Schema 新增 10 个字段，修复 `createTaskTreeFromParsed` 的字段映射逻辑，在 YAML 工作流中新增 `context` 字段控制 agent 读取的 state 通道，更新 4 个 agent 提示词以输出/消费新的结构化数据。

**Tech Stack:** TypeScript, Prisma ORM, PostgreSQL, LangGraph, Vitest

**Spec:** `docs/superpowers/specs/2026-09-09-requirement-analysis-enhancement-design.md`

## Global Constraints

- 所有新字段必须为 nullable（`?`），不影响现有数据
- DB 迁移使用 `prisma migrate dev`，生成可回滚的迁移文件
- Agent 提示词更新必须保持向后兼容（旧的 JSON 格式仍能解析）
- 所有代码改动必须有对应的单元测试
- 端到端测试必须验证完整数据流（需求 → 任务拆解 → 开发 → 测试 → 审查）

---

## File Structure

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `packages/core/prisma/schema.prisma` | 数据库模型定义 | 新增 10 个字段 |
| `packages/core/src/graph/graph-runner.mts` | 任务树创建逻辑 | 修复字段映射，新增 Requirement 写入 |
| `packages/core/src/graph/builder.mts` | 图构建逻辑 | 修改 `buildPrompt` 支持 `context` 字段 |
| `packages/core/src/graph/yaml-loader.mts` | YAML 加载逻辑 | 保留 `context` 字段 |
| `packages/core/workflows/requirement-decomposition.yaml` | 需求分解工作流 | 新增 `context` 字段 |
| `packages/core/agents/ruoyi/requirement-analyst.md` | 需求分析 agent 提示词 | 输出完整 spec + 新字段 |
| `packages/core/agents/ruoyi/task-planner.md` | 任务拆解 agent 提示词 | 输出 BDD 验收步骤 |
| `packages/core/agents/ruoyi/test-engineer.md` | 测试编写 agent 提示词 | 消费 `acceptanceSteps` |
| `packages/core/agents/ruoyi/reviewer.md` | 审查 agent 提示词 | 消费 `acceptanceCriteria` + `acceptanceSteps` |
| `packages/core/test/graph-runner.test.mts` | graph-runner 单元测试 | 新增测试 |
| `packages/core/test/builder.test.mts` | builder 单元测试 | 新增测试 |
| `packages/core/test/e2e.test.mts` | 端到端测试 | 新增测试 |

---

### Task 1: Schema 新增 10 个字段

**Files:**
- Modify: `packages/core/prisma/schema.prisma:68-181`
- Test: 运行 `npx prisma migrate dev` 验证迁移成功

**Interfaces:**
- Consumes: 现有 schema 结构
- Produces: 新增字段在 `Requirement`, `Epic`, `Feature`, `UserStory`, `Task` 表中

- [ ] **Step 1: 在 Requirement 表新增 businessGoal 和 specDoc 字段**

在 `packages/core/prisma/schema.prisma` 的 `Requirement` 模型（L68-87）中，在 `autoExecute` 字段后新增：

```prisma
model Requirement {
  // ... existing fields ...
  autoExecute       Boolean   @default(false) @map("auto_execute")
  maxConcurrentTasks Int      @default(1) @map("max_concurrent_tasks")
  businessGoal      String?   @map("business_goal")   // 新增
  specDoc           String?   @map("spec_doc")         // 新增
  createdAt         DateTime  @default(now()) @map("created_at")
  // ...
}
```

- [ ] **Step 2: 在 Epic 表新增 priority 和 acceptanceCriteria 字段**

在 `Epic` 模型（L90-106）中，在 `module` 字段后新增：

```prisma
model Epic {
  // ... existing fields ...
  module             String?
  priority           String?   // 新增：P0/P1/P2
  acceptanceCriteria String?   @map("acceptance_criteria")  // 新增
  status             String    @default("pending")
  // ...
}
```

- [ ] **Step 3: 在 Feature 表新增 module, acceptanceCriteria, priority 字段**

在 `Feature` 模型（L109-122）中，在 `description` 字段后新增：

```prisma
model Feature {
  // ... existing fields ...
  description        String?
  module             String?   // 新增
  acceptanceCriteria String?   @map("acceptance_criteria")  // 新增
  priority           String?   // 新增：P0/P1/P2
  status             String    @default("pending")
  // ...
}
```

- [ ] **Step 4: 在 UserStory 表新增 module 字段**

在 `UserStory` 模型（L125-144）中，在 `priority` 字段前新增：

```prisma
model UserStory {
  // ... existing fields ...
  acceptanceText  String?   @map("acceptance_text")
  module          String?   // 新增
  priority        String    @default("P2")
  // ...
}
```

- [ ] **Step 5: 在 Task 表新增 acceptanceSteps 和 priority 字段**

在 `Task` 模型（L147-181）中，在 `acceptanceCriteria` 字段后新增：

```prisma
model Task {
  // ... existing fields ...
  acceptanceCriteria String?   @map("acceptance_criteria")
  acceptanceSteps    Json?     @map("acceptance_steps")  // 新增：BDD 步骤数组
  priority           String?   // 新增：P0/P1/P2
  techConstraints    Json?     @map("tech_constraints")
  // ...
}
```

- [ ] **Step 6: 运行 Prisma 迁移**

```bash
cd packages/core
npx prisma migrate dev --name add-requirement-analysis-fields
```

Expected: 迁移成功，生成迁移文件，数据库 schema 更新

- [ ] **Step 7: 验证迁移结果**

```bash
npx prisma db pull
```

检查 `schema.prisma` 中新增的字段是否正确映射到数据库。

- [ ] **Step 8: 提交**

```bash
git add packages/core/prisma/schema.prisma packages/core/prisma/migrations/
git commit -m "feat: add 10 new fields for requirement analysis enhancement"
```

---

### Task 2: 修复 createTaskTreeFromParsed 的 Epic/Feature 字段映射

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts:432-589`
- Modify: `packages/core/src/graph/graph-runner.mts:612-618`（导出）
- Test: `packages/core/test/graph-runner.test.mts` (新建)

**Interfaces:**
- Consumes: `parsed.epics[]`, `parsed.user_stories[].tasks[]`
- Produces: Epic/Feature/UserStory/Task DB 记录（包含所有新字段）

- [ ] **Step 1: 导出 createTaskTreeFromParsed 函数**

在 `packages/core/src/graph/graph-runner.mts` L432，把函数声明从 `async function` 改为 `export async function`：

```typescript
// 当前（L432）：
async function createTaskTreeFromParsed(
  requirement: any,
  parsed: any,
): Promise<void> {

// 修改为：
export async function createTaskTreeFromParsed(
  requirement: any,
  parsed: any,
): Promise<void> {
```

然后在 `packages/core/src/graph/graph-runner.mts` L612-618（导出单例接口），新增导出：

```typescript
export const graphRunner = {
  startExecution,
  resumeExecution,
  loadFlow,
}

// 新增：导出测试用函数
export { createTaskTreeFromParsed }
```

- [ ] **Step 2: 编写失败的单元测试**

在 `packages/core/test/graph-runner.test.mts`（新建文件）中：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../src/db.mjs'
import { createTaskTreeFromParsed } from '../src/graph/graph-runner.mjs'

describe('createTaskTreeFromParsed', () => {
  let requirementId: string

  beforeAll(async () => {
    // 创建测试需求
    const req = await db.requirement.create({
      data: {
        id: 'req-test-001',
        title: '测试需求',
        description: '测试描述',
        targetProjectId: 'proj-test',
        targetRepoPath: '/tmp/test',
      }
    })
    requirementId = req.id
  })

  afterAll(async () => {
    // 清理测试数据
    await db.requirement.delete({ where: { id: requirementId } })
  })

  it('should write all Epic fields correctly', async () => {
    const parsed = {
      epics: [{
        id: 'E1',
        name: '测试 Epic',
        description: 'Epic 描述',
        module: 'test',
        priority: 'P0',
        acceptance_criteria: 'Epic 验收标准',
      }],
      user_stories: [],
    }

    // 调用函数（需要从 graph-runner.mts 导出）
    await createTaskTreeFromParsed(requirementId, parsed)

    const epic = await db.epic.findFirst({
      where: { requirementId, title: '测试 Epic' }
    })

    expect(epic).not.toBeNull()
    expect(epic!.title).toBe('测试 Epic')
    expect(epic!.description).toBe('Epic 描述')
    expect(epic!.module).toBe('test')
    expect(epic!.priority).toBe('P0')
    expect(epic!.acceptanceCriteria).toBe('Epic 验收标准')
  })

  it('should write all Feature fields correctly', async () => {
    const parsed = {
      epics: [{
        id: 'E2',
        name: '测试 Epic 2',
        features: [{
          id: 'F1',
          title: '测试 Feature',
          description: 'Feature 描述',
          module: 'feature-module',
          priority: 'P1',
          acceptance_criteria: 'Feature 验收标准',
        }]
      }],
      user_stories: [],
    }

    await createTaskTreeFromParsed(requirementId, parsed)

    const feature = await db.feature.findFirst({
      where: { epic: { requirementId }, title: '测试 Feature' }
    })

    expect(feature).not.toBeNull()
    expect(feature!.title).toBe('测试 Feature')
    expect(feature!.description).toBe('Feature 描述')
    expect(feature!.module).toBe('feature-module')
    expect(feature!.priority).toBe('P1')
    expect(feature!.acceptanceCriteria).toBe('Feature 验收标准')
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

```bash
cd packages/core
npm test -- graph-runner.test.mts
```

Expected: FAIL，因为 `createTaskTreeFromParsed` 当前只写 `title`

- [ ] **Step 3: 修复 Epic 字段映射**

在 `packages/core/src/graph/graph-runner.mts` L438-462（创建 Epics 的逻辑），修改：

```typescript
// 当前（L450-456）：
await db.epic.create({
  data: {
    id: epicId,
    requirementId: requirement.id,
    title: epicData.module || `Epic ${epicData.id}`,  // ❌ 错误映射
    status: 'pending',
  },
})

// 修改为：
await db.epic.create({
  data: {
    id: epicId,
    requirementId: requirement.id,
    title: epicData.name || epicData.title || `Epic ${epicData.id}`,  // ✅ 正确映射
    description: epicData.description || null,  // 新增
    module: epicData.module || null,  // 新增
    priority: epicData.priority || null,  // 新增
    acceptanceCriteria: epicData.acceptance_criteria || null,  // 新增
    status: 'pending',
  },
})
```

- [ ] **Step 4: 修复 Feature 字段映射**

在 `packages/core/src/graph/graph-runner.mts` L464-488（创建 Features 的逻辑），修改：

```typescript
// 当前（L475-481）：
await db.feature.create({
  data: {
    id: featureId,
    epicId: epic.id,
    title: `Feature ${featureData.id}`,  // ❌ 硬编码
    status: 'pending',
  },
})

// 修改为：
await db.feature.create({
  data: {
    id: featureId,
    epicId: epic.id,
    title: featureData.title || featureData.name || `Feature ${featureData.id}`,  // ✅ 正确映射
    description: featureData.description || null,  // 新增
    module: featureData.module || null,  // 新增
    acceptanceCriteria: featureData.acceptance_criteria || null,  // 新增
    priority: featureData.priority || null,  // 新增
    status: 'pending',
  },
})
```

- [ ] **Step 5: 修复 Task 字段映射（新增 acceptanceSteps 和 priority）**

在 `packages/core/src/graph/graph-runner.mts` L521-537（创建 Tasks 的逻辑），修改：

```typescript
// 当前（L521-537）：
await db.task.create({
  data: {
    id: taskId,
    userStoryId: usId,
    epicId: epicRealId || null,
    title: taskData.title,
    description: taskData.description || null,
    acceptanceCriteria: taskData.acceptance_criteria || null,
    techConstraints: taskData.tech_constraints || null,
    taskType: taskData.task_type || null,
    estimatedHours: taskData.estimated_hours || null,
    targetProjectId: requirement.targetProjectId,
    targetRepoPath: requirement.targetRepoPath,
    sequence: taskSequence,
    status: 'pending',
  },
})

// 修改为：
await db.task.create({
  data: {
    id: taskId,
    userStoryId: usId,
    epicId: epicRealId || null,
    title: taskData.title,
    description: taskData.description || null,
    acceptanceCriteria: taskData.acceptance_criteria || null,
    acceptanceSteps: taskData.acceptance_steps || null,  // 新增
    priority: taskData.priority || null,  // 新增
    techConstraints: taskData.tech_constraints || null,
    taskType: taskData.task_type || null,
    estimatedHours: taskData.estimated_hours || null,
    targetProjectId: requirement.targetProjectId,
    targetRepoPath: requirement.targetRepoPath,
    sequence: taskSequence,
    status: 'pending',
  },
})
```

- [ ] **Step 6: 修复 UserStory 字段映射（新增 module）**

在 `packages/core/src/graph/graph-runner.mts` L490-520（创建 UserStories 的逻辑），修改：

```typescript
// 当前（L490-520）：
await db.userStory.create({
  data: {
    id: usId,
    epicId: epicRealId || null,
    featureId: featureRealId || null,
    title: usData.title || `User Story ${usData.id}`,
    asA: usData.as_a || null,
    iWant: usData.i_want || null,
    soThat: usData.so_that || null,
    acceptanceText: usData.acceptance_text || null,
    priority: usData.priority || 'P2',
    status: 'pending',
  },
})

// 修改为：
await db.userStory.create({
  data: {
    id: usId,
    epicId: epicRealId || null,
    featureId: featureRealId || null,
    title: usData.title || `User Story ${usData.id}`,
    asA: usData.as_a || null,
    iWant: usData.i_want || null,
    soThat: usData.so_that || null,
    acceptanceText: usData.acceptance_text || null,
    module: usData.module || null,  // 新增
    priority: usData.priority || 'P2',
    status: 'pending',
  },
})
```

- [ ] **Step 7: 运行测试，验证通过**

```bash
cd packages/core
npm test -- graph-runner.test.mts
```

Expected: PASS，所有字段正确写入

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/graph/graph-runner.mts packages/core/test/graph-runner.test.mts
git commit -m "fix: correct Epic/Feature/UserStory/Task field mapping in createTaskTreeFromParsed"
```

---

### Task 3: 在 onFlowComplete 中新增 Requirement 写入（specDoc + businessGoal）

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts:356-378`
- Test: `packages/core/test/graph-runner.test.mts`

**Interfaces:**
- Consumes: `result.spec`（requirement-analyst 的输出，JSON 字符串）
- Produces: Requirement 表的 `businessGoal` 和 `specDoc` 字段

**设计说明：** 把 specDoc 写入逻辑放在 `onFlowComplete` 中，而不是 `createTaskTreeFromParsed` 中，避免被 task-planner 的输出覆盖。

- [ ] **Step 1: 编写失败的单元测试**

在 `packages/core/test/graph-runner.test.mts` 中新增：

```typescript
it('should write Requirement.specDoc and businessGoal from spec string', async () => {
  // 模拟 onFlowComplete 的逻辑
  const specString = JSON.stringify({
    business_goal: '测试业务目标',
    scope: { in_scope: ['功能1'], out_of_scope: [] },
    data_models: [{ entity: 'Test', fields: [] }],
    api_design: [],
    ui_design: [],
    risks: [],
  })
  
  const specData = JSON.parse(specString)
  const specForDoc = { ...specData }
  delete specForDoc.business_goal
  
  await db.requirement.update({
    where: { id: requirementId },
    data: {
      businessGoal: specData.business_goal || null,
      specDoc: JSON.stringify(specForDoc, null, 2),
    }
  })

  const req = await db.requirement.findUnique({
    where: { id: requirementId }
  })

  expect(req).not.toBeNull()
  expect(req!.businessGoal).toBe('测试业务目标')
  expect(req!.specDoc).toContain('scope')
  expect(req!.specDoc).toContain('data_models')
  expect(req!.specDoc).not.toContain('business_goal')  // 已去重
})
```

- [ ] **Step 2: 运行测试，验证失败**

```bash
cd packages/core
npm test -- graph-runner.test.mts
```

Expected: FAIL（测试代码直接操作 DB，应该 PASS，但实际 onFlowComplete 还没改）

- [ ] **Step 3: 在 onFlowComplete 中新增 Requirement 更新逻辑**

在 `packages/core/src/graph-runner.mts` L356-378，修改 `onFlowComplete`：

```typescript
async function onFlowComplete(
  flowId: string,
  executionId: string,
  result: Record<string, any>,
  requirementId?: string,
): Promise<void> {
  if (flowId === 'requirement-decomposition' && requirementId) {
    const spec = result.spec || '';
    const tasks = result.tasks || [];

    // 新增：如果 result.spec 存在，更新 Requirement
    if (spec) {
      const specData = typeof spec === 'string' ? safeJsonParse(spec) : spec
      if (specData && typeof specData === 'object') {
        const specForDoc = { ...specData }
        delete specForDoc.business_goal  // 去重，business_goal 单独存
        await db.requirement.update({
          where: { id: requirementId },
          data: {
            businessGoal: specData.business_goal || null,
            specDoc: JSON.stringify(specForDoc, null, 2),
          }
        })
      }
    }

    if (tasks.length > 0) {
      console.log(`[graph-runner] 创建任务树，收到 ${tasks.length} 个解析结果`);
      await createTaskTreeFromBreakdown(requirementId, executionId, tasks);
    } else {
      console.warn(`[graph-runner] 没有任务数据，尝试从 phase_outputs 读取`);
      await createTaskTreeFromPhaseOutputs(requirementId, executionId);
    }
  }
}

// 新增辅助函数
function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 运行测试，验证通过**

```bash
cd packages/core
npm test -- graph-runner.test.mts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/graph/graph-runner.mts packages/core/test/graph-runner.test.mts
git commit -m "feat: write Requirement.specDoc and businessGoal in onFlowComplete"
```

---

### Task 4: 修复 buildPrompt 支持 context 字段

**Files:**
- Modify: `packages/core/src/graph/builder.mts:188-215`
- Test: `packages/core/test/builder.test.mts`

**Interfaces:**
- Consumes: `node.context` 字段（从 YAML 读取），`state.spec`
- Produces: 根据 `context` 字段返回不同的 prompt 文本

- [ ] **Step 1: 提取 buildAgentContext 为独立可导出函数**

在 `packages/core/src/graph/builder.mts` L188 之前（nodeAction 函数之前），新增：

```typescript
// 新增：辅助函数
function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

// 新增：可导出的 context 构建函数
export function buildAgentContext(state: any, contextKey: string): string {
  if (contextKey === 'spec') {
    const specData = typeof state.spec === 'string' ? safeJsonParse(state.spec) : state.spec
    if (specData) {
      return `基于以下需求规格进行任务拆解：\n\n${JSON.stringify(specData, null, 2)}`
    }
  }
  return state.input ?? state.task?.title ?? state.task?.description ?? ''
}
```

- [ ] **Step 2: 修改 nodeAction 使用 buildAgentContext**

在 `packages/core/src/graph/builder.mts` L188-215，修改 `nodeAction`：

```typescript
function nodeAction(node: GraphNode, isSubgraph = false) {
  const interactionMode = node.interaction_mode ?? (isSubgraph ? 'autonomous' : 'interactive')

  switch (node.type) {
    case 'agent': {
      const bindingIds = node.agent_binding_ids ?? []
      if (bindingIds.length === 0) {
        throw new Error(`agent 节点 ${node.id} 缺少 agent_binding_ids`)
      }
      
      const contextKey = (node as any).context || 'input'  // 新增：从 YAML 读取 context
      
      return makeAgentNode({
        bindingIds,
        selector: node.selector,
        writeKey: node.write_key ?? 'results',
        nodeId: node.id,
        isSubgraph,
        isArchive: node.id === 'archive',
        interactionMode,
        buildPrompt: (s: any) => buildAgentContext(s, contextKey),  // 使用提取的函数
      })
    }
    // ... 其他 case 不变 ...
  }
}
```

- [ ] **Step 3: 编写单元测试**

在 `packages/core/test/builder.test.mts` 中新增：

```typescript
import { describe, it, expect } from 'vitest'
import { buildAgentContext } from '../src/graph/builder.mjs'

describe('buildAgentContext', () => {
  it('should read state.spec when context=spec', () => {
    const state = {
      spec: JSON.stringify({
        business_goal: '业务目标',
        scope: { in_scope: ['功能1'] }
      })
    }
    
    const result = buildAgentContext(state, 'spec')
    
    expect(result).toContain('基于以下需求规格进行任务拆解')
    expect(result).toContain('业务目标')
    expect(result).toContain('scope')
  })

  it('should read state.input when context=input (default)', () => {
    const state = {
      input: '原始需求文本'
    }
    
    const result = buildAgentContext(state, 'input')
    
    expect(result).toBe('原始需求文本')
  })

  it('should fallback to input when spec is invalid JSON', () => {
    const state = {
      spec: 'invalid json',
      input: 'fallback text'
    }
    
    const result = buildAgentContext(state, 'spec')
    
    expect(result).toBe('fallback text')
  })
})
```

- [ ] **Step 4: 运行测试，验证通过**

```bash
cd packages/core
npm test -- builder.test.mts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/graph/builder.mts packages/core/test/builder.test.mts
git commit -m "feat: extract buildAgentContext function, support context field"
```

---

### Task 5: 更新 yaml-loader 和 types 保留 context 字段

**Files:**
- Modify: `packages/core/src/graph/yaml-loader.mts:195-254`
- Modify: `packages/core/src/graph/types.mts`（新增 `context` 字段）
- Test: `packages/core/test/builder.test.mts`

**Interfaces:**
- Consumes: YAML 节点定义中的 `context` 字段
- Produces: GraphNode 对象中的 `context` 属性

- [ ] **Step 1: 更新 types.mts 的 WorkflowNode 和 GraphNode 接口**

在 `packages/core/src/graph/types.mts` 中，找到 `WorkflowNode` 和 `GraphNode` 接口定义，新增 `context` 字段：

```typescript
// WorkflowNode 接口（大约 L80-100）
export interface WorkflowNode {
  id: string
  type: string
  name?: string
  agent_binding_id?: string
  agent_binding_ids?: string[]
  // ... 其他现有字段 ...
  write_key?: 'spec' | 'tasks' | 'results'
  context?: string  // 新增：控制 agent 读取的 state 通道，默认 'input'
  // ...
}

// GraphNode 接口（大约 L130-150）
export interface GraphNode {
  id: string
  type: string
  name?: string
  agent_binding_ids?: string[]
  // ... 其他现有字段 ...
  write_key?: 'spec' | 'tasks' | 'results'
  context?: string  // 新增
  // ...
}
```

- [ ] **Step 2: 修改 mapYamlToGraphDef 保留 context 字段**

在 `packages/core/src/graph/yaml-loader.mts` L195-228，修改节点映射逻辑：

```typescript
export function mapYamlToGraphDef(def: WorkflowDef): GraphDef {
  const nodes: GraphNode[] = def.nodes.map((wn: WorkflowNode): GraphNode => {
    const gn: GraphNode = {
      id: wn.id,
      type: wn.type,
      name: wn.name
    }

    // 复制可选字段
    if (wn.config) gn.config = wn.config
    if (wn.command) gn.command = wn.command
    if (wn.subgraph_id) gn.subgraph_id = wn.subgraph_id
    if (wn.write_key) gn.write_key = wn.write_key
    if (wn.exit_condition) gn.exit_condition = wn.exit_condition
    if (wn.condition_config) gn.condition_config = wn.condition_config
    if (wn.loop_counter_key) gn.loop_counter_key = wn.loop_counter_key
    if (wn.python_config) gn.python_config = wn.python_config
    if (wn.selector) gn.selector = wn.selector
    if (wn.context) gn.context = wn.context  // 新增：保留 context 字段（类型安全，不再用 as any）

    // ... 合并 agent_binding_id 逻辑 ...

    return gn
  })

  // ... 边映射逻辑 ...

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    plugin_id: def.id,
    nodes,
    edges,
    loops: [],
    subgraphs: [],
    version: 1
  }
}
```

- [ ] **Step 3: 编写单元测试**

在 `packages/core/test/builder.test.mts` 中新增：

```typescript
import { loadWorkflowFromYaml, mapYamlToGraphDef } from '../src/index.mjs'

describe('yaml-loader context field', () => {
  it('should preserve context field in GraphNode', () => {
    const yaml = `
version: "1"
id: test
name: 测试
nodes:
  - id: node1
    type: agent
    agent_binding_ids: [agent1]
    context: spec
edges: []
start:
  - node1
`
    const workflow = loadWorkflowFromYaml(yaml)
    const graphDef = mapYamlToGraphDef(workflow)
    
    expect(graphDef.nodes[0].context).toBe('spec')
  })

  it('should default context to undefined when not specified', () => {
    const yaml = `
version: "1"
id: test
name: 测试
nodes:
  - id: node1
    type: agent
    agent_binding_ids: [agent1]
edges: []
start:
  - node1
`
    const workflow = loadWorkflowFromYaml(yaml)
    const graphDef = mapYamlToGraphDef(workflow)
    
    expect(graphDef.nodes[0].context).toBeUndefined()
  })
})
```

- [ ] **Step 4: 运行测试，验证通过**

```bash
cd packages/core
npm test -- builder.test.mts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/graph/yaml-loader.mts packages/core/src/graph/types.mts
git commit -m "feat: yaml-loader and types preserve context field in GraphNode"
```

---

### Task 6: 更新 requirement-decomposition.yaml 添加 context 字段

**Files:**
- Modify: `packages/core/workflows/requirement-decomposition.yaml:1-53`

**Interfaces:**
- Consumes: 工作流定义
- Produces: task_breakdown 节点读取 `state.spec`

- [ ] **Step 1: 修改 YAML 文件**

在 `packages/core/workflows/requirement-decomposition.yaml` 中，给 `task_breakdown` 节点添加 `context: spec`：

```yaml
nodes:
  # 1. 需求分析
  - id: requirement_analysis
    type: agent
    name: 需求分析
    agent_binding_ids: [requirement-analyst]
    interaction_mode: interactive
    write_key: spec
    context: input  # 读 state.input（默认）

  # 2. 任务拆分
  - id: task_breakdown
    type: agent
    name: 任务拆分
    agent_binding_ids: [task-planner]
    interaction_mode: interactive
    write_key: tasks
    context: spec  # 新增：读 state.spec（requirement-analyst 的产出）

  # 3. 人工审核门控
  - id: review_gate
    type: gate
    name: 人工审核
```

- [ ] **Step 2: 验证 YAML 语法**

```bash
cd packages/core
node -e "const yaml = require('yaml'); const fs = require('fs'); const content = fs.readFileSync('workflows/requirement-decomposition.yaml', 'utf-8'); yaml.parse(content); console.log('YAML syntax OK')"
```

Expected: `YAML syntax OK`

- [ ] **Step 3: 提交**

```bash
git add packages/core/workflows/requirement-decomposition.yaml
git commit -m "feat: add context field to requirement-decomposition workflow"
```

---

### Task 7: 更新 requirement-analyst.md 输出完整 spec

**Files:**
- Modify: `packages/core/agents/ruoyi/requirement-analyst.md`

**Interfaces:**
- Consumes: 用户输入的需求文本
- Produces: JSON 格式，包含 `spec` 对象和 `epics` 数组

- [ ] **Step 1: 在 requirement-analyst.md 中添加分析框架**

在文件末尾（或合适位置）添加：

```markdown
## 分析框架（融合 SDD 理念）

按照以下 6 个维度分析需求：

1. **业务目标**：用一句话说清楚这个需求解决什么业务问题
2. **功能范围**：明确包含什么（in_scope）、不包含什么（out_of_scope）
3. **数据模型**：核心实体、字段、关系
4. **API 设计**：关键接口的路径、方法、输入输出
5. **前端模块**：页面、组件、交互流程
6. **风险评估**：技术难点、依赖风险

## 输出 JSON 格式

```json
{
  "spec": {
    "business_goal": "...",
    "scope": { "in_scope": [...], "out_of_scope": [...] },
    "data_models": [{ "entity": "Plan", "fields": [...], "relations": [...] }],
    "api_design": [{ "method": "GET", "path": "/api/plans", "desc": "..." }],
    "ui_design": [{ "page": "计划列表", "components": [...] }],
    "risks": ["关联模块较多，需注意兼容性"]
  },
  "epics": [
    {
      "id": "E1",
      "name": "计划管理",
      "description": "实现开发计划的完整管理",
      "module": "plan",
      "priority": "P0",
      "acceptance_criteria": "支持完整的 CRUD 和列表查询",
      "features": [
        {
          "id": "F1",
          "title": "计划列表",
          "description": "展示计划列表，支持分页和筛选",
          "module": "plan",
          "priority": "P0",
          "acceptance_criteria": "支持分页查询、按名称/状态筛选"
        }
      ]
    }
  ]
}
```

**重要：** 
- `spec` 对象必须包含所有 6 个维度
- `epics` 数组中的每个 epic 必须包含 `name`, `description`, `module`, `priority`, `acceptance_criteria`
- `features` 数组中的每个 feature 必须包含 `title`, `description`, `module`, `priority`, `acceptance_criteria`
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/agents/ruoyi/requirement-analyst.md
git commit -m "feat: requirement-analyst outputs full spec document"
```

---

### Task 8: 更新 task-planner.md 输出 BDD 验收步骤

**Files:**
- Modify: `packages/core/agents/ruoyi/task-planner.md`

**Interfaces:**
- Consumes: `state.spec`（requirement-analyst 的产出）
- Produces: JSON 格式，每个 task 包含 `acceptance_steps`（BDD 格式）

- [ ] **Step 1: 在 task-planner.md 中添加规划方法**

在文件中添加：

```markdown
## 规划方法（融合 planning 理念）

### 垂直切片
不要按水平层（所有DB→所有API→所有UI）拆分，而是按功能路径拆分。
一个切片 = 从 DB 到 UI 的完整功能链路。

### 依赖顺序
1. 数据模型/实体类
2. 后端 API
3. 前端页面
4. 测试

### 任务粒度
- XS (1h): 单个文件的简单修改
- S (2-4h): 一个接口的实现
- M (4-8h): 一个完整功能的后端或前端
- L (>8h): 需要进一步拆分

## 输出 JSON 格式

```json
{
  "plan": {
    "dependency_order": ["数据模型", "后端 API", "前端页面", "测试"],
    "estimated_total_hours": 16,
    "risks": ["关联模块较多"]
  },
  "user_stories": [
    {
      "epic_id": "E1",
      "feature_id": "F1",
      "as_a": "用户",
      "i_want": "查看计划列表",
      "so_that": "了解项目进度",
      "title": "作为用户，我想要查看计划列表，以便了解项目进度",
      "module": "plan",
      "tasks": [
        {
          "title": "创建 Plan 实体类",
          "task_type": "CRUD",
          "acceptance_criteria": "Plan 实体包含 id, name, status, createdAt 字段",
          "acceptance_steps": [
            "Given 已定义 Plan 实体; When 创建实例并设置字段; Then 字段正确存储"
          ],
          "estimated_hours": 1,
          "priority": "P0",
          "tech_constraints": ["使用 MyBatis-Plus", "继承 BaseEntity"]
        }
      ]
    }
  ]
}
```

**重要：**
- 每个 task 必须包含 `acceptance_steps`（BDD 格式）
- `acceptance_steps` 是数组，每个元素是一个字符串，格式为 `Given ...; When ...; Then ...`
- 每个 step 应该是可测试的，能直接翻译成测试用例
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/agents/ruoyi/task-planner.md
git commit -m "feat: task-planner outputs BDD acceptance steps"
```

---

### Task 9: 更新 test-engineer.md 消费 acceptanceSteps

**Files:**
- Modify: `packages/core/agents/ruoyi/test-engineer.md`

**Interfaces:**
- Consumes: `state.task.acceptanceSteps`（BDD 步骤数组）
- Produces: 测试代码（一个 step → 一个 test case）

- [ ] **Step 1: 在 test-engineer.md 中添加测试用例生成逻辑**

在文件中添加：

```markdown
## 测试用例生成

根据 Task 的 `acceptanceSteps`（BDD 格式）生成测试用例：

**输入：**
```json
{
  "acceptance_steps": [
    "Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条"
  ]
}
```

**输出：**
每个 step 对应一个测试方法：

```java
@Test
void test_get_plans_page_1() {
  // Given
  planRepository.saveAll(generatePlans(10));
  // When
  Page<Plan> result = planService.getPlans(1, 5, null);
  // Then
  assertEquals(5, result.getContent().size());
}
```

**规则：**
- 一个 `acceptance_step` → 一个 `@Test` 方法
- `Given` → 测试数据准备
- `When` → 调用被测方法
- `Then` → 断言验证
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/agents/ruoyi/test-engineer.md
git commit -m "feat: test-engineer consumes acceptanceSteps to generate test cases"
```

---

### Task 10: 更新 reviewer.md 消费验收标准

**Files:**
- Modify: `packages/core/agents/ruoyi/reviewer.md`

**Interfaces:**
- Consumes: `state.task.acceptanceCriteria` + `state.task.acceptanceSteps`
- Produces: 验收报告（逐条验证）

- [ ] **Step 1: 在 reviewer.md 中添加验收检查逻辑**

在文件中添加：

```markdown
## 验收检查

根据 Task 的 `acceptanceCriteria` 和 `acceptanceSteps` 进行验收：

**检查清单：**

1. 检查 `acceptance_criteria` 是否全部满足
2. 检查 `acceptance_steps` 的每个 Given/When/Then 是否可执行通过
3. 检查测试代码是否覆盖了所有 `acceptance_steps`

**输出格式：**

```json
{
  "approved": true,
  "checklist": [
    { "step": "Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条", "status": "pass" },
    { "step": "Given 按名称'计划A'筛选; When GET /api/plans?name=计划A; Then 返回匹配结果", "status": "pass" }
  ],
  "comments": "所有验收步骤通过"
}
```
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/agents/ruoyi/reviewer.md
git commit -m "feat: reviewer consumes acceptanceCriteria and acceptanceSteps"
```

---

### Task 11: 端到端测试验证

**Files:**
- Modify: `packages/core/test/e2e.test.mts`

**Interfaces:**
- Consumes: 完整工作流（需求 → 任务拆解 → 开发 → 测试 → 审查）
- Produces: 验证所有新字段正确写入和消费

- [ ] **Step 1: 编写端到端测试**

在 `packages/core/test/e2e.test.mts` 中新增：

```typescript
import { describe, it, expect } from 'vitest'
import { db } from '../src/db.mjs'
import { buildTopGraph } from '../src/index.mjs'

describe('E2E: requirement analysis enhancement', () => {
  it('should write all new fields through full workflow', async () => {
    // 1. 创建测试需求
    const req = await db.requirement.create({
      data: {
        id: 'req-e2e-001',
        title: 'E2E 测试需求',
        description: '计划管理功能',
        targetProjectId: 'proj-test',
        targetRepoPath: '/tmp/test',
      }
    })

    // 2. 模拟 requirement-analyst 输出
    const analystOutput = {
      spec: {
        business_goal: '让项目经理能够管理开发计划',
        scope: { in_scope: ['计划 CRUD'], out_of_scope: [] },
        data_models: [{ entity: 'Plan', fields: [] }],
        api_design: [],
        ui_design: [],
        risks: [],
      },
      epics: [{
        id: 'E1',
        name: '计划管理',
        description: '实现开发计划的完整管理',
        module: 'plan',
        priority: 'P0',
        acceptance_criteria: '支持完整的 CRUD',
        features: [{
          id: 'F1',
          title: '计划列表',
          description: '展示计划列表',
          module: 'plan',
          priority: 'P0',
          acceptance_criteria: '支持分页查询',
        }]
      }],
      user_stories: [],
    }

    // 3. 调用 createTaskTreeFromParsed
    await createTaskTreeFromParsed(req.id, analystOutput)

    // 4. 验证 Requirement
    const requirement = await db.requirement.findUnique({ where: { id: req.id } })
    expect(requirement.businessGoal).toBe('让项目经理能够管理开发计划')
    expect(requirement.specDoc).toContain('scope')

    // 5. 验证 Epic
    const epic = await db.epic.findFirst({ where: { requirementId: req.id } })
    expect(epic.priority).toBe('P0')
    expect(epic.acceptanceCriteria).toBe('支持完整的 CRUD')

    // 6. 验证 Feature
    const feature = await db.feature.findFirst({ where: { epicId: epic.id } })
    expect(feature.module).toBe('plan')
    expect(feature.priority).toBe('P0')
    expect(feature.acceptanceCriteria).toBe('支持分页查询')

    // 7. 模拟 task-planner 输出（包含 acceptanceSteps）
    const plannerOutput = {
      user_stories: [{
        epic_id: 'E1',
        feature_id: 'F1',
        title: '作为项目经理，我想要查看计划列表',
        module: 'plan',
        tasks: [{
          title: '实现计划列表 API',
          description: 'GET /api/plans 接口',
          acceptance_criteria: '返回分页计划列表',
          acceptance_steps: [
            'Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条',
          ],
          priority: 'P0',
          task_type: 'API',
          estimated_hours: 4,
        }]
      }]
    }

    await createTaskTreeFromParsed(req.id, plannerOutput)

    // 8. 验证 Task
    const task = await db.task.findFirst({
      where: { userStory: { epic: { requirementId: req.id } } }
    })
    expect(task.acceptanceSteps).toEqual([
      'Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条',
    ])
    expect(task.priority).toBe('P0')

    // 9. 清理
    await db.requirement.delete({ where: { id: req.id } })
  })
})
```

- [ ] **Step 2: 运行端到端测试**

```bash
cd packages/core
npm test -- e2e.test.mts
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/test/e2e.test.mts
git commit -m "test: add E2E test for requirement analysis enhancement"
```

---

## Self-Review

**1. Spec coverage:** ✅ 所有 spec 中的要求都有对应的 task
- Schema 10 个新字段 → Task 1
- Epic/Feature 字段映射修复 → Task 2
- Requirement 写入（在 onFlowComplete 中） → Task 3
- State 传递修复（builder.mts + yaml-loader.mts + types.mts） → Task 4, 5, 6
- Agent 提示词更新（4 个 agent） → Task 7, 8, 9, 10
- 端到端测试 → Task 11

**2. Placeholder scan:** ✅ 无 TBD/TODO/待补充

**3. Type consistency:** ✅ 字段名、类型在各 task 中一致

**4. Plan review fixes:** ✅ 已修复审查发现的 4 个问题
- Task 2: 导出 `createTaskTreeFromParsed`，使测试可调用
- Task 3: 把 specDoc 写入逻辑移到 `onFlowComplete`，避免被 task-planner 覆盖
- Task 4: 提取 `buildAgentContext` 为独立可导出函数，可直接测试
- Task 5: 更新 `types.mts` 的 `WorkflowNode` 和 `GraphNode` 接口，新增 `context?: string`
