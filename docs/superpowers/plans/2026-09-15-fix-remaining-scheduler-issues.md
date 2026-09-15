# 调度-执行层剩余问题修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 修复诊断文档中剩余的 P1-P3 问题

**Architecture:** 
- P1: 实现 PrismaSaver + 完善 phase_instances 使用
- P2: 合并重复查询 + 支持 DB 工作流 + 清理死代码
- P3: 修复 waiting 恢复的 session 上下文

**Tech Stack:** TypeScript, Prisma, PostgreSQL, LangGraph

**Spec:** `docs/superpowers/specs/2026-09-15-scheduler-execution-layer-issues.md`

**Status:** 待执行

## Global Constraints

- 不破坏现有功能
- 保持 API 向后兼容
- 所有变更需测试验证

---

## Task 1: 清理 requirement-executor.mts 死代码 (P2)

**Files:**
- Delete: `packages/core/src/graph/requirement-executor.mts`

**说明**: 429 逻辑已提取到 graph-runner.mts，此文件不再被使用

**验证**: `npx tsc --noEmit` 编译通过

---

## Task 2: 合并重复的 pending 查询 (P2)

**Files:**
- Modify: `packages/core/src/scheduler-controller.mts`
- Modify: `packages/core/src/graph/scheduler-graph.mts`

**说明**: scheduler-controller 和 scheduler-graph 都查询 pending 任务，合并为 controller 传递 executionId

---

## Task 3: 支持 DB 用户工作流 (P2)

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts:84-95`

**说明**: `loadFlow()` 对 DB 工作流返回 null，需要实现从 `graph_definitions` 加载

---

## Task 4: 修复 waiting 恢复的 session 上下文 (P3)

**Files:**
- Modify: `packages/core/src/graph/recovery-graph.mts:180-191`
- Modify: `packages/core/src/graph/graph-runner.mts` (新增 resume 逻辑)

**说明**: waiting 恢复后应使用 session_id 继续执行，而非从头开始

---

## Task 5: 完善 phase_instances 使用 (P1)

**Files:**
- Modify: `packages/core/src/graph/graph-runner.mts` (更新 stage 字段)
- Modify: `packages/dashboard/src/views/TaskDetail.vue` (动态阶段列表)

**说明**: 每个节点执行后更新 stage，Dashboard 从工作流定义读取阶段

---

## Task 6: 实现 PrismaSaver (P1)

**Files:**
- Create: `packages/core/src/graph/prisma-saver.mts`
- Modify: `packages/core/src/graph/builder.mts`
- Modify: `packages/core/prisma/schema.prisma` (新增 langgraph_checkpoints 表)

**说明**: 替换 MemorySaver，实现 Checkpoint 持久化

---

## 验证清单

- [ ] TypeScript 编译通过
- [ ] 测试通过（非数据库相关）
- [ ] 死代码已删除
- [ ] 重复查询已合并
- [ ] DB 工作流可加载
- [ ] waiting 恢复正确
- [ ] 阶段进度可见
- [ ] Checkpoint 可持久化