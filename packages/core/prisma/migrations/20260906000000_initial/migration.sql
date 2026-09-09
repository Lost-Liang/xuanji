-- =============================================================================
-- Baseline migration: creates all tables for 璇玑 V4
-- This migration captures the schema state before partial unique indexes
-- and inbox waiting fields were added by subsequent migrations.
-- =============================================================================

-- CreateTable
CREATE TABLE "agent_bindings" (
    "id" TEXT NOT NULL,
    "plugin_id" TEXT,
    "agent_id" TEXT NOT NULL,
    "harness" TEXT NOT NULL DEFAULT 'claude',
    "skill_id" TEXT,
    "prompt_content" TEXT NOT NULL DEFAULT '',
    "triggers" JSONB,
    "model" TEXT,
    "reasoning_effort" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plugin_id" TEXT,
    "description" TEXT,
    "definition_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "workflow_id" TEXT DEFAULT 'requirement-decomposition',
    "target_project_id" TEXT NOT NULL,
    "target_repo_path" TEXT NOT NULL,
    "auto_execute" BOOLEAN NOT NULL DEFAULT false,
    "max_concurrent_tasks" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epics" (
    "id" TEXT NOT NULL,
    "requirement_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "epic_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stories" (
    "id" TEXT NOT NULL,
    "epic_id" TEXT,
    "feature_id" TEXT,
    "title" TEXT NOT NULL,
    "as_a" TEXT,
    "i_want" TEXT,
    "so_that" TEXT,
    "acceptance_text" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "user_story_id" TEXT,
    "epic_id" TEXT,
    "parent_task_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptance_criteria" TEXT,
    "tech_constraints" JSONB,
    "story_context" TEXT,
    "task_type" TEXT,
    "estimated_hours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "target_project_id" TEXT NOT NULL,
    "target_repo_path" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_executions" (
    "execution_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "task_id" TEXT,
    "requirement_id" TEXT,
    "graph_definition_id" TEXT,
    "thread_id" TEXT,
    "target_project_id" TEXT NOT NULL,
    "target_repo_path" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'planning',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "control_status" TEXT NOT NULL DEFAULT 'idle',
    "provider" TEXT,
    "session_id" TEXT,
    "final_output" TEXT,
    "worker_id" TEXT,
    "lease_token" TEXT,
    "fencing_token" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "rate_limit_count" INTEGER NOT NULL DEFAULT 0,
    "max_duration_min" INTEGER NOT NULL DEFAULT 240,
    "stall_timeout_min" INTEGER NOT NULL DEFAULT 10,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "retry_at" TIMESTAMP(3),

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("execution_id")
);

-- CreateTable
CREATE TABLE "phase_instances" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "phase_id" TEXT NOT NULL,
    "task_id" TEXT,
    "requirement_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "session_id" TEXT,
    "agent_used" TEXT,
    "result_summary" TEXT,
    "result_content" TEXT,
    "result_payload" JSONB,
    "result_schema_version" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phase_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phase_outputs" (
    "id" SERIAL NOT NULL,
    "phase_instance_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phase_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_events" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT,
    "session_id" TEXT,
    "turn_index" INTEGER,
    "event_type" TEXT NOT NULL,
    "role" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_questions" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT,
    "session_id" TEXT,
    "body" TEXT NOT NULL,
    "choices" JSONB,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),

    CONSTRAINT "inbox_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_logs" (
    "id" SERIAL NOT NULL,
    "execution_id" TEXT,
    "task_id" TEXT,
    "requirement_id" TEXT,
    "phase" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" SERIAL NOT NULL,
    "execution_id" TEXT,
    "task_id" TEXT,
    "phase_instance_id" TEXT,
    "phase" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'green',
    "raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interventions" (
    "id" SERIAL NOT NULL,
    "execution_id" TEXT,
    "task_id" TEXT,
    "phase_id" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "suggested_agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_events" (
    "id" SERIAL NOT NULL,
    "execution_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_events" (
    "id" SERIAL NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_execution_id" TEXT,
    "target_task_id" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduling_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL,
    "isbn" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_path_key" ON "projects"("path");

-- CreateIndex
CREATE INDEX "task_executions_status_idx" ON "task_executions"("status");

-- CreateIndex
CREATE INDEX "task_executions_subject_type_subject_id_idx" ON "task_executions"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "task_executions_lease_expires_at_idx" ON "task_executions"("lease_expires_at");

-- CreateIndex
CREATE INDEX "phase_instances_execution_id_idx" ON "phase_instances"("execution_id");

-- CreateIndex
CREATE INDEX "phase_instances_task_id_idx" ON "phase_instances"("task_id");

-- CreateIndex
CREATE INDEX "conversation_events_session_id_idx" ON "conversation_events"("session_id");

-- CreateIndex
CREATE INDEX "conversation_events_execution_id_idx" ON "conversation_events"("execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn_key" ON "books"("isbn");

-- AddForeignKey
ALTER TABLE "epics" ADD CONSTRAINT "epics_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_epic_id_fkey" FOREIGN KEY ("epic_id") REFERENCES "epics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_epic_id_fkey" FOREIGN KEY ("epic_id") REFERENCES "epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_story_id_fkey" FOREIGN KEY ("user_story_id") REFERENCES "user_stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_epic_id_fkey" FOREIGN KEY ("epic_id") REFERENCES "epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_instances" ADD CONSTRAINT "phase_instances_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_instances" ADD CONSTRAINT "phase_instances_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_instances" ADD CONSTRAINT "phase_instances_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_outputs" ADD CONSTRAINT "phase_outputs_phase_instance_id_fkey" FOREIGN KEY ("phase_instance_id") REFERENCES "phase_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_questions" ADD CONSTRAINT "inbox_questions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_phase_instance_id_fkey" FOREIGN KEY ("phase_instance_id") REFERENCES "phase_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("execution_id") ON DELETE RESTRICT ON UPDATE CASCADE;
