# 需求分析 Agent 增强设计规格

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## 概述

当前璇玑 V4 系统的需求分析流程存在以下问题：

1. **Epic/Feature 写入质量差** - 只写了 `title`，丢失了 `description`、`module` 等关键字段
2. **task-planner 读不到 requirement-analyst 的产出** - `buildPrompt` 读的是 `s.input`，不是 `s.spec`
3. **没有 BDD 验收步骤** - 只有 `acceptanceCriteria`（一句话），没有可执行的 Given/When/Then 场景
4. **缺少 spec 文档记录** - 需求分析阶段没有生成完整的规格文档

本设计融合 `spec-driven-development` 和 `planning-and-task-breakdown` 两个 skill 的设计理念，增强需求分析和任务拆解阶段的数据质量，使下游开发/测试 agent 有更清晰的参考。

## 设计目标

1. **结构化输出** - requirement-analyst 输出完整的 spec 文档 + Epic/Feature 结构化数据
2. **高质量 DB 写入** - 修复 Epic/Feature 的字段映射，新增关键字段
3. **BDD 验收步骤** - task-planner 为每个 Task 生成 Given/When/Then 格式的验收步骤
4. **数据流贯通** - 修复 state 传递，使 task-planner 能读取 requirement-analyst 的产出
5. **下游可用** - test-engineer/reviewer 能直接使用 acceptanceSteps 进行测试验证

## 现状分析

### 当前数据流

```yaml
# requirement-decomposition.yaml
nodes:
  - id: requirement_analysis  → write_key: spec   # 输出到 state.spec
  - id: task_breakdown        → write_key: tasks  # 输出到 state.tasks
```

**问题 1：所有节点读 `s.input`**

```typescript
// builder.mts line 205
buildPrompt: (s: any) => s.input ?? s.task?.title ?? s.task?.description ?? ''
```

所有 agent 节点都读 `state.input`（原始需求文本），导致 task-planner 读不到 requirement-analyst 的产出（存在 `state.spec`）。

**问题 2：Epic/Feature 字段丢失**

```typescript
// graph-runner.mts createTaskTreeFromParsed
// Epic: 只写 title = epicData.module（不是 epicData.name!）
// Feature: 只写 title = `Feature F1`（硬编码！）
```

### 当前 Agent 输出格式

**requirement-analyst 输出：**
```json
{
  "epics": [{ "id": "E1", "name": "...", "features": [{ "id": "F1", "title": "..." }] }],
  "scope": "..."
}
```

**task-planner 输出：**
```json
{
  "user_stories": [{ "epic_id": "E1", "feature_id": "F1", "tasks": [{ "title": "...", "acceptance_criteria": "..." }] }]
}
```

## Schema 改动

### 新增字段（10 个）

| 表 | 字段 | 类型 | 用途 | 写入者 | 读取者 |
|---|---|---|---|---|---|
| Requirement | `businessGoal` | String? | 业务目标（一句话） | requirement-analyst | task-planner |
| Requirement | `specDoc` | String? | 完整 spec 文档 | requirement-analyst | task-planner, developer |
| Epic | `priority` | String? | P0/P1/P2 | requirement-analyst | task-planner |
| Epic | `acceptanceCriteria` | String? | Epic 级验收标准 | requirement-analyst | task-planner |
| Feature | `module` | String? | 所属模块 | requirement-analyst | task-planner, developer |
| Feature | `acceptanceCriteria` | String? | Feature 级验收标准 | requirement-analyst | task-planner |
| Feature | `priority` | String? | P0/P1/P2 | requirement-analyst | task-planner |
| UserStory | `module` | String? | 所属模块 | task-planner | developer |
| Task | `acceptanceSteps` | Json? | BDD 验收步骤数组 | task-planner | test-engineer, reviewer |
| Task | `priority` | String? | P0/P1/P2 | task-planner | scheduler |

### Prisma Schema 变更

```prisma
model Requirement {
  // ... existing fields ...
  businessGoal  String?   @map("business_goal")
  specDoc       String?   @map("spec_doc")
}

model Epic {
  // ... existing fields ...
  priority         String?  // P0/P1/P2
  acceptanceCriteria String? @map("acceptance_criteria")
}

model Feature {
  // ... existing fields ...
  module             String?
  acceptanceCriteria String? @map("acceptance_criteria")
  priority           String?  // P0/P1/P2
}

model UserStory {
  // ... existing fields ...
  module String?
}

model Task {
  // ... existing fields ...
  acceptanceSteps Json?    // BDD steps array
  priority        String?  // P0/P1/P2
}
```

