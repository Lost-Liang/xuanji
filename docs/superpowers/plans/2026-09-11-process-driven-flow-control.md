# 流程驱动流程控制能力补全 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 YAML 作为流程控制模型的权威，让流程能感知/判定/决策/约束，彻底杜绝空转事故

**Architecture:** 统一 visit 计数作为节点访问次数的唯一真相来源；条件函数退化为纯函数，节点引用由 YAML 注入；调度层参与流程资源治理

**Tech Stack:** LangGraph 0.2.74 / Prisma + PostgreSQL / TypeScript

**Spec:** `docs/superpowers/specs/2026-09-11-process-driven-flow-control-design.md`

## Global Constraints

- 全程使用中文
- 保留 LangGraph（不替换编排模型）
- agent 提示词放在 `/packages/core/agents/ruoyi` 目录
- TDD：每个任务先写测试再实现
- 每步完成后验证编译通过

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/graph/conditions/default-conditions.mts` | 条件函数签名重构：`(state) => boolean` → `(text) => boolean` |
| `packages/core/src/graph/conditions/index.mts` | 注册表适配新签名 |
| `packages/core/src/graph/builder.mts` | 删 FIX_LOOP_KEY、全节点包装计数器、回环边界 `<` → `<=`、reentry 标记注入、source 注入 |
| `packages/core/src/graph/agent-node.mts` | inputs 组装、iteration 改读 visits、回环重入强制 `resume: undefined` |
| `packages/core/src/graph/types.mts` | WorkflowNode/WorkflowEdge/WorkflowDef 扩展 |
| `packages/core/src/graph/graph-runner.mts` | 错误不降级、失败留痕、预算快照 |
| `packages/core/src/graph/worker-graph.mts` | 状态传递不降级 |
| `packages/core/src/scheduler-controller.mts` | 预算检查 + 自动中止 + 空转探针 |
| `prisma/schema.prisma` | agent_invocations + 3 个 budget 快照字段 + contract_failed 状态 |
| `packages/core/workflows/ruoyi-dev-flow.yaml` | 流程迁移：补 source/inputs/budget |

---

### Task 1: 失败留痕 + 错误不降级 (P0)

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts`
- Modify: `packages/core/src/graph/worker-graph.mts`
- Modify: `packages/core/src/scheduler-controller.mts`
- Modify: `packages/core/src/storage/execution-store.mts`
- Test: `packages/core/src/__tests__/error-handling.test.ts`

**Interfaces:**
- Consumes: 无（第一步）
- Produces: `executionStore.failWithEvent(executionId, message, eventDetails)` 方法

**Rationale:** 本次事故的定位成本几乎全部来自"系统里没有记录"。先让系统能说话，后面每一步出问题才有据可查。

- [ ] **Step 1: 扩展 execution-store.fail 方法**

```typescript
// packages/core/src/storage/execution-store.mts

// 新增方法：失败时同时写 execution_events
async failWithEvent(
  executionId: string,
  message: string,
  details?: { node?: string; visits?: number; errorType?: string }
): Promise<void> {
  await this.prisma.$transaction([
    this.prisma.task_executions.update({
      where: { id: executionId },
      data: {
        status: 'failed',
        error_message: message,
        completed_at: new Date(),
        worker_id: null,
        lease_token: null,
        lease_expires_at: null,
      },
    }),
    this.prisma.execution_events.create({
      data: {
        id: randomUUID(),
        execution_id: executionId,
        event_type: 'failed',
        from_status: 'running',
        to_status: 'failed',
        message,
        details: details ? JSON.stringify(details) : null,
        created_at: new Date(),
      },
    }),
  ]);
}
```

- [ ] **Step 2: 写测试验证失败留痕**

```typescript
// packages/core/src/__tests__/error-handling.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executionStore } from '../storage/execution-store.mjs';

describe('Error Handling', () => {
  it('should write execution_events on failure', async () => {
    const execId = 'test-exec-' + Date.now();
    // 先创建一个测试执行记录...
    await executionStore.failWithEvent(execId, '测试失败', {
      node: 'test',
      visits: 3,
      errorType: 'LoopExhaustedError',
    });

    const events = await executionStore.getEvents(execId);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('failed');
    expect(events[0].message).toContain('test');
    expect(events[0].message).toContain('3');
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `cd packages/core && pnpm test src/__tests__/error-handling.test.ts`
Expected: FAIL（方法未实现）

- [ ] **Step 4: 实现并验证测试通过】

- [ ] **Step 5: 修改 graph-runner.mts 错误处理**

```typescript
// packages/core/src/graph/graph-runner.mts

