// packages/core/src/__tests__/scheduler-governance.test.ts
// Task 6 测试：调度层监督 —— 预算检查 + 自动中止 + 会话未重置探针

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../db.mjs';
import { getSchedulerController, resetSchedulerController } from '../scheduler-controller.mjs';
import { randomUUID } from 'node:crypto';

describe('Scheduler Governance', () => {
  const testExecutionIds: string[] = [];
  const testPhaseIds: string[] = [];

  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    // 清理测试数据
    if (testPhaseIds.length > 0) {
      await db.phase_instances.deleteMany({
        where: { id: { in: testPhaseIds } },
      });
    }
    if (testExecutionIds.length > 0) {
      await db.task_executions.deleteMany({
        where: { execution_id: { in: testExecutionIds } },
      });
    }
    // 重置调度器单例，避免影响后续测试
    resetSchedulerController();
    await db.$disconnect();
  });

  describe('budget check', () => {
    it('should abort on max_node_visits exceeded', async () => {
      const execId = `test-gov-node-visits-${Date.now()}`;
      testExecutionIds.push(execId);

      // 创建执行记录，设置 budget_max_node_visits = 2
      await db.task_executions.create({
        data: {
          execution_id: execId,
          subject_type: 'task',
          subject_id: 'test-subject-gov',
          target_project_id: 'test-project',
          target_repo_path: '/tmp/test',
          status: 'running',
          started_at: new Date(),
          agent_invocations: 0,
          budget_max_node_visits: 2,
        },
      });

      // 创建 3 个 phase_instances（attempt 1, 2, 3 → 3 > 2 触发中止）
      // 模拟节点 dev 被执行了 3 次
      const phaseIds: string[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const phaseId = randomUUID();
        phaseIds.push(phaseId);
        testPhaseIds.push(phaseId);
        await db.phase_instances.create({
          data: {
            id: phaseId,
            execution_id: execId,
            phase_id: 'dev',
            attempt,
            status: 'completed',
            session_id: `session-${attempt}`,
          },
        });
      }

      // 调用 checkBudget
      const controller = getSchedulerController();
      await (controller as any).checkBudget(execId);

      // 验证：control_status 被置为 cancel_requested
      const execution = await db.task_executions.findUnique({
        where: { execution_id: execId },
        select: { control_status: true, error_message: true },
      });
      expect(execution).not.toBeNull();
      expect(execution!.control_status).toBe('cancel_requested');
      expect(execution!.error_message).toContain('dev');
      expect(execution!.error_message).toContain('3');
      expect(execution!.error_message).toContain('2'); // 上限
    });

    it('should NOT abort when node visits within budget', async () => {
      const execId = `test-gov-within-budget-${Date.now()}`;
      testExecutionIds.push(execId);

      // 创建执行记录，设置 budget_max_node_visits = 5
      await db.task_executions.create({
        data: {
          execution_id: execId,
          subject_type: 'task',
          subject_id: 'test-subject-within',
          target_project_id: 'test-project',
          target_repo_path: '/tmp/test',
          status: 'running',
          started_at: new Date(),
          agent_invocations: 0,
          budget_max_node_visits: 5,
        },
      });

      // 创建 3 个 phase_instances（attempt 1, 2, 3 → 3 <= 5 正常）
      for (let attempt = 1; attempt <= 3; attempt++) {
        const phaseId = randomUUID();
        testPhaseIds.push(phaseId);
        await db.phase_instances.create({
          data: {
            id: phaseId,
            execution_id: execId,
            phase_id: 'dev',
            attempt,
            status: 'completed',
            session_id: `session-${attempt}`,
          },
        });
      }

      // 调用 checkBudget
      const controller = getSchedulerController();
      await (controller as any).checkBudget(execId);

      // 验证：control_status 未被修改（仍为 idle）
      const execution = await db.task_executions.findUnique({
        where: { execution_id: execId },
        select: { control_status: true, error_message: true },
      });
      expect(execution!.control_status).toBe('idle');
      expect(execution!.error_message).toBeNull();
    });
  });

  describe('session reset detection', () => {
    it('should detect session not reset on reentry', async () => {
      const execId = `test-gov-session-${Date.now()}`;
      testExecutionIds.push(execId);

      // 创建执行记录
      await db.task_executions.create({
        data: {
          execution_id: execId,
          subject_type: 'task',
          subject_id: 'test-subject-session',
          target_project_id: 'test-project',
          target_repo_path: '/tmp/test',
          status: 'running',
          started_at: new Date(),
          agent_invocations: 0,
          budget_max_node_visits: 10,
        },
      });

      // 构造 attempt 递增但 session_id 相同的 phase_instances
      // 模拟节点 fix 被重入但 session 未重置
      for (let attempt = 1; attempt <= 2; attempt++) {
        const phaseId = randomUUID();
        testPhaseIds.push(phaseId);
        await db.phase_instances.create({
          data: {
            id: phaseId,
            execution_id: execId,
            phase_id: 'fix',
            attempt,
            status: 'completed',
            session_id: 'same-session-id', // 相同的 session_id = 未重置
          },
        });
      }

      // 调用 checkBudget
      const controller = getSchedulerController();
      await (controller as any).checkBudget(execId);

      // 验证：检测到空转
      const execution = await db.task_executions.findUnique({
        where: { execution_id: execId },
        select: { control_status: true, error_message: true },
      });
      expect(execution).not.toBeNull();
      expect(execution!.control_status).toBe('cancel_requested');
      expect(execution!.error_message).toContain('fix');
      expect(execution!.error_message).toContain('会话未重置');
    });

    it('should NOT abort when session properly reset', async () => {
      const execId = `test-gov-session-ok-${Date.now()}`;
      testExecutionIds.push(execId);

      // 创建执行记录
      await db.task_executions.create({
        data: {
          execution_id: execId,
          subject_type: 'task',
          subject_id: 'test-subject-session-ok',
          target_project_id: 'test-project',
          target_repo_path: '/tmp/test',
          status: 'running',
          started_at: new Date(),
          agent_invocations: 0,
          budget_max_node_visits: 10,
        },
      });

      // 每个 phase 有不同 session_id = session 正确重置
      for (let attempt = 1; attempt <= 2; attempt++) {
        const phaseId = randomUUID();
        testPhaseIds.push(phaseId);
        await db.phase_instances.create({
          data: {
            id: phaseId,
            execution_id: execId,
            phase_id: 'fix',
            attempt,
            status: 'completed',
            session_id: `session-${attempt}`, // 不同的 session_id = 正确重置
          },
        });
      }

      // 调用 checkBudget
      const controller = getSchedulerController();
      await (controller as any).checkBudget(execId);

      // 验证：未被中止
      const execution = await db.task_executions.findUnique({
        where: { execution_id: execId },
        select: { control_status: true, error_message: true },
      });
      expect(execution!.control_status).toBe('idle');
      expect(execution!.error_message).toBeNull();
    });
  });
});