## Agent 输出格式改动

### requirement-analyst.md 新输出格式

```json
{
  "spec": {
    "business_goal": "用一句话说清楚这个需求解决什么业务问题",
    "scope": {
      "in_scope": ["功能1", "功能2"],
      "out_of_scope": ["不包含的功能"]
    },
    "data_models": [
      {
        "entity": "Plan",
        "description": "开发计划实体",
        "fields": [
          { "name": "id", "type": "Long", "description": "主键" },
          { "name": "name", "type": "String", "description": "计划名称" }
        ],
        "relations": [
          { "entity": "Task", "type": "one-to-many" }
        ]
      }
    ],
    "api_design": [
      {
        "method": "GET",
        "path": "/api/plans",
        "description": "计划列表",
        "params": { "page": "int", "size": "int", "name": "string?" },
        "response": "Page<Plan>"
      }
    ],
    "ui_design": [
      {
        "page": "计划列表页",
        "path": "/plans",
        "components": [
          { "name": "PlanTable", "description": "计划列表表格" }
        ]
      }
    ],
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

### task-planner.md 新输出格式

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
      "priority": "P0",
      "tasks": [
        {
          "title": "创建 Plan 实体类",
          "task_type": "CRUD",
          "description": "创建 Plan 实体，包含 id, name, status, createdAt 字段",
          "acceptance_criteria": "Plan 实体包含 id, name, status, createdAt 字段",
          "acceptance_steps": [
            "Given 已定义 Plan 实体; When 创建实例并设置字段; Then 字段正确存储"
          ],
          "estimated_hours": 1,
          "priority": "P0",
          "tech_constraints": ["使用 MyBatis-Plus", "继承 BaseEntity"]
        },
        {
          "title": "实现计划列表 API",
          "task_type": "API",
          "description": "实现 GET /api/plans 接口，支持分页和筛选",
          "acceptance_criteria": "返回分页计划列表，支持按名称/状态筛选",
          "acceptance_steps": [
            "Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条",
            "Given 按名称'计划A'筛选; When GET /api/plans?name=计划A; Then 返回匹配结果"
          ],
          "estimated_hours": 4,
          "priority": "P0",
          "tech_constraints": ["MyBatis-Plus 分页", "支持多条件查询"]
        }
      ]
    }
  ]
}
```

## DB 写入修复

### graph-runner.mts 改动

**修复 `createTaskTreeFromParsed` 函数：**

```typescript
// Epic 写入
await tx.epic.create({
  data: {
    id: `epic-${nanoid(8)}`,
    requirementId: requirement.id,
    title: epicData.name || epicData.title,  // 修复：正确映射 name
    description: epicData.description,        // 新增：写入 description
    module: epicData.module,                  // 新增：写入 module
    priority: epicData.priority,              // 新增：写入 priority
    acceptanceCriteria: epicData.acceptance_criteria,  // 新增：写入验收标准
    status: 'pending'
  }
})

// Feature 写入
await tx.feature.create({
  data: {
    id: `feature-${nanoid(8)}`,
    epicId: epic.id,
    title: featureData.title || featureData.name,  // 修复：正确映射 title
    description: featureData.description,           // 新增：写入 description
    module: featureData.module,                     // 新增：写入 module
    acceptanceCriteria: featureData.acceptance_criteria,  // 新增：写入验收标准
    priority: featureData.priority,                 // 新增：写入 priority
    status: 'pending'
  }
})

// Task 写入
await tx.task.create({
  data: {
    id: `task-${nanoid(8)}`,
    userStoryId: userStory.id,
    epicId: epic.id,
    title: taskData.title,
    description: taskData.description,
    acceptanceCriteria: taskData.acceptance_criteria,
    acceptanceSteps: taskData.acceptance_steps,  // 新增：写入 BDD 步骤
    priority: taskData.priority,                 // 新增：写入 priority
    taskType: taskData.task_type,
    estimatedHours: taskData.estimated_hours,
    techConstraints: taskData.tech_constraints,
    status: 'pending'
  }
})
```

