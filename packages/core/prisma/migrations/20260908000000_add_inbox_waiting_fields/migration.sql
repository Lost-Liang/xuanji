-- =============================================================================
-- 璇玑 V4 - 扩展 InboxQuestion 支持人机交互状态持久化
-- =============================================================================
-- 添加三个字段以支持人机交互超时检测和进程管理：
--   - waiting_since: 开始等待时间（用于超时计算）
--   - process_id: 等待进程 ID（用于进程管理）
--   - timeout_ms: 超时毫秒数（可配置超时时长）
--
-- 所有字段均为 nullable，不影响现有数据。
-- =============================================================================

-- 添加 waiting_since 字段
ALTER TABLE inbox_questions
ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;

-- 添加 process_id 字段
ALTER TABLE inbox_questions
ADD COLUMN IF NOT EXISTS process_id TEXT;

-- 添加 timeout_ms 字段
ALTER TABLE inbox_questions
ADD COLUMN IF NOT EXISTS timeout_ms INTEGER;