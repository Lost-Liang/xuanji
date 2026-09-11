-- =============================================================================
-- 璇玑 V4 - 调度层监督：预算治理字段
-- =============================================================================
-- 为 task_executions 表添加 agent 调用计数和预算快照字段：
--   agent_invocations: Agent 已调用次数（由 agent-node 递增）
--   budget_max_agent_invocations: Agent 调用次数上限
--   budget_max_wall_clock_minutes: 墙钟时间上限（分钟）
--   budget_max_node_visits: 节点访问次数上限
--
-- 所有 budget_* 字段均为 nullable，兼容旧数据（无预算配置的执行不会被检查）。
-- agent_invocations 默认 0，不影响现有数据。
-- =============================================================================

ALTER TABLE "task_executions" ADD COLUMN "agent_invocations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "task_executions" ADD COLUMN "budget_max_agent_invocations" INTEGER;
ALTER TABLE "task_executions" ADD COLUMN "budget_max_wall_clock_minutes" INTEGER;
ALTER TABLE "task_executions" ADD COLUMN "budget_max_node_visits" INTEGER;