-- =============================================================================
-- 璇玑 V4 - 添加 Partial Unique Indexes
-- =============================================================================
-- Prisma 不支持 partial unique index（带 WHERE 条件的唯一索引），
-- 因此需要通过原始 SQL 手动创建。
-- 这两个索引是并发控制的正确性约束（设计目标 3）。
--
-- 应用方式（二选一）：
--   prisma db execute --file migrations/20260907000000_add_partial_unique_indexes/migration.sql
--   或在 psql 中直接执行本文件
-- =============================================================================

-- I1: 同一时刻，一个任务最多一个活跃执行（并发控制核心约束）
-- status IN ('pending', 'running', 'paused') 的行视为"活跃"
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_executions_active_unique
ON task_executions(task_id)
WHERE status IN ('pending', 'running', 'paused');

-- 补充: lease 过期 partial index（仅 running 状态需要检查 lease）
CREATE INDEX IF NOT EXISTS idx_task_executions_lease
ON task_executions(lease_expires_at)
WHERE status = 'running';

-- I2: 同一执行中，同一阶段只能有一个活跃实例（防止阶段重复执行）
CREATE UNIQUE INDEX IF NOT EXISTS idx_phase_instances_active_unique
ON phase_instances(execution_id, phase_id)
WHERE status IN ('pending', 'running');
