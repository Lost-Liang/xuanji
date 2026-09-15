# 研发工作流 V2 使用指南

## 概述

V2 工作流基于对「实现维修费用统计前端页面」任务的执行数据分析，修复了 10 个已识别问题。

### 执行数据分析结果

| 阶段 | 耗时 | 尝试次数 | 输出状态 |
|------|------|---------|---------|
| write_tests | 6.4分钟 | 1 | ok: true（测试全部通过） |
| develop | 5分钟 | 1 | ok: true |
| test | 3分钟 | 1 | ok: true（470/470 测试通过） |
| code_review | 2.5分钟 | 3次循环 | 最终 ok: true |
| code_fix | 3.5分钟 | 2次 | 配合 review |
| **总计** | **~26分钟** | - | - |

### 关键发现

1. `write_tests` 声称"测试全部通过"，但此时代码尚未编写——这是伪 TDD
2. `code_review` 循环 3 次，每次发现问题不同，修复引入了新问题
3. `final_review` 被跳过，流程直接 completed

### 修复的问题清单

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

## 新增节点

| 节点 | 作用 | Agent |
|------|------|-------|
| run_initial_tests | 运行初始测试，确认失败（TDD Red） | tester |
| compile_check | 编译检查，智能判断前后端 | compiler |
| security_scan | 安全扫描，检测 XSS、SQL 注入等 | security-scanner |
| regression_test | 回归测试，验证修复未引入新问题 | tester |

## 流程图

```
write_tests → run_initial_tests → develop → compile_check → test
                                     ↑          ↑              ↓
                                     |          |        security_scan
                                     |          |              ↓
                                     |      code_review ←──────┘
                                     |       ↓       ↓
                                     |  final  code_fix
                                     |   review      ↓
                                     |    ↓     compile_check
                                     |  __end__      ↓
                                     └─────────regression_test
                                                     ↓
                                                code_review
```

### 节点详细说明

#### 1. write_tests → run_initial_tests

**TDD Red 阶段**：
- `write_tests`：生成测试代码
- `run_initial_tests`：运行测试，**期望失败**
- 只有测试失败才进入 `develop`（真正的 TDD）
- 如果测试意外通过，说明测试有问题

#### 2. develop → compile_check → test

**开发与验证**：
- `develop`：编写实现代码
- `compile_check`：智能判断前后端并执行编译
- `test`：运行所有测试

#### 3. test → security_scan → code_review

**安全审查**：
- `security_scan`：检测 XSS、SQL 注入等安全问题
- 发现问题直接回退到 `develop`
- `code_review`：代码质量审查

#### 4. code_review ↔ code_fix → compile_check → regression_test

**修复循环**：
- `code_fix`：修复审查发现的问题
- `compile_check`：验证修复未引入编译错误
- `regression_test`：验证修复未引入新问题
- 通过后重新进入 `code_review`

#### 5. final_review

**人审阶段**：
- 强制触发的 gate 节点
- 流程状态为 'paused'，等待人工审查
- 审查通过后流程完成

## 验收标准

### 1. TDD 验证

**验证点**：
- `run_initial_tests` 输出 `ok: false`
- `develop` 的 inputs 包含 `run_initial_tests` 的失败信息
- 如果初始测试意外通过，流程跳到 `develop`（而非卡住）

**测试命令**：
```bash
# 查看 run_initial_tests 的输出
curl http://localhost:3000/api/executions/<execution_id>/phases/run_initial_tests
```

### 2. 编译验证

**验证点**：
- 前后端分别编译，输出 `backend.ok` 和 `frontend.ok`
- 编译失败时，`ok: false` 且 errors 数组非空
- 失败立即回退到 `develop`，最多回退 2 次

**测试命令**：
```bash
# 查看编译检查的输出
curl http://localhost:3000/api/executions/<execution_id>/phases/compile_check
```

### 3. 安全验证

**验证点**：
- 安全扫描发现 high/critical 问题时，`ok: false`
- 发现问题直接回退到 `develop`，最多回退 2 次
- 安全问题包含：XSS、SQL 注入、敏感信息泄露

**测试命令**：
```bash
# 查看安全扫描的输出
curl http://localhost:3000/api/executions/<execution_id>/phases/security_scan
```

### 4. 修复验证

**验证点**：
- `code_fix` 后进入 `compile_check` → `regression_test`
- 回归测试失败时回到 `code_fix`，最多回退 2 次
- 回归测试通过后重新进入 `code_review`

**测试命令**：
```bash
# 查看回归测试的输出
curl http://localhost:3000/api/executions/<execution_id>/phases/regression_test
```

### 5. 人审不跳过

