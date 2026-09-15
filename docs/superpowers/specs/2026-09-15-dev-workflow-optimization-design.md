# 璇玑 V4 研发工作流优化设计

> **日期**：2026-09-15
> **状态**：设计中
> **前置**：调度-执行层问题诊断与修复（2026-09-15）

---

## 一、背景与问题

### 1.1 执行数据分析

对最新任务「实现维修费用统计前端页面」的执行日志进行分析：

| 阶段 | 耗时 | 尝试次数 | 输出状态 |
|------|------|---------|---------|
| write_tests | 6.4分钟 | 1 | ok: true（测试全部通过） |
| develop | 5分钟 | 1 | ok: true |
| test | 3分钟 | 1 | ok: true（470/470 测试通过） |
| code_review | 2.5分钟 | 3次循环 | 最终 ok: true |
| code_fix | 3.5分钟 | 2次 | 配合 review |
| **总计** | **~26分钟** | - | - |

**关键发现**：
1. `write_tests` 声称"测试全部通过"，但此时代码尚未编写——这是伪 TDD
2. `code_review` 循环 3 次，每次发现问题不同，修复引入了新问题
3. `final_review` 被跳过，流程直接 completed

### 1.2 问题清单

| # | 问题 | 分类 | 严重程度 |
|---|------|------|---------|
| P0-1 | final_review 被跳过 | 架构缺陷 | P0 |
| P1-1 | TDD 名不副实 | 流程设计 | P1 |
| P1-2 | 缺少编译检查阶段（前后端分离） | 流程设计 | P1 |
| P1-3 | code_fix 引入安全漏洞 | 执行质量 | P1 |
| P1-4 | 缺少安全扫描阶段 | 流程设计 | P1 |
| P1-5 | code_fix 缺少验证机制 | 架构缺陷 | P1 |
| P2-1 | code_review 循环效率低 | 执行质量 | P2 |
| P2-2 | 死代码反复出现 | 执行质量 | P2 |
| P2-3 | 测试覆盖不足 | 执行质量 | P2 |
| P3-1 | loop_max 语义模糊 | 架构缺陷 | P3 |

---

## 二、设计目标

1. **真正的 TDD**：先写测试，运行确认失败，再写代码
2. **前后端分离的编译验证**：根据任务类型智能选择编译命令
3. **防止修复引入新问题**：code_fix 后强制回归测试
4. **安全前置**：独立的编译检查和安全扫描阶段
5. **人审不可跳过**：final_review gate 是质量最后防线
6. **提高效率**：减少无效循环，快速失败

---

## 三、新流程设计

### 3.1 节点定义

```yaml
nodes:
  # 1. 写测试（TDD Red 阶段）
  - id: write_tests
    type: agent
    name: 写测试
    agent_binding_ids: [test-engineer]
    inputs: [task]
    write_key: results

  # 2. 运行初始测试（确认失败）
  - id: run_initial_tests
    type: agent
    name: 运行初始测试
    agent_binding_ids: [tester]
    inputs: [task, write_tests]
    write_key: results

  # 3. 开发（TDD Green 阶段）
  - id: develop
    type: agent
    name: 开发
    agent_binding_ids: [ruoyi-developer]
    inputs: [task, test]
    write_key: results

  # 4. 编译检查（智能判断前后端）
  - id: compile_check
    type: agent
    name: 编译检查
    agent_binding_ids: [compiler]
    inputs: [task, develop]
    write_key: results

  # 5. 测试验证
  - id: test
    type: agent
    name: 测试验证
    agent_binding_ids: [tester]
    inputs: [task, develop]
    write_key: results

  # 6. 安全扫描
  - id: security_scan
    type: agent
    name: 安全扫描
    agent_binding_ids: [security-scanner]
    inputs: [task, develop]
    write_key: results

  # 7. 代码审查
  - id: code_review
    type: agent
    name: 代码审查
    agent_binding_ids: [reviewer]
    inputs: [task, develop, test, security_scan]
    write_key: results

  # 8. 代码修复
  - id: code_fix
    type: agent
    name: 代码修复
    agent_binding_ids: [code-fixer]
    inputs: [task, code_review, code_fix_history]
    write_key: results

  # 9. 回归测试（验证修复）
  - id: regression_test
    type: agent
    name: 回归测试
    agent_binding_ids: [tester]
    inputs: [task, code_fix]
    write_key: results

  # 10. 最终审查（人审 gate）
  - id: final_review
    type: gate
    name: 最终审查
```

### 3.2 边定义