### Requirement 写入

在 `createTaskTreeFromParsed` 中，如果 `parsed.spec` 存在，更新 Requirement：

```typescript
if (parsed.spec) {
  // specDoc 只存"规格部分"，不包括 business_goal（已单独存）
  const specForDoc = { ...parsed.spec }
  delete specForDoc.business_goal
  await tx.requirement.update({
    where: { id: requirement.id },
    data: {
      businessGoal: parsed.spec.business_goal,
      specDoc: JSON.stringify(specForDoc, null, 2)  // 规格部分存为 JSON 字符串
    }
  })
}
```

## State 传递修复

### builder.mts 改动

**现有实现：**
```typescript
// builder.mts line 205
buildPrompt: (s: any) => s.input ?? s.task?.title ?? s.task?.description ?? ''
```

**问题：**
- 所有 agent 节点都读 `state.input`（原始需求文本）
- task-planner 读不到 requirement-analyst 的产出（存在 `state.spec`）

**解决方案：在 YAML 节点定义里加 `context` 字段**

```yaml
# requirement-decomposition.yaml
nodes:
  - id: requirement_analysis
    type: agent
    agent_binding_ids: [requirement-analyst]
    write_key: spec
    context: input    # 读 state.input（默认）

  - id: task_breakdown
    type: agent
    agent_binding_ids: [task-planner]
    write_key: tasks
    context: spec     # 读 state.spec（新增）
```

**builder.mts 修改：**

```typescript
// builder.mts nodeAction 里
case 'agent': {
  const contextKey = node.context || 'input'  // 从 YAML 节点定义读取 context
  
  return makeAgentNode({
    bindingIds,
    selector: node.selector,
    writeKey: node.write_key ?? 'results',
    nodeId: node.id,
    isSubgraph,
    isArchive: node.id === 'archive',
    interactionMode,
    buildPrompt: (s: any) => {
      if (contextKey === 'spec') {
        // state.spec 是 requirement-analyst 的 JSON 输出（字符串或对象）
        const specData = typeof s.spec === 'string' ? safeJsonParse(s.spec) : s.spec
        if (specData) {
          return `基于以下需求规格进行任务拆解：\n\n${JSON.stringify(specData, null, 2)}`
        }
      }
      return s.input ?? s.task?.title ?? s.task?.description ?? ''
    }
  })
}

// 辅助函数
function safeJsonParse(str: string): any {
  try { return JSON.parse(str) } catch { return null }
}
```

**关键改动：**
1. 从 YAML 节点定义读取 `context` 字段
2. 如果 `context === 'spec'`，解析 `state.spec`（JSON 字符串）并格式化
3. 生成可读的上下文文本传给 task-planner agent

### yaml-loader.mts 改动

在 `mapYamlToGraphDef` 里保留 `context` 字段：

```typescript
// yaml-loader.mts mapYamlToGraphDef 里
const nodes: GraphNode[] = def.nodes.map((wn: WorkflowNode): GraphNode => {
  const gn: GraphNode = {
    id: wn.id,
    type: wn.type,
    name: wn.name
  }
  // ... 其他字段映射 ...
  if (wn.context) gn.context = wn.context  // 新增：保留 context 字段
  return gn
})
```

## 下游 Agent 消费

### developer.md

**读取：** `state.requirement.specDoc`（完整 spec 文档，JSON 字符串）

**使用：**
```typescript
// developer agent 提示词新增
## 规格参考

基于以下规格文档进行开发：

```json
{
  "scope": { "in_scope": [...], "out_of_scope": [...] },
  "data_models": [{ "entity": "Plan", "fields": [...], "relations": [...] }],
  "api_design": [{ "method": "GET", "path": "/api/plans", ... }],
  "ui_design": [{ "page": "计划列表页", "components": [...] }],
  "risks": [...]
}
```

1. 参考 `data_models` 设计实体类（字段名、类型、关系）
2. 参考 `api_design` 设计接口（路径、方法、参数、返回）
3. 参考 `ui_design` 设计页面结构
4. 避免实现 `scope.out_of_scope` 中的功能
5. 注意 `risks` 中的技术风险，提前做好防护
```

**数据流：**
```
Requirement.specDoc (JSON 字符串)
  ↓
state.requirement (通过 buildPrompt 注入)
  ↓
developer agent 解析 JSON，参考规格文档编写代码
```

