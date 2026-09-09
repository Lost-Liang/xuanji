-- =============================================================================
-- 璇玑 V4 - 需求分析增强：新增 10 个字段
-- =============================================================================
-- 为 Requirement/Epic/Feature/UserStory/Task 表添加分析所需字段：
--   Requirement: business_goal, spec_doc
--   Epic: priority, acceptance_criteria
--   Feature: module, acceptance_criteria, priority
--   UserStory: module
--   Task: acceptance_steps, priority
--
-- 所有字段均为 nullable，不影响现有数据。
-- =============================================================================

-- Requirement: business_goal, spec_doc
ALTER TABLE "requirements" ADD COLUMN "business_goal" TEXT;
ALTER TABLE "requirements" ADD COLUMN "spec_doc" TEXT;

-- Epic: priority, acceptance_criteria
ALTER TABLE "epics" ADD COLUMN "priority" TEXT;
ALTER TABLE "epics" ADD COLUMN "acceptance_criteria" TEXT;

-- Feature: module, acceptance_criteria, priority
ALTER TABLE "features" ADD COLUMN "module" TEXT;
ALTER TABLE "features" ADD COLUMN "acceptance_criteria" TEXT;
ALTER TABLE "features" ADD COLUMN "priority" TEXT;

-- UserStory: module
ALTER TABLE "user_stories" ADD COLUMN "module" TEXT;

-- Task: acceptance_steps, priority
ALTER TABLE "tasks" ADD COLUMN "acceptance_steps" JSONB;
ALTER TABLE "tasks" ADD COLUMN "priority" TEXT;