**验证点**：
- `code_review` 输出 `ok: true` 时，路由到 `final_review`
- `final_review` phase_instances 记录存在
- 流程 status 为 'paused'，等待人审

**测试命令**：
```bash
# 检查 final_review 是否存在
curl http://localhost:3000/api/executions/<execution_id>/phases/final_review

# 检查流程状态
curl http://localhost:3000/api/executions/<execution_id>
```

### 6. 日志可追溯

**验证点**：
- 路由日志包含：`source`、`condition`、`result`、`target`
- 每个条件判断有独立日志行
- `loop_counters` 变化有日志记录

**测试命令**：
```bash
# 查看路由日志
tail -f logs/core.log | grep '\[router\]'
```

## 迁移指南

### 从 V1 迁移到 V2

#### 1. 更新 requirement 的 graph_definition_id

```sql
UPDATE requirements
SET graph_definition_id = 'ruoyi-dev-flow-v2'
WHERE graph_definition_id = 'ruoyi-dev-flow';
```

#### 2. 确保新 agents 已定义

检查以下 agent 定义文件是否存在：

- `packages/core/agents/compiler.md`
- `packages/core/agents/security-scanner.md`

如果不存在，创建这些文件：

**compiler.md**：
```markdown
---
id: compiler
name: 编译检查 Agent
description: 智能判断前后端并执行编译验证
skillId: null
---

# 编译检查 Agent

你负责验证代码能否编译通过。

## 工作路径

- 后端：`/workspace/RuoYi-Cloud-Plus`
- 前端：`/workspace/RuoYi-Cloud-Plus/ruoyi-ui`

## 任务类型判断

从 `develop` 阶段的输出中读取 `files_created` 和 `files_modified`：

- **后端**：包含 `.java`、`.xml` 文件
  → `cd /workspace/RuoYi-Cloud-Plus && mvn compile -pl <module> -am`
- **前端**：包含 `.vue`、`.ts` 文件
  → `cd /workspace/RuoYi-Cloud-Plus/ruoyi-ui && pnpm exec vue-tsc --noEmit`
- **全栈**：两者都有 → 先后端，再前端

## 输出格式

{
  "ok": true/false,
  "backend": { "ok": true, "errors": [] },
  "frontend": { "ok": true, "errors": [] },
  "summary": "编译通过"
}
```

**security-scanner.md**：
```markdown
---
id: security-scanner
name: 安全扫描 Agent
description: 自动检测 XSS、SQL 注入等安全漏洞
skillId: null
---

# 安全扫描 Agent

你负责扫描代码中的安全漏洞。

## 扫描范围

- **XSS（跨站脚本攻击）**：未转义的用户输入、innerHTML 使用
- **SQL 注入**：字符串拼接 SQL、MyBatis 的 `${}` 使用
- **敏感信息泄露**：console.log 输出密码、密钥硬编码
- **不安全的依赖**：已知漏洞的依赖版本

## 输出格式

{
  "ok": true/false,
  "issues": [
    {
      "file": "src/views/xxx.vue",
      "line": 123,
      "severity": "high",
      "type": "XSS",
      "message": "未转义的用户输入直接拼接到 HTML",
      "suggestion": "使用 textContent 或 DOMPurify.sanitize()"
    }
  ],
  "summary": "发现 1 个高危安全问题"
}
```

#### 3. 验证条件函数已注册

检查 `packages/core/src/graph/default-conditions.mts` 中是否包含：

- `compile_pass` / `compile_fail`
- `security_pass` / `security_issues`

如果没有，添加：

```typescript
// 编译类条件函数
export const compilePass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const compileFail: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result === null || result.ok === false
}

// 安全类条件函数
export const securityPass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const securityIssues: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result === null || result.ok === false
}

// 注册函数
export function initDefaultConditions(): void {
  registerCondition('compile_pass', compilePass)
  registerCondition('compile_fail', compileFail)
  registerCondition('security_pass', securityPass)
  registerCondition('security_issues', securityIssues)
  // ... 其他条件函数
}
```

## 故障排查

### 问题：compile_check 失败

**症状**：
- `compile_check` 输出 `ok: false`
- 流程回退到 `develop`

**检查**：
1. 工作目录是否正确
   - 后端：`/workspace/RuoYi-Cloud-Plus`
   - 前端：`/workspace/RuoYi-Cloud-Plus/ruoyi-ui`
2. develop 输出的 files_modified 是否包含文件路径
3. 编译命令是否正确
   - 后端：`mvn compile -pl <module> -am`
   - 前端：`pnpm exec vue-tsc --noEmit`