### test-engineer.md

**读取：** `state.task.acceptanceSteps`（BDD 步骤数组）

**使用：** 把每个 Given/When/Then 翻译成测试用例

```typescript
// test-engineer 提示词新增
## 测试用例生成

根据 Task 的 acceptanceSteps（BDD 格式）生成测试用例：

```json
{
  "acceptance_steps": [
    "Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条"
  ]
}
```

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

### reviewer.md

**读取：** `state.task.acceptanceCriteria` + `state.task.acceptanceSteps`

**使用：** 逐条验证实现是否正确

```typescript
// reviewer 提示词新增
## 验收检查

1. 检查 Task 的 acceptance_criteria 是否全部满足
2. 检查 acceptance_steps 的每个 Given/When/Then 是否可执行通过
3. 检查测试代码是否覆盖了所有 acceptance_steps
```

## 迁移计划

### Phase 1: Schema + DB 写入修复

1. 修改 `schema.prisma`，新增 10 个字段
2. 运行 `prisma migrate dev` 生成迁移
3. 修改 `graph-runner.mts` 的 `createTaskTreeFromParsed`，修复字段映射

### Phase 2: State 传递修复

1. 修改 `requirement-decomposition.yaml`，给 task_breakdown 节点加 `context: spec`
2. 修改 `builder.mts` 的 `buildPrompt`，支持 `context` 字段
3. 修改 `yaml-loader.mts` 的 `mapYamlToGraphDef`，保留 `context` 字段

### Phase 3: Agent 提示词更新

1. 更新 `requirement-analyst.md`，输出完整 spec + 新字段
2. 更新 `task-planner.md`，输出 acceptanceSteps + 新字段
3. 更新 `test-engineer.md`，消费 acceptanceSteps
4. 更新 `reviewer.md`，消费 acceptanceCriteria + acceptanceSteps

### Phase 4: 端到端测试

1. 创建测试需求，触发 requirement-decomposition 工作流
2. 验证 DB 中 Epic/Feature/UserStory/Task 的字段完整性
3. 验证 test-engineer 能正确读取 acceptanceSteps 生成测试代码
4. 验证 reviewer 能正确读取 acceptanceCriteria 进行审查

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Agent 输出格式不稳定 | 在 agent 提示词中给出严格的 JSON schema 示例 |
| DB 迁移影响现有数据 | 新字段都设为可选（nullable），不影响现有记录 |
| State 传递改动影响其他工作流 | `context` 字段默认为 `input`，向后兼容 |
| BDD 步骤生成质量差 | 在 task-planner 提示词中给出清晰的 BDD 示例 |

## 验收标准

1. ✅ `schema.prisma` 新增 10 个字段，迁移成功
2. ✅ `createTaskTreeFromParsed` 正确写入 Epic/Feature/UserStory/Task 的所有字段
3. ✅ `task_breakdown` 节点能读取 `state.spec`（requirement-analyst 的产出）
4. ✅ `requirement-analyst` 输出完整 spec 文档，存入 `Requirement.specDoc`
5. ✅ `task-planner` 输出 `acceptanceSteps`（BDD 格式），存入 `Task.acceptanceSteps`
6. ✅ `test-engineer` 能读取 `acceptanceSteps` 生成测试用例
7. ✅ `reviewer` 能读取 `acceptanceCriteria` + `acceptanceSteps` 进行验收检查
8. ✅ 端到端测试通过：需求 → 任务拆解 → 开发 → 测试 → 审查 全链路数据贯通

## 测试验证方案

### 单元测试

**1. `createTaskTreeFromParsed` 字段映射测试**

```typescript
// graph-runner.test.mts
test('createTaskTreeFromParsed 正确写入所有新字段', async () => {
  const parsed = {
    spec: {
      business_goal: '测试业务目标',
      scope: { in_scope: ['功能1'], out_of_scope: [] },
      data_models: [{ entity: 'Test', fields: [] }],
      api_design: [],
      ui_design: [],
      risks: []
    },
    epics: [{
      id: 'E1',
      name: '测试 Epic',
      description: 'Epic 描述',
      module: 'test',
      priority: 'P0',
      acceptance_criteria: 'Epic 验收标准',
      features: [{
        id: 'F1',
        title: '测试 Feature',
        description: 'Feature 描述',
        module: 'test',
        priority: 'P1',
        acceptance_criteria: 'Feature 验收标准'
      }]
    }],
    user_stories: [{
      epic_id: 'E1',
      feature_id: 'F1',
      title: '测试 UserStory',
      module: 'test',
      tasks: [{
        title: '测试 Task',
        description: 'Task 描述',
        acceptance_criteria: 'Task 验收标准',
        acceptance_steps: ['Given X; When Y; Then Z'],
        priority: 'P0',
        task_type: 'API',
        estimated_hours: 4,
        tech_constraints: ['约束1']
      }]
    }]
  }
  
  const requirement = await createRequirement(...)
  await createTaskTreeFromParsed(requirement.id, parsed)
  
  // 验证 Requirement
  const req = await db.requirement.findUnique({ where: { id: requirement.id } })
  expect(req.businessGoal).toBe('测试业务目标')
  expect(req.specDoc).toContain('scope')
  expect(req.specDoc).not.toContain('business_goal')  // 已去重
  
  // 验证 Epic
  const epic = await db.epic.findFirst({ where: { requirementId: requirement.id } })
  expect(epic.title).toBe('测试 Epic')
  expect(epic.description).toBe('Epic 描述')
  expect(epic.module).toBe('test')
  expect(epic.priority).toBe('P0')
  expect(epic.acceptanceCriteria).toBe('Epic 验收标准')
  
  // 验证 Feature
  const feature = await db.feature.findFirst({ where: { epicId: epic.id } })
  expect(feature.title).toBe('测试 Feature')
  expect(feature.description).toBe('Feature 描述')
  expect(feature.module).toBe('test')
  expect(feature.priority).toBe('P1')
  expect(feature.acceptanceCriteria).toBe('Feature 验收标准')
  
  // 验证 Task
  const task = await db.task.findFirst({ where: { userStoryId: expect.any(String) } })
  expect(task.title).toBe('测试 Task')
  expect(task.acceptanceCriteria).toBe('Task 验收标准')
  expect(task.acceptanceSteps).toEqual(['Given X; When Y; Then Z'])
  expect(task.priority).toBe('P0')
})
```

**2. `buildPrompt` 上下文解析测试**

```typescript
// builder.test.mts
test('buildPrompt 正确解析 state.spec', () => {
  const state = {
    spec: JSON.stringify({
      business_goal: '业务目标',
      scope: { in_scope: ['功能1'] },
      data_models: [{ entity: 'Test' }]
    })
  }
  
  const contextKey = 'spec'
  const buildPrompt = (s: any) => {
    if (contextKey === 'spec') {
      const specData = typeof s.spec === 'string' ? JSON.parse(s.spec) : s.spec
      if (specData) {
        return `基于以下需求规格进行任务拆解：\n\n${JSON.stringify(specData, null, 2)}`
      }
    }
    return s.input ?? ''
  }
  
  const result = buildPrompt(state)
  expect(result).toContain('基于以下需求规格进行任务拆解')
  expect(result).toContain('业务目标')
  expect(result).toContain('scope')
})
```

### 集成测试

**端到端流程验证**

```bash
# 1. 创建测试需求
curl -X POST http://localhost:3000/api/requirements \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试需求：计划管理",
    "description": "实现开发计划的 CRUD 和列表查询",
    "target_project_id": "proj-test",
    "target_repo_path": "/tmp/test-repo"
  }'