```yaml
edges:
  # TDD Red: 写测试 → 运行测试
  - from: write_tests
    to: run_initial_tests

  # 初始测试失败 → 开发（真正的 TDD）
  - from: run_initial_tests
    to: develop
    condition:
      type: function
      config:
        name: test_fail
        source: run_initial_tests

  # 初始测试通过 → 需要重写测试（测试有问题）
  - from: run_initial_tests
    to: write_tests
    condition:
      type: function
      config:
        name: test_pass
        source: run_initial_tests
    loop_max: 1

  # 开发 → 编译检查
  - from: develop
    to: compile_check

  # 编译通过 → 测试
  - from: compile_check
    to: test
    condition:
      type: function
      config:
        name: compile_pass
        source: compile_check

  # 编译失败 → 回到开发
  - from: compile_check
    to: develop
    condition:
      type: function
      config:
        name: compile_fail
        source: compile_check
    loop_max: 2

  # 测试通过 → 安全扫描
  - from: test
    to: security_scan
    condition:
      type: function
      config:
        name: test_pass
        source: test

  # 测试失败 → 回到开发
  - from: test
    to: develop
    condition:
      type: function
      config:
        name: test_fail
        source: test
    loop_max: 2

  # 安全扫描通过 → 代码审查
  - from: security_scan
    to: code_review
    condition:
      type: function
      config:
        name: security_pass
        source: security_scan

  # 安全扫描发现问题 → 回到开发
  - from: security_scan
    to: develop
    condition:
      type: function
      config:
        name: security_issues
        source: security_scan

  # 代码审查通过 → 最终审查
  - from: code_review
    to: final_review
    condition:
      type: function
      config:
        name: code_review_pass
        source: code_review

  # 代码审查发现问题 → 代码修复
  - from: code_review
    to: code_fix
    condition:
      type: function
      config:
        name: code_review_issues
        source: code_review
    loop_max: 3

  # 代码修复 → 编译检查（防止引入编译错误）
  - from: code_fix
    to: compile_check

  # 最终审查 → 结束
  - from: final_review
    to: __end__

start:
  - write_tests
```

### 3.3 流程图

```
write_tests → run_initial_tests → develop → compile_check → test
       ↑______________|                ↑__________|        ↓
                                                         security_scan
                                                              ↓
                                                         code_review
                                                         /        \
                                                    pass/          \issues
                                                       ↓            ↓
                                                  final_review  code_fix
                                                       ↓            ↓
                                                     __end__  compile_check
                                                                  ↓
                                                             regression_test
                                                                  ↓
                                                             code_review
```

---

## 四、关键设计决策

### 4.1 前后端分离的编译检查

**问题**：项目是 RuoYi-Cloud-Plus，后端 Java + 前端 Vue，需要分别编译。

**方案**：`compile_check` agent 智能判断任务类型：

```markdown
# 编译检查 Agent

## 任务类型判断

从 `develop` 阶段修改的文件判断：
- **后端**：包含 `.java`、`.xml` 文件
  → `cd workspace/RuoYi-Cloud-Plus && mvn compile -pl <module> -am`
- **前端**：包含 `.vue`、`.ts` 文件
  → `cd workspace/plus-ui && pnpm exec vue-tsc --noEmit`
- **全栈**：两者都有 → 先后端，再前端

## 输出格式

\`\`\`json
{
  "ok": true/false,
  "backend": { "ok": true, "errors": [] },
  "frontend": { "ok": true, "errors": [] },
  "summary": "编译通过"
}
\`\`\`
```

### 4.2 真正的 TDD

**问题**：当前 `write_tests` 后直接进入 `develop`，没有验证测试是否失败。

**方案**：增加 `run_initial_tests` 节点：

1. `write_tests` 生成测试代码
2. `run_initial_tests` 运行测试，**期望失败**
3. 只有测试失败（`test_fail` 返回 true）才进入 `develop`
4. 如果测试意外通过，说明测试有问题，回退到 `write_tests`

### 4.3 code_fix 验证机制

**问题**：`code_fix` 修复问题后没有验证，可能引入新问题。

**方案**：
1. `code_fix` 后进入 `compile_check`（而非直接进入 `code_review`）
2. 编译通过后进入 `regression_test`
3. 回归测试通过后才进入 `code_review`

### 4.4 安全扫描独立阶段

**问题**：XSS 等安全问题由 `code_review` 发现，应该有独立的安全扫描阶段。

**方案**：
1. `test` 通过后进入 `security_scan`
2. 安全扫描使用工具（如 ESLint security 插件、semgrep）
3. 发现安全问题直接回退到 `develop`，而非进入 `code_fix`

### 4.5 code_fix_history 输入

**问题**：`code_fix` 缺少历史上下文，导致死代码反复出现。

**方案**：
- `code_fix` 的 inputs 增加 `code_fix_history`
- 通过 state 累积所有修复记录
- 让 agent 了解之前的修复决策，避免矛盾

---

## 五、条件函数扩展

### 5.1 新增条件函数

```typescript
// default-conditions.mts

// 编译类
export const compilePass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const compileFail: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result === null || result.ok === false
}

// 安全类
export const securityPass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const securityIssues: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result === null || result.ok === false
}
```

### 5.2 loop_max 语义澄清

**当前代码**：
```typescript
if (visits <= limit) {  // visits=3, limit=3 → true
```

**建议修正**：
```typescript
if (visits < limit) {  // visits=3, limit=3 → false
```

**或保持现有逻辑，但文档明确**：
> `loop_max: 3` 意味着"节点最多执行 4 次"（初始 1 次 + 回环 3 次）

