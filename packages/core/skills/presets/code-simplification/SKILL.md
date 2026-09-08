---
name: code-simplification
description: 简化代码以提升清晰度。在重构代码以提升清晰度而不改变行为时使用。当代码能工作但比应有的更难阅读、维护或扩展时使用。在审查积累了不必要复杂度的代码时使用。
---

# 代码简化

> 灵感来自 [Claude Code Simplifier 插件](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md)。此处改编为模型无关、流程驱动的 skill，适用于任何 AI 编码 agent。

## 概述

通过降低复杂度简化代码，同时保持完全相同的行为。目标不是更少的行数——而是更容易阅读、理解、修改和调试的代码。每次简化必须通过一个简单的测试："新团队成员是否能比原版本更快理解这段代码？"

## 何时使用

- 功能已完成且测试通过，但实现感觉比需要的更重
- 代码审查时标记了可读性或复杂度问题
- 遇到深层嵌套逻辑、长函数或不清晰的名称
- 重构在时间压力下编写的代码
- 合并分散在多个文件的相关逻辑
- 合并引入了重复或不一致的变更后

**何时不使用：**

- 代码已经干净且可读 —— 不要为了简化而简化
- 你还不理解代码做什么 —— 先理解再简化
- 代码是性能关键的，且"更简洁"版本会明显更慢
- 你即将完全重写模块 —— 简化一次性代码浪费精力

## 五大原则

### 1. 完全保持行为不变

不要改变代码做什么——只改变它如何表达。所有输入、输出、副作用、错误行为和边界情况必须保持完全相同。如果你不确定某个简化是否保持行为不变，就不要做它。

```
每次变更前问自己：
→ 这是否对每个输入产生相同的输出？
→ 这是否保持相同的错误行为？
→ 这是否保持相同的副作用和顺序？
→ 所有现有测试是否不经修改就能通过？
```

### 2. 遵循项目约定

简化意味着使代码更符合代码库风格，而不是强加外部偏好。简化前：

```
1. 阅读 CLAUDE.md / 项目约定
2. 研究相邻代码如何处理类似模式
3. 匹配项目的风格：
   - 导入顺序和模块系统
   - 函数声明风格
   - 命名约定
   - 错误处理模式
   - 类型注解深度
```

破坏项目一致性的"简化"不是简化——是干扰。

### 3. 优先清晰而非巧妙

当代码需要停顿思考才能解析时，显式代码比紧凑代码更好。

```typescript
// 不清晰：密集的三元链
const label = isNew ? 'New' : isUpdated ? 'Updated' : isArchived ? 'Archived' : 'Active';

// 清晰：可读的映射
function getStatusLabel(item: Item): string {
  if (item.isNew) return 'New';
  if (item.isUpdated) return 'Updated';
  if (item.isArchived) return 'Archived';
  return 'Active';
}
```

```typescript
// 不清晰：链式 reduce 内联逻辑
const result = items.reduce((acc, item) => ({
  ...acc,
  [item.id]: { ...acc[item.id], count: (acc[item.id]?.count ?? 0) + 1 }
}), {});

// 清晰：命名的中间步骤
const countById = new Map<string, number>();
for (const item of items) {
  countById.set(item.id, (countById.get(item.id) ?? 0) + 1);
}
```

### 4. 保持平衡

简化有一个失败模式：过度简化。注意这些陷阱：

- **过度内联** —— 删除了一个给概念命名的 helper 会让调用点更难读
- **合并不相关逻辑** —— 两个简单函数合并成一个复杂函数不是简化
- **删除"不必要"的抽象** —— 某些抽象是为了可扩展性或可测试性，不是为了复杂度
- **优化行数** —— 更少行不是目标；更容易理解才是

### 5. 限定在变更范围内

默认只简化最近修改的代码。避免顺便重构无关代码，除非被明确要求扩大范围。无范围的简化会在 diff 中产生噪音并风险意外回归。

## 简化流程

### 步骤 1：先理解再动手（切斯特顿围栏）