**调试命令**：
```bash
# 查看 compile_check 的详细输出
curl http://localhost:3000/api/executions/<execution_id>/phases/compile_check | jq

# 手动测试编译命令
cd /workspace/RuoYi-Cloud-Plus
mvn compile -pl <module> -am
```

### 问题：security_scan 误报

**症状**：
- `security_scan` 报告安全问题
- 人工审查认为是误报

**解决**：
1. 检查 agent prompt 中的 severity 判断
2. 调整 high/critical 的判断标准
3. 人工审核 inbox_questions

**调试命令**：
```bash
# 查看 security_scan 的详细输出
curl http://localhost:3000/api/executions/<execution_id>/phases/security_scan | jq

# 查看 inbox_questions
curl http://localhost:3000/api/inbox | jq
```

### 问题：final_review 仍被跳过

**症状**：
- `code_review` 输出 `ok: true`
- 但流程直接完成，没有 `final_review` 阶段

**调试**：
1. 查看路由日志：
   ```bash
   tail -f logs/core.log | grep '\[router\]'
   ```
2. 检查 `code_review` 的输出是否包含 `ok: true`
3. 检查 `loop_counters['code_review']` 的值

**可能原因**：
- `code_review_issues` 条件函数返回 true
- `loop_counters['code_review']` 已达到 loop_max

**解决**：
```bash
# 查看 code_review 的输出
curl http://localhost:3000/api/executions/<execution_id>/phases/code_review | jq

# 查看 loop_counters
curl http://localhost:3000/api/executions/<execution_id> | jq '.loop_counters'
```

### 问题：run_initial_tests 意外通过

**症状**：
- `run_initial_tests` 输出 `ok: true`
- 但此时代码尚未编写

**可能原因**：
1. 测试代码有问题（如缺少断言）
2. 已有实现代码存在
3. 测试环境问题

**解决**：
1. 检查测试代码：
   ```bash
   curl http://localhost:3000/api/executions/<execution_id>/phases/write_tests | jq '.output'
   ```
2. 检查是否有已有代码：
   ```bash
   ls -la /workspace/RuoYi-Cloud-Plus/<module>/src/main/java/
   ```
3. 查看 `run_initial_tests` 的详细输出：
   ```bash
   curl http://localhost:3000/api/executions/<execution_id>/phases/run_initial_tests | jq
   ```

## 性能对比

| 指标 | V1 | V2 | 改进 |
|------|----|----|------|
| 总耗时 | ~26分钟 | 预计 ~20分钟 | 快速失败 |
| code_review 循环 | 3次 | 预计 1-2次 | 修复验证 |
| 安全问题发现 | code_review 发现 | 独立阶段 | 前置 |
| 人审触发 | 跳过 | 强制 | 质量保证 |
| 编译验证 | 无 | 前后端分离 | 提前发现问题 |
| TDD 验证 | 无 | 强制测试失败 | 真正的 TDD |

### 性能优化点

1. **快速失败**：编译检查前置，避免无效循环
2. **修复验证**：`code_fix` 后强制回归测试，减少重复修复
3. **安全前置**：独立安全扫描阶段，提前发现问题
4. **TDD 保证**：确认测试失败后再开发，确保测试有效

## 最佳实践

### 1. 创建需求时指定 V2 工作流

```typescript
const requirement = await db.requirements.create({
  data: {
    title: '实现 XXX 功能',
    description: '详细描述...',
    graph_definition_id: 'ruoyi-dev-flow-v2',  // 使用 V2
    status: 'pending'
  }
})
```

### 2. 监控流程执行

```bash
# 实时查看执行日志
tail -f logs/core.log | grep '\[router\]'

# 查看当前执行状态
curl http://localhost:3000/api/executions/<execution_id> | jq
```

### 3. 人审响应

当 `final_review` 触发时：
1. 登录 Dashboard：http://localhost:5173
2. 进入 Inbox 页面：http://localhost:5173/inbox
3. 审查问题并回答

### 4. 故障恢复

如果流程卡住：
```bash
# 检查流程状态
curl http://localhost:3000/api/executions/<execution_id> | jq '.status'

# 如果 status 为 'paused'，检查是否等待人审
curl http://localhost:3000/api/inbox | jq

# 如果 status 为 'error'，查看错误日志
curl http://localhost:3000/api/executions/<execution_id>/logs | jq
```

## 参考资料

- [研发工作流优化设计](../superpowers/specs/2026-09-15-dev-workflow-optimization-design.md)
- [实施计划](../superpowers/plans/2026-09-15-dev-workflow-optimization-impl.md)
- [启动指南](startup-guide.md)
- [状态机设计](state-machine.md)