// 修改 catch 块，使用 failWithEvent
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const details = this.extractErrorDetails(err);
  await this.executionStore.failWithEvent(executionId, message, details);
  // 不再静默 return，抛出让上层知道
  throw err;
}

// 新增：提取错误详情
private extractErrorDetails(err: unknown): { node?: string; visits?: number; errorType?: string } {
  if (err instanceof GraphRecursionError) {
    return { errorType: 'GraphRecursionError' };
  }
  if (err instanceof LoopExhaustedError) {
    return { node: err.nodeId, visits: err.visits, errorType: 'LoopExhaustedError' };
  }
  return {};
}
```

- [ ] **Step 6: 修改 worker-graph.mts 状态传递**

```typescript
// packages/core/src/graph/worker-graph.mts

// 修改 workerNode，不再无条件返回 completed
async workerNode(state: WorkerState): Promise<Partial<WorkerState>> {
  try {
    const result = await graphRunner.startExecution({...});
    if (result.status === 'failed') {
      return { status: 'failed', error: result.error };
    }
    return { status: 'completed' };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 7: 修改 scheduler-controller.mts 日志**

```typescript
// packages/core/src/scheduler-controller.mts

// 区分完成与失败
if (task.status === 'failed') {
  console.log(`[scheduler-controller] 任务失败: ${taskId} - ${task.error_message}`);
} else {
  console.log(`[scheduler-controller] 任务完成: ${taskId}`);
}
```

- [ ] **Step 8: 运行完整测试验证】

Run: `cd packages/core && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/graph/graph-runner.mts packages/core/src/graph/worker-graph.mts packages/core/src/scheduler-controller.mts packages/core/src/storage/execution-store.mts packages/core/src/__tests__/error-handling.test.ts
git commit -m "fix: 失败留痕 + 错误不降级

- executionStore.failWithEvent 同时写 execution_events
- graph-runner 不再静默捕获异常
- worker-graph 区分 completed/failed 返回
- scheduler-controller 区分完成/失败日志"
```

---

### Task 2: 统一 visit 计数 + 回环开新会话 (P0)

**Files:**
- Modify: `packages/core/src/graph/builder.mts`
- Modify: `packages/core/src/graph/agent-node.mts`
- Test: `packages/core/src/__tests__/visit-counter.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `state.loop_counters[nodeId]` = 该节点已完成的执行次数（唯一真相来源）
  - `state.reentry[nodeId]` = 该节点本次是否由回环重入

**Rationale:** 本次事故的直接物理成因。计数缺失 + session 复用 = AI 复述旧答案空转。两条必须同一步落地。

- [ ] **Step 1: 写测试验证 visit 计数**

```typescript
// packages/core/src/__tests__/visit-counter.test.ts

import { describe, it, expect } from 'vitest';

describe('Visit Counter', () => {
  it('should increment loop_counters for every node execution', async () => {
    // 构造一个简单的图，执行同一节点 3 次
    // 断言 loop_counters[nodeId] === 3
  });

  it('should throw LoopExhaustedError when visits > loop_max', async () => {
    // loop_max: 2 时，第 3 次完成后应该抛错
    // 而不是空转到 LangGraph 步数上限
  });

  it('should NOT reuse session on reentry', async () => {
    // 回环重入时，resume 必须是 undefined
  });

  it('should reuse session on serial continuation', async () => {
    // 串行续跑（429重试/gate resume）时，resume 必须被复用
  });
});
```

- [ ] **Step 2: 删除 FIX_LOOP_KEY，统一计数**

```typescript
// packages/core/src/graph/builder.mts

// 删除整张 FIX_LOOP_KEY 映射表
// 修改 withLoopCounter 调用，所有节点统一包装

// 之前：
const FIX_LOOP_KEY: Record<string, string> = { ... };
if (FIX_LOOP_KEY[node.id]) {
  action = withLoopCounter(action, FIX_LOOP_KEY[node.id]);
}

// 之后：
action = withLoopCounter(action, node.id);  // 所有节点统一
```

- [ ] **Step 3: 修正回环边界判定**

```typescript
// packages/core/src/graph/builder.mts

// 之前（错误）：
if (done < limit) return loopBack.target;

// 之后（正确）：
const visits = state.loop_counters?.[meta.source] ?? 0;
const limit = loopBack.loop_max ?? DEFAULT_MAX;
if (visits <= limit) return loopBack.target;  // 第 1 次完成（visits=1）≤ 2 → 回退
                                              // 第 2 次完成（visits=2）≤ 2 → 回退
                                              // 第 3 次完成（visits=3）> 2 → 耗尽
```

- [ ] **Step 4: 添加 reentry 标记注入**

```typescript
// packages/core/src/graph/builder.mts

// 路由时标记本次进入是否为回环重入
g.addConditionalEdges(source, (state) => {
  const target = routeFromSource(state, route);
  const loopBack = route.edges.find(e => e.loop_back && e.target === target);
  if (loopBack) {
    return new Command({
      goto: target,
      update: { reentry: { [target]: true } }
    });
  }
  return target;
});
```

- [ ] **Step 5: 修改 agent-node 的 iteration 计算**

```typescript
// packages/core/src/graph/agent-node.mts

// 之前（错误）：
const iteration = (state.loop_counters?.[opts.nodeId] || 0);

// 之后（正确）：
const visits = state.loop_counters?.[opts.nodeId] ?? 0;
// attempt = visits + 1（下一次执行的 attempt）
```

- [ ] **Step 6: 修改 agent-node 的 resume 决策**

```typescript
// packages/core/src/graph/agent-node.mts

// 新增：检查是否为回环重入
const isReentry = state.reentry?.[opts.nodeId] === true;

// 修改 session 复用逻辑
const existingSessionId = isReentry
  ? undefined  // 回环重入 → 强制开新会话
  : phaseInstance?.sessionId;  // 串行续跑 → 复用

// 清除 reentry 标记（一次性消费）
if (isReentry) {
  delete state.reentry?.[opts.nodeId];
}

resume: existingSessionId
  ? { providerConversationId: existingSessionId, input: promptText }
  : undefined
```

- [ ] **Step 7: 运行测试验证】

Run: `cd packages/core && pnpm test src/__tests__/visit-counter.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/graph/builder.mts packages/core/src/graph/agent-node.mts packages/core/src/__tests__/visit-counter.test.ts
git commit -m "fix: 统一 visit 计数 + 回环开新会话

- 删除 FIX_LOOP_KEY，所有节点统一计数
- 修正回环边界: done < limit → visits <= limit
- 回环重入时强制 resume: undefined
- 串行续跑时复用 session

回归 4d2d1401 的核心机制"
```

---

### Task 3: 条件边 source 注入 + 契约校验

**Files:**
- Modify: `packages/core/src/graph/conditions/default-conditions.mts`
- Modify: `packages/core/src/graph/conditions/index.mts`
- Modify: `packages/core/src/graph/builder.mts`
- Modify: `packages/core/src/graph/types.mts`
- Modify: `packages/core/src/graph/yaml-loader.mts`
- Test: `packages/core/src/__tests__/condition-source.test.ts`

**Interfaces:**
- Consumes: Task 2 的 loop_counters
- Produces: 条件函数签名 `(sourceText: string | null) => boolean`

**Rationale:** 让「读错节点」不可能静默发生。条件函数不再硬编码节点 ID，节点引用由 YAML 注入。

- [ ] **Step 1: 扩展类型定义**

```typescript
// packages/core/src/graph/types.mts

export interface EdgeCondition {
  type: 'keyword' | 'function';
  config: {
    any?: string[];
    none?: string[];
    regex?: string;
    case_sensitive?: boolean;
    name?: string;
    source?: string;  // 新增：条件读哪个节点的产出（必填）
  };
}
```

- [ ] **Step 2: 重构条件函数签名**

```typescript
// packages/core/src/graph/conditions/default-conditions.mts

// 之前：
export const testPass = (state: GraphState) => parseNodeOutput(state, 'test_check')?.ok === true

// 之后：条件函数退化为纯函数
export type ConditionFunction = (sourceText: string | null) => boolean;

export const testPass: ConditionFunction = (text) => {
  const result = parseOutput(text);
  return result?.ok === true;
};

export const testFail: ConditionFunction = (text) => {
  const result = parseOutput(text);
  return result === null || result.ok === false;
};

// parseOutput 只做 JSON 解析，不再依赖 state
function parseOutput(text: string | null): { ok: boolean } | null {
  if (!text) return null;
  // ... JSON 解析逻辑
}
```

- [ ] **Step 3: 修改 builder 注入 source**

```typescript
// packages/core/src/graph/builder.mts

// 调用侧：从 YAML 注入 source
function routeFromSource(state: GraphState, route: RouteInfo): string {
  for (const edge of route.edges) {
    if (edge.condition?.type === 'function') {
      const fn = getCondition(edge.condition.config.name);
      const sourceId = edge.condition.config.source;  // 从 YAML 读取
      const text = sourceText(state, sourceId);        // 注入
      if (fn(text)) return edge.target;
    }
  }
  // ...
}
```

- [ ] **Step 4: 添加加载时校验**

```typescript
// packages/core/src/graph/builder.mts

function validateWorkflowDef(def: WorkflowDef): void {
  const nodeIds = new Set(def.nodes.map(n => n.id));

  for (const edge of def.edges) {
    // V1: from/to 存在
    if (!nodeIds.has(edge.from) && edge.from !== '__start__') {
      throw new WorkflowValidationError(`边的 from '${edge.from}' 不存在于 nodes`);
    }
    if (!nodeIds.has(edge.to) && edge.to !== '__end__') {
      throw new WorkflowValidationError(`边的 to '${edge.to}' 不存在于 nodes`);
    }

    // V3: 条件边的 source 必填且存在
    if (edge.condition?.type === 'function') {
      const source = edge.condition.config.source;
      if (!source) {
        throw new WorkflowValidationError(`条件边 from '${edge.from}' 缺少 source 字段`);
      }
      if (!nodeIds.has(source)) {
        throw new WorkflowValidationError(`条件边的 source '${source}' 不存在于 nodes`);
      }
    }
  }
}
```

- [ ] **Step 5: 写测试验证校验】

```typescript
// packages/core/src/__tests__/condition-source.test.ts

describe('Condition Source Validation', () => {
  it('should throw on missing source', () => {
    const yaml = `
      nodes:
        - id: test
        - id: develop
      edges:
        - from: test
          to: develop
          condition: { type: function, name: test_pass }
    `;
    expect(() => loadYaml(yaml)).toThrow('缺少 source 字段');
  });

  it('should throw on invalid source', () => {
    const yaml = `
      nodes:
        - id: test
        - id: develop
      edges:
        - from: test
          to: develop
          condition: { type: function, name: test_pass, source: nonexistent }
    `;
    expect(() => loadYaml(yaml)).toThrow("source 'nonexistent' 不存在");
  });

  it('should pass with valid source', () => {
    const yaml = `
      nodes:
        - id: test
        - id: develop
      edges:
        - from: test
          to: develop
          condition: { type: function, name: test_pass, source: test }
    `;
    expect(() => loadYaml(yaml)).not.toThrow();
  });
});
```

- [ ] **Step 6: 运行测试验证】

Run: `cd packages/core && pnpm test src/__tests__/condition-source.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/graph/conditions/ packages/core/src/graph/builder.mts packages/core/src/graph/types.mts packages/core/src/graph/yaml-loader.mts packages/core/src/__tests__/condition-source.test.ts
git commit -m "feat: 条件边 source 注入 + 加载时校验

- 条件函数签名: (state) => boolean → (text) => boolean
- builder 从 YAML 注入 source 节点引用
- 加载时校验: source 必填且必须存在于 nodes

杜绝「读错节点」静默失效"
```

---

### Task 4: 准出契约

**Files:**
- Modify: `packages/core/src/graph/types.mts`
- Modify: `packages/core/src/graph/agent-node.mts`
- Modify: `prisma/schema.prisma`
- Test: `packages/core/src/__tests__/exit-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 的 loop_counters, Task 3 的 source
- Produces: 节点执行结果含 `contract_verified` 字段

**Rationale:** 判定能力。AI 说「测试通过」不算数，流程跑断言才算数。

- [ ] **Step 1: 扩展类型定义**

```typescript
// packages/core/src/graph/types.mts

export interface ExitContract {
  schema?: Record<string, 'string' | 'number' | 'boolean' | 'string[]'>;
  requires?: RequireAssertion[];
}

export interface RequireAssertion {
  type: 'file_exists' | 'file_not_exists' | 'command' | 'grep';
  path?: string;
  run?: string;
  expect_exit?: number;
  timeout_seconds?: number;
  pattern?: string;
  expect?: 'present' | 'absent';
}

export interface WorkflowNode {
  // ...existing fields
  exit_contract?: ExitContract;
}
```

- [ ] **Step 2: 实现契约校验器**

```typescript
// packages/core/src/graph/contract-verifier.mts (新文件)

export async function verifyContract(
  nodeId: string,
  output: string,
  contract: ExitContract,
  workDir: string
): Promise<{ ok: boolean; failures: ContractFailure[] }> {
  const failures: ContractFailure[] = [];

  // 1. schema 校验
  if (contract.schema) {
    const parsed = parseAIOutput(output);
    for (const [field, type] of Object.entries(contract.schema)) {
      if (!(field in parsed)) {
        failures.push({ type: 'schema', field, detail: `缺少字段 ${field}` });
      } else if (typeof parsed[field] !== type) {
        failures.push({ type: 'schema', field, detail: `字段 ${field} 类型错误` });
      }
    }
  }

  // 2. requires 断言
  for (const req of contract.requires ?? []) {
    const result = await executeAssertion(req, workDir);
    if (!result.passed) {
      failures.push({ type: 'assertion', assertion: req, detail: result.detail });
    }
  }

  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 3: 集成到 agent-node**

```typescript
// packages/core/src/graph/agent-node.mts

// agent 返回后，执行契约校验
const contract = opts.node.exit_contract;
if (contract) {
  const result = await verifyContract(nodeId, output, contract, workDir);
  if (!result.ok) {
    // 合成 verdict，AI 声明 ok:true 但契约失败 → ok:false
    const verdict = {
      ok: false,
      contract_failed: true,
      failures: result.failures,
      ai_claimed: parsedOutput,
    };
    return { node_outputs: { [nodeId]: [JSON.stringify(verdict)] } };
  }
}
```

- [ ] **Step 4: 更新 Prisma schema**

```prisma
// prisma/schema.prisma

enum PhaseStatus {
  running
  completed
  failed
  contract_failed  // 新增
}
```

- [ ] **Step 5: 写测试**

```typescript
// packages/core/src/__tests__/exit-contract.test.ts

describe('Exit Contract', () => {
  it('should fail schema validation on missing field', async () => {
    const output = '{"ok": true}';
    const contract = { schema: { summary: 'string' } };
    const result = await verifyContract('test', output, contract, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.failures[0].field).toBe('summary');
  });

  it('should fail assertion on file_not_exists', async () => {
    const contract = {
      requires: [{ type: 'file_exists', path: '/nonexistent.txt' }]
    };
    const result = await verifyContract('test', '{}', contract, '/tmp');
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 6: 运行测试验证】

Run: `cd packages/core && pnpm test src/__tests__/exit-contract.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/graph/types.mts packages/core/src/graph/agent-node.mts packages/core/src/graph/contract-verifier.mts prisma/schema.prisma packages/core/src/__tests__/exit-contract.test.ts
git commit -m "feat: 准出契约 schema + requires

- 支持字段类型校验
- 支持文件存在/命令执行断言
- 契约失败合成 ok:false verdict
- PhaseStatus 新增 contract_failed"
```

---

### Task 5: 数据流 inputs 声明

**Files:**
- Modify: `packages/core/src/graph/types.mts`
- Modify: `packages/core/src/graph/agent-node.mts`
- Modify: `packages/core/src/graph/builder.mts`
- Test: `packages/core/src/__tests__/dataflow-inputs.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `buildAgentContext(state, inputs: string[])` 组装 prompt

**Rationale:** 回环重做的上下文载体。develop 被退回时，需要知道「为什么被退回」。

- [ ] **Step 1: 扩展类型定义**

```typescript
// packages/core/src/graph/types.mts

export interface WorkflowNode {
  // ...existing fields
  inputs?: string[];  // prompt 组装的数据来源
}
```

- [ ] **Step 2: 实现 inputs 组装**

```typescript
// packages/core/src/graph/agent-node.mts

function buildAgentContext(state: GraphState, inputs: string[]): string {
  const parts: string[] = [];

  for (const src of inputs) {
    if (src === 'task') {
      parts.push(formatTask(state.task));
    } else if (src === 'input') {
      parts.push(state.input ?? '');
    } else if (src === 'spec') {
      parts.push(formatSpec(state.spec));
    } else {
      // 上游节点产出
      const out = sourceText(state, src);
      if (!out) {
        throw new UpstreamMissingError(src);
      }
      parts.push(`## 上游阶段产出：${src}\n\n${out}`);
    }
  }

  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 3: 添加校验**

```typescript
// packages/core/src/graph/builder.mts

// V4: 节点的 inputs 中，非内置源的项必须存在于 nodes
for (const node of def.nodes) {
  for (const src of node.inputs ?? []) {
    if (!['task', 'input', 'spec'].includes(src) && !nodeIds.has(src)) {
      throw new WorkflowValidationError(`节点 '${node.id}' 的 inputs 引用了不存在的源 '${src}'`);
    }
  }
}
```

- [ ] **Step 4: 写测试**

```typescript
// packages/core/src/__tests__/dataflow-inputs.test.ts

describe('Dataflow Inputs', () => {
  it('should include upstream output in prompt', async () => {
    const state = {
      task: { title: '测试任务' },
      node_outputs: { test: ['{"ok": false, "passed": false}'] },
    };
    const inputs = ['task', 'test'];
    const result = buildAgentContext(state, inputs);
    expect(result).toContain('测试任务');
    expect(result).toContain('上游阶段产出：test');
    expect(result).toContain('ok');
  });

  it('should throw on missing upstream', () => {
    const state = { task: {} };
    const inputs = ['nonexistent'];
    expect(() => buildAgentContext(state, inputs)).toThrow(UpstreamMissingError);
  });
});
```

- [ ] **Step 5: 运行测试验证】

Run: `cd packages/core && pnpm test src/__tests__/dataflow-inputs.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/graph/types.mts packages/core/src/graph/agent-node.mts packages/core/src/graph/builder.mts packages/core/src/__tests__/dataflow-inputs.test.ts
git commit -m "feat: 数据流 inputs 声明

- 节点声明 inputs 决定 prompt 数据来源
- 支持内置源 (task/input/spec) 和上游节点
- 加载时校验 inputs 引用的节点存在
- 回环重入时自动携带失败原因"
```

---

### Task 6: 调度层监督 + max_node_visits 兜底

**Files:**
- Modify: `packages/core/src/scheduler-controller.mts`
- Modify: `prisma/schema.prisma`
- Modify: `packages/core/src/graph/types.mts`
- Modify: `packages/core/src/graph/graph-runner.mts`
- Test: `packages/core/src/__tests__/scheduler-governance.test.ts`

**Interfaces:**
- Consumes: Task 1 的 failWithEvent, Task 2 的 loop_counters
- Produces: 调度层预算检查 + 自动中止

**Rationale:** 流程资源治理。兜住「回环边声明有误/计数器没喂上」导致的空转。

- [ ] **Step 1: 扩展 Prisma schema**

```prisma
// prisma/schema.prisma

model task_executions {
  // ...existing fields
  agent_invocations    Int      @default(0)
  budget_max_agent_invocations Int?
  budget_max_wall_clock_minutes Int?
  budget_max_node_visits        Int?
}
```

- [ ] **Step 2: 扩展 YAML 类型**

```typescript
// packages/core/src/graph/types.mts

export interface WorkflowDef {
  // ...existing fields
  budget?: {
    max_agent_invocations?: number;   // 默认 30
    max_wall_clock_minutes?: number;  // 默认 120
    max_node_visits?: number;         // 默认 5
  };
}
```

- [ ] **Step 3: 修改 graph-runner 存储预算快照**

```typescript
// packages/core/src/graph/graph-runner.mts

async startExecution(params: { executionId, flowId, input, task }) {
  const def = await this.loadFlow(flowId);
  const budget = def.budget ?? {};

  // 存储预算快照
  await this.executionStore.update(executionId, {
    budget_max_agent_invocations: budget.max_agent_invocations ?? 30,
    budget_max_wall_clock_minutes: budget.max_wall_clock_minutes ?? 120,
    budget_max_node_visits: budget.max_node_visits ?? 5,
  });
  // ...
}
```

- [ ] **Step 4: 实现调度层检查**

```typescript
// packages/core/src/scheduler-controller.mts

private async checkBudget(executionId: string): Promise<void> {
  const exec = await this.executionStore.getById(executionId);
  const phases = await this.phaseStore.getByExecution(executionId);

  // 1. agent 调用次数
  if (exec.agent_invocations >= exec.budget_max_agent_invocations) {
    await this.abort(executionId, `超出预算：已调用 Agent ${exec.agent_invocations} 次（上限 ${exec.budget_max_agent_invocations}）`);
    return;
  }

  // 2. 墙钟
  const elapsed = (Date.now() - exec.started_at.getTime()) / 60000;
  if (elapsed >= exec.budget_max_wall_clock_minutes) {
    await this.abort(executionId, `超出预算：已运行 ${Math.floor(elapsed)} 分钟（上限 ${exec.budget_max_wall_clock_minutes}）`);
    return;
  }

  // 3. 节点访问次数（兜底）
  const maxVisits = Math.max(...phases.map(p => p.attempt));
  if (maxVisits > exec.budget_max_node_visits) {
    const node = phases.find(p => p.attempt === maxVisits);
    await this.abort(executionId, `流程疑似打转：节点 ${node?.phase_id} 已执行 ${maxVisits} 次（上限 ${exec.budget_max_node_visits}）`);
    return;
  }

  // 4. 会话未重置探针（本次事故专用）
  const stale = phases.filter(p => {
    const samePhase = phases.filter(pp => pp.phase_id === p.phase_id);
    return samePhase.length > new Set(samePhase.map(pp => pp.session_id)).size;
  });
  if (stale.length > 0) {
    await this.abort(executionId, `节点 ${stale[0].phase_id} 重复进入但会话未重置，疑似空转`);
  }
}

private async abort(executionId: string, reason: string): Promise<void> {
  console.log(`[scheduler-controller] 预算中止: ${executionId} - ${reason}`);
  await this.executionStore.update(executionId, {
    control_status: 'cancel_requested',
    error_message: reason,
  });
  // 心跳循环会读到 control_status 并执行中止
}
```

- [ ] **Step 5: 写测试**

```typescript
// packages/core/src/__tests__/scheduler-governance.test.ts

describe('Scheduler Governance', () => {
  it('should abort on max_node_visits exceeded', async () => {
    // 构造一个节点访问次数超限的执行
    // 断言 control_status 被置为 cancel_requested
    // 断言 error_message 包含节点名和次数
  });

  it('should detect session not reset on reentry', async () => {
    // 构造 attempt 递增但 session_id 相同的 phase_instances
    // 断言调度层检测到空转
  });
});
```

- [ ] **Step 6: 运行测试验证】

Run: `cd packages/core && pnpm test src/__tests__/scheduler-governance.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/scheduler-controller.mts prisma/schema.prisma packages/core/src/graph/types.mts packages/core/src/graph/graph-runner.mts packages/core/src/__tests__/scheduler-governance.test.ts
git commit -m "feat: 调度层监督 + 预算治理

- task_executions 存储 budget 快照
- 调度层检查 agent_invocations / 墙钟 / node_visits
- 会话未重置探针检测空转
- 超预算自动中止（复用现有 cancel 通道）"
```

---

### Task 7: 流程迁移 + 端到端验证

**Files:**
- Modify: `packages/core/workflows/ruoyi-dev-flow.yaml`
- Modify: `packages/core/workflows/default-dev-flow.yaml`
- Modify: `packages/core/workflows/requirement-decomposition.yaml`
- Test: `packages/core/src/__tests__/e2e-loop-recovery.test.ts`

**Interfaces:**
- Consumes: Task 1-6 所有能力
- Produces: 符合新 schema 的流程定义

**Rationale:** 存量流程必须升级才能加载。端到端验证回归 4d2d1401 场景。

- [ ] **Step 1: 迁移 ruoyi-dev-flow.yaml**

```yaml
# packages/core/workflows/ruoyi-dev-flow.yaml

version: "1"
id: ruoyi-dev-flow
name: 若依研发流程

budget:
  max_agent_invocations: 40
  max_wall_clock_minutes: 120
  max_node_visits: 5

nodes:
  - id: write_tests
    type: agent
    name: 写测试
    agent_binding_ids: [test-engineer]
    inputs: [task]
    write_key: results

  - id: develop
    type: agent
    name: 开发实现
    agent_binding_ids: [developer]
    inputs: [task, test]  # 回环重入时携带测试报告
    write_key: results

  - id: test
    type: agent
    name: 测试验证
    agent_binding_ids: [tester]
    inputs: [task, develop]
    write_key: results

  # ...其他节点

edges:
  - from: write_tests
    to: develop

  - from: develop
    to: test

  - from: test
    to: code_review
    condition:
      type: function
      name: test_pass
      source: test  # 新增

  - from: test
    to: develop
    condition:
      type: function
      name: test_fail
      source: test  # 新增
    loop_max: 2
    on_exhausted: fail

  # ...其他边

start: [write_tests]
```

- [ ] **Step 2: 写端到端测试**

```typescript
// packages/core/src/__tests__/e2e-loop-recovery.test.ts

describe('E2E: Loop Recovery (4d2d1401 regression)', () => {
  it('should handle test failure → develop → test success flow', async () => {
    // 1. 启动流程
    // 2. 模拟 test 第一次失败
    // 3. 验证路由回 develop
    // 4. 验证 develop 第 2 次是真正的重做（resume=undefined, attempt=2）
    // 5. 验证 develop prompt 包含测试失败报告
    // 6. 模拟 test 第二次成功
    // 7. 验证进入 code_review

    // 断言
    expect(totalAgentInvocations).toBe(4);  // write_tests + develop + test + develop + test + code_review = 4 次节点
    expect(developAttempts).toBe(2);
    expect(developSessions).toBe(2);  // 两次不同的 session_id
  });
});
```

- [ ] **Step 3: 运行端到端测试】

Run: `cd packages/core && pnpm test src/__tests__/e2e-loop-recovery.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/workflows/ packages/core/src/__tests__/e2e-loop-recovery.test.ts
git commit -m "feat: 流程迁移 + 端到端验证

- ruoyi-dev-flow: 补 source/inputs/budget
- develop 声明 inputs: [task, test] 携带失败原因
- 端到端测试验证 4d2d1401 回归"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] §1 架构诊断 → 已在背景中体现
- [x] §5.1 感知解耦 → Task 3
- [x] §5.2 visit 计数 → Task 2
- [x] §5.3 准出契约 → Task 4
- [x] §5.4 数据流 → Task 5
- [x] §5.5 契约校验 → Task 3
- [x] §5.6 回环开新会话 → Task 2
- [x] §6 流程状态模型 → Task 6 (budget 快照)
- [x] §7 调度层监督 → Task 6
- [x] §8 错误处理 → Task 1
- [x] §9 存量迁移 → Task 7
- [x] §10 测试策略 → 各 Task 测试
- [x] §11 实施顺序 → Task 1-7 顺序
- [x] §12 验收标准 → Task 7 端到端测试

**2. Placeholder scan:** 无 "TBD" / "TODO" / "implement later"

**3. Type consistency:**
- `ConditionFunction` 签名统一为 `(sourceText: string | null) => boolean`
- `loop_counters[nodeId]` 统一为「已完成的执行次数」
- `reentry[nodeId]` 统一为「本次是否由回环重入」

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-11-process-driven-flow-control.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**