在更改或删除任何东西之前，理解它为什么存在。这就是切斯特顿围栏：如果你看到路中间有个围栏，你不理解它为什么在那里，就不要拆除它。先了解原因，再决定原因是否仍然适用。

```
简化前，回答：
- 这段代码的职责是什么？
- 什么调用它？它调用什么？
- 边界情况和错误路径是什么？
- 有定义预期行为的测试吗？
- 为什么可能这样写？（性能？平台限制？历史原因？）
- 检查 git blame：这段代码最初的上下文是什么？
```

如果你回答不了这些问题，你还没准备好简化。先阅读更多上下文。

### 步骤 2：识别简化机会

扫描这些模式——每一个都是具体信号，不是模糊异味：

**结构性复杂度：**

| 模式 | 信号 | 简化方式 |
|---------|--------|----------------|
| 深层嵌套（3+ 层） | 难以跟随控制流 | 将条件提取为卫语句或 helper 函数 |
| 长函数（50+ 行） | 多个职责 | 拆分为有描述名称的专注函数 |
| 嵌套三元表达式 | 需要心理栈来解析 | 替换为 if/else 链、switch 或查找对象 |
| 布尔参数标志 | `doThing(true, false, true)` | 替换为选项对象或独立函数 |
| 重复条件判断 | 多处相同的 `if` 检查 | 提取为命名良好的谓词函数 |

**命名和可读性：**

| 模式 | 信号 | 简化方式 |
|---------|--------|----------------|
| 通用名称 | `data`、`result`、`temp`、`val`、`item` | 重命名为描述内容：`userProfile`、`validationErrors` |
| 缩写名称 | `usr`、`cfg`、`btn`、`evt` | 使用完整词汇，除非缩写是通用的（`id`、`url`、`api`） |
| 误导性名称 | 名为 `get` 但也会修改状态的函数 | 重命名以反映实际行为 |
| 解释"什么"的注释 | `count++` 上方的 `// 递增计数器` | 删除注释——代码已经够清晰 |
| 解释"为什么"的注释 | `// 重试因为 API 在负载下不稳定` | 保留这些——它们携带代码无法表达的意图 |

**冗余：**

| 模式 | 信号 | 简化方式 |
|---------|--------|----------------|
| 重复逻辑 | 多处相同的 5+ 行 | 提取为共享函数 |
| 死代码 | 不可达分支、未使用变量、注释掉的代码块 | 删除（确认确实已死后） |
| 不必要的抽象 | 没有价值的包装器 | 内联包装器，直接调用底层函数 |
| 过度工程模式 | 工厂的工厂、单一策略的策略模式 | 替换为简单直接的方法 |
| 冗余类型断言 | 转换已经是推断类型的类型 | 删除断言 |

### 步骤 3：增量应用变更

一次做一个简化。每次变更后运行测试。**重构变更与功能或 bug 修复变更分开提交。** 重构并添加功能的 PR 是两个 PR——拆分它们。

```
对于每个简化：
1. 做出变更
2. 运行测试套件
3. 如果测试通过 → 提交（或继续下一个简化）
4. 如果测试失败 → 回滚并重新考虑
```

避免将多个简化批处理为单个未测试的变更。如果出问题，你需要知道是哪个简化导致的。

**500 行规则：** 如果重构会影响超过 500 行，投资自动化（codemods、sed 脚本、AST 转换）而不是手工修改。那个规模的手工编辑容易出错且审查耗时。

### 步骤 4：验证结果

所有简化完成后，退后一步评估整体：

```
对比前后：
- 简化版本确实更容易理解吗？
- 你引入了与代码库不一致的新模式吗？
- diff 干净且可审查吗？
- 队友会批准这个变更吗？
```

如果"简化"版本更难理解或审查，回滚。不是每个简化尝试都会成功。

## 语言特定指南

### TypeScript / JavaScript