# 2. 触发 requirement-decomposition 工作流
curl -X POST http://localhost:3000/api/requirements/{id}/execute \
  -d '{ "workflow_id": "requirement-decomposition" }'

# 3. 等待工作流完成，检查 DB
psql postgresql://v2:v2@localhost:5433/xuanji -c "
  SELECT 
    r.title, r.business_goal, r.spec_doc IS NOT NULL as has_spec,
    e.title as epic_title, e.module, e.priority, e.acceptance_criteria IS NOT NULL as has_epic_ac,
    f.title as feature_title, f.module, f.priority, f.acceptance_criteria IS NOT NULL as has_feature_ac,
    t.title as task_title, t.priority, t.acceptance_steps IS NOT NULL as has_steps
  FROM requirements r
  JOIN epics e ON e.requirement_id = r.id
  JOIN features f ON f.epic_id = e.id
  JOIN user_stories us ON us.feature_id = f.id
  JOIN tasks t ON t.user_story_id = us.id
  WHERE r.id = '{requirement_id}'
"

# 预期结果：
# - has_spec = true
# - has_epic_ac = true
# - has_feature_ac = true
# - has_steps = true
# - 所有 title/module/priority 字段有值
```

### 链路验证

**1. test-engineer 读取 acceptanceSteps**

```typescript
// 模拟 test-engineer agent 的输入
const task = await db.task.findFirst({ where: { id: 'task-id' } })
const acceptanceSteps = task.acceptanceSteps as string[]