---

## 六、P0 问题修复：final_review 被跳过

### 6.1 问题定位

基于路由逻辑分析，可能原因：

1. **LangGraph state 更新时序问题**
   - `code_review` 的输出还没写入 `state.node_outputs`
   - `routeFromSource` 评估时拿到旧数据

2. **loop_counters 判断问题**
   - `visits <= limit` 在 `visits=3, limit=3` 时仍为 true
   - 回环边评估优先于非回环边

### 6.2 修复方案

**方案 A：增加路由日志**

```typescript
export function routeFromSource(state: any, meta: RouteMeta, DEFAULT_MAX: number = 3): string {
  console.log(`[router] source=${meta.source}, loop_counters=${JSON.stringify(state.loop_counters)}`)
  console.log(`[router] node_outputs keys: ${Object.keys(state.node_outputs || {}).join(', ')}`)
  
  // ... 评估逻辑中增加日志
  
  const sourceId = e.condition.config.source
  const text = sourceId ? sourceText(state, sourceId) : null
  console.log(`[router] sourceText(${sourceId}) = ${text?.slice(0, 100)}...`)
  const result = fn(text)
  console.log(`[router] ${e.condition.config.name}() = ${result}`)
}
```

**方案 B：修正 loop_max 边界**

```typescript
// 当前：visits <= limit 允许 limit+1 次执行
// 修正：visits < limit 允许 limit 次执行
if (visits < limit) {
  // 回环逻辑
}
```

---

## 七、新增 Agent 定义

### 7.1 compiler.md

```markdown
# 编译检查 Agent

你负责验证代码能否编译通过。

## 工作路径

- 后端：`/workspace/RuoYi-Cloud-Plus`
- 前端：`/workspace/plus-ui`

## 任务类型判断

从 `develop` 阶段的输出中读取 `files_created` 和 `files_modified`：

- **后端**：包含 `.java`、`.xml` 文件
  → `mvn compile -pl <module> -am`
- **前端**：包含 `.vue`、`.ts` 文件
  → `pnpm exec vue-tsc --noEmit`
- **全栈**：两者都有 → 先后端，再前端

## 执行步骤

1. 分析 develop 输出，确定任务类型
2. cd 到对应目录
3. 执行编译命令
4. 收集错误信息
5. 输出 JSON

## 输出格式

\`\`\`json
{
  "ok": true/false,
  "backend": { "ok": true, "errors": [] },
  "frontend": { "ok": true, "errors": [] },
  "files_checked": ["backend:3", "frontend:5"],
  "summary": "编译通过" 或 "后端编译失败：类型 BookVO 未找到"
}
\`\`\`
```

### 7.2 security-scanner.md

```markdown
# 安全扫描 Agent

你负责扫描代码中的安全漏洞。

## 扫描范围

- XSS（跨站脚本攻击）
- SQL 注入
- 敏感信息泄露
- 不安全的依赖

## 执行方式

1. 使用 ESLint security 规则扫描前端代码
2. 使用 semgrep 扫描后端代码
3. 检查敏感配置文件

## 输出格式

\`\`\`json
{
  "ok": true/false,
  "issues": [
    {
      "file": "src/views/xxx.vue",
      "line": 123,
      "severity": "high",
      "type": "XSS",
      "message": "未转义的用户输入直接拼接到 HTML"
    }
  ],
  "summary": "发现 1 个高危安全问题"
}
\`\`\`
```

---

## 八、实施优先级

| 优先级 | 问题 | 修复方案 | 预计工作量 |
|--------|------|---------|-----------|
| **P0** | final_review 被跳过 | 增加路由日志定位根因 | 2小时 |
| **P1** | TDD 名不副实 | 增加 run_initial_tests 节点 | 4小时 |
| **P1** | 缺少编译检查 | 增加 compile_check 节点 | 4小时 |
| **P1** | 安全扫描缺失 | 增加 security_scan 节点 | 4小时 |
| **P1** | code_fix 缺少验证 | code_fix → compile_check → regression_test | 2小时 |
| **P2** | 死代码反复出现 | code_fix 增加 history 输入 | 2小时 |
| **P2** | 测试覆盖不足 | 改进 test-engineer prompt | 2小时 |
| **P3** | loop_max 语义 | 代码或文档修正 | 1小时 |

---

## 九、验收标准

1. **TDD 验证**：`run_initial_tests` 阶段测试必须失败才能继续
2. **编译验证**：前后端分别编译，失败立即回退
3. **安全验证**：安全扫描发现问题直接回退开发
4. **修复验证**：`code_fix` 后必须通过回归测试
5. **人审不跳过**：`final_review` gate 必须被触发
6. **日志可追溯**：路由决策有详细日志

---

## 十、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 新流程增加节点，执行时间变长 | 效率下降 | 快速失败机制，减少无效循环 |
| 安全扫描工具可能有误报 | 浪费时间 | 人工审核机制（inbox_ask） |
| 前后端编译命令路径差异 | 执行失败 | agent 读取 references 确认路径 |