```typescript
// 简化：不必要的 async 包装器
// 前
async function getUser(id: string): Promise<User> {
  return await userService.findById(id);
}
// 后
function getUser(id: string): Promise<User> {
  return userService.findById(id);
}

// 简化：冗长的条件赋值
// 前
let displayName: string;
if (user.nickname) {
  displayName = user.nickname;
} else {
  displayName = user.fullName;
}
// 后
const displayName = user.nickname || user.fullName;

// 简化：手工数组构建
// 前
const activeUsers: User[] = [];
for (const user of users) {
  if (user.isActive) {
    activeUsers.push(user);
  }
}
// 后
const activeUsers = users.filter((user) => user.isActive);

// 简化：冗余布尔返回
// 前
function isValid(input: string): boolean {
  if (input.length > 0 && input.length < 100) {
    return true;
  }
  return false;
}
// 后
function isValid(input: string): boolean {
  return input.length > 0 && input.length < 100;
}
```

### Python

```python
# 简化：冗长的字典构建
# 前
result = {}
for item in items:
    result[item.id] = item.name
# 后
result = {item.id: item.name for item in items}

# 简化：使用早期返回的嵌套条件
# 前
def process(data):
    if data is not None:
        if data.is_valid():
            if data.has_permission():
                return do_work(data)
            else:
                raise PermissionError("No permission")
        else:
            raise ValueError("Invalid data")
    else:
        raise TypeError("Data is None")
# 后
def process(data):
    if data is None:
        raise TypeError("Data is None")
    if not data.is_valid():
        raise ValueError("Invalid data")
    if not data.has_permission():
        raise PermissionError("No permission")
    return do_work(data)
```

### React / JSX

```tsx
// 简化：冗长的条件渲染
// 前
function UserBadge({ user }: Props) {
  if (user.isAdmin) {
    return <Badge variant="admin">Admin</Badge>;
  } else {
    return <Badge variant="default">User</Badge>;
  }
}
// 后
function UserBadge({ user }: Props) {
  const variant = user.isAdmin ? 'admin' : 'default';
  const label = user.isAdmin ? 'Admin' : 'User';
  return <Badge variant={variant}>{label}</Badge>;
}

// 简化：通过中间组件传递 props
// 前 —— 考虑 context 或组合是否更好地解决这个问题。
// 这是一个判断调用 —— 标记它，不要自动重构。
```

## 常见的合理化借口

| 合理化借口 | 现实 |
|---|---|
| "它能工作，不需要碰它" | 难读的能工作代码在坏了时会很难修。现在简化可以节省每次未来变更的时间。 |
| "更少行总是更简洁" | 1 行嵌套三元不比 5 行 if/else 更简洁。简洁度关乎理解速度，不是行数。 |
| "我就顺便快速简化一下这段不相关的代码" | 无范围简化产生嘈杂 diff 和不打算更改的代码中的回归风险。保持专注。 |
| "类型让它自文档化" | 类型记录结构，不是意图。命名良好的函数解释*为什么*比类型签名解释*什么*更好。 |
| "这个抽象以后可能有用" | 不要保留推测性抽象。如果现在不用，就是没有价值的复杂度。删除它，需要时再加回来。 |
| "原作者一定有理由" | 也许。检查 git blame —— 应用切斯特顿围栏。但积累的复杂度常常没有理由；它只是压力下迭代的残留物。 |
| "我会在添加这个功能时重构" | 重构与功能开发分开。混合变更更难审查、回滚和在历史中理解。 |

## 危险信号

- 需要修改测试才能通过的简化（你可能改变了行为）
- "简化"代码比原来更长更难懂
- 重命名以匹配你的偏好而非项目约定
- 因为"让代码更干净"而删除错误处理
- 简化你未完全理解的代码
- 将许多简化批处理为一个难以审查的大提交
- 重构当前任务范围外的代码而未被要求

## 验证

完成简化后：

- [ ] 所有现有测试不经修改通过
- [ ] 构建成功且无新警告
- [ ] Linter/格式化器通过（无风格回归）
- [ ] 每个简化是可审查的增量变更
- [ ] Diff 干净 —— 无无关变更混入
- [ ] 简化代码遵循项目约定（对照 CLAUDE.md 或等效检查）
- [ ] 无错误处理被删除或削弱
- [ ] 无死代码残留（未使用的导入、不可达分支）
- [ ] 队友或审查 agent 会批准变更作为净改进