// 验证 BDD 格式
expect(acceptanceSteps).toBeInstanceOf(Array)
expect(acceptanceSteps.length).toBeGreaterThan(0)
for (const step of acceptanceSteps) {
  expect(step).toMatch(/Given .* When .* Then .*/)
}
```

**2. reviewer 读取验收标准**

```typescript
// 模拟 reviewer agent 的输入
const task = await db.task.findFirst({ where: { id: 'task-id' } })
const acceptanceCriteria = task.acceptanceCriteria
const acceptanceSteps = task.acceptanceSteps as string[]

// 验证 reviewer 能生成验收报告
const report = generateReviewReport(acceptanceCriteria, acceptanceSteps)
expect(report).toContain('验收检查')
expect(report.checklist.length).toBe(acceptanceSteps.length)
```

### 测试数据

**测试需求示例**

```json
{
  "title": "计划管理功能",
  "description": "实现开发计划的 CRUD 和列表查询功能",
  "target_project_id": "proj-ruoyi",
  "target_repo_path": "/Users/admin/code/ruoyi"
}
```

**预期 Agent 输出**

```json
{
  "spec": {
    "business_goal": "让项目经理能够管理开发计划，跟踪项目进度",
    "scope": {
      "in_scope": ["计划 CRUD", "计划列表分页查询", "按状态筛选"],
      "out_of_scope": ["计划审批流程", "计划导出"]
    },
    "data_models": [{
      "entity": "Plan",
      "fields": [
        { "name": "id", "type": "Long", "description": "主键" },
        { "name": "name", "type": "String", "description": "计划名称" },
        { "name": "status", "type": "Integer", "description": "0进行中 1完成" },
        { "name": "createdAt", "type": "DateTime", "description": "创建时间" }
      ]
    }],
    "api_design": [
      { "method": "GET", "path": "/api/plans", "description": "计划列表", "params": { "page": "int", "size": "int", "status": "int?" } },
      { "method": "POST", "path": "/api/plans", "description": "创建计划" },
      { "method": "PUT", "path": "/api/plans/{id}", "description": "更新计划" },
      { "method": "DELETE", "path": "/api/plans/{id}", "description": "删除计划" }
    ]
  },
  "epics": [{
    "id": "E1",
    "name": "计划管理",
    "description": "实现开发计划的完整 CRUD",
    "module": "plan",
    "priority": "P0",
    "acceptance_criteria": "支持计划的增删改查和列表分页",
    "features": [
      {
        "id": "F1",
        "title": "计划列表",
        "description": "展示计划列表，支持分页和状态筛选",
        "module": "plan",
        "priority": "P0",
        "acceptance_criteria": "分页查询，支持按状态筛选"
      },
      {
        "id": "F2",
        "title": "计划 CRUD",
        "description": "创建、更新、删除计划",
        "module": "plan",
        "priority": "P0",
        "acceptance_criteria": "CRUD 接口正常工作，数据一致性保证"
      }
    ]
  }],
  "user_stories": [{
    "epic_id": "E1",
    "feature_id": "F1",
    "title": "作为项目经理，我想要查看计划列表，以便了解项目进度",
    "module": "plan",
    "tasks": [{
      "title": "实现计划列表 API",
      "description": "GET /api/plans 接口，支持分页和状态筛选",
      "acceptance_criteria": "返回分页计划列表，支持按状态筛选",
      "acceptance_steps": [
        "Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条",
        "Given 存在进行中计划; When GET /api/plans?status=0; Then 只返回进行中的计划"
      ],
      "priority": "P0",
      "task_type": "API",
      "estimated_hours": 4
    }]
  }]
}
```
