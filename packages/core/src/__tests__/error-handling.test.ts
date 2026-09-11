// packages/core/src/__tests__/error-handling.test.ts
// Task 1 测试：失败留痕 + 错误不降级

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db.mjs';
import { executionStore } from '../storage/execution-store.mjs';
import { randomUUID } from 'node:crypto';

describe('Error Handling', () => {
  const testExecutionIds: string[] = [];

  beforeAll(async () => {
    // 确保 Prisma 已连接
    await db.$connect();
  });

  afterAll(async () => {
    // 清理测试数据
    if (testExecutionIds.length > 0) {
      await db.execution_events.deleteMany({
        where: { execution_id: { in: testExecutionIds } },
      });
      await db.task_executions.deleteMany({
        where: { execution_id: { in: testExecutionIds } },
      });
    }
    await db.$disconnect();
  });

  it('should write execution_events on failure', async () => {
    const execId = `test-exec-${Date.now()}`;
    testExecutionIds.push(execId);

    // 创建测试执行记录
    await db.task_executions.create({
      data: {
        execution_id: execId,
        subject_type: 'task',
        subject_id: 'test-subject',
        target_project_id: 'test-project',
        target_repo_path: '/tmp/test',
        status: 'running',
      },
    });

    // 调用 failWithEvent
    await executionStore.failWithEvent(execId, '测试失败', {
      node: 'test_node',
      visits: 3,
      errorType: 'LoopExhaustedError',
    });

    // 验证执行状态
    const execution = await db.task_executions.findUnique({
      where: { execution_id: execId },
    });
    expect(execution).not.toBeNull();
    expect(execution!.status).toBe('failed');
    expect(execution!.error_message).toContain('测试失败');
    expect(execution!.completed_at).not.toBeNull();
    expect(execution!.worker_id).toBeNull();
    expect(execution!.lease_token).toBeNull();

    // 验证事件记录
    const events = await db.execution_events.findMany({
      where: { execution_id: execId },
    });
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('failed');
    expect(events[0].from_status).toBe('running');
    expect(events[0].to_status).toBe('failed');
    expect(events[0].message).toContain('测试失败');

    // 验证 details 字段
    const details = JSON.parse(events[0].details || '{}');
    expect(details.node).toBe('test_node');
    expect(details.visits).toBe(3);
    expect(details.errorType).toBe('LoopExhaustedError');
  });

  it('should write execution_events on failure without details', async () => {
    const execId = `test-exec-simple-${Date.now()}`;
    testExecutionIds.push(execId);

    // 创建测试执行记录
    await db.task_executions.create({
      data: {
        execution_id: execId,
        subject_type: 'task',
        subject_id: 'test-subject',
        target_project_id: 'test-project',
        target_repo_path: '/tmp/test',
        status: 'running',
      },
    });

    // 调用 failWithEvent（无 details）
    await executionStore.failWithEvent(execId, '简单失败');

    // 验证执行状态
    const execution = await db.task_executions.findUnique({
      where: { execution_id: execId },
    });
    expect(execution).not.toBeNull();
    expect(execution!.status).toBe('failed');
    expect(execution!.error_message).toBe('简单失败');

    // 验证事件记录
    const events = await db.execution_events.findMany({
      where: { execution_id: execId },
    });
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('failed');
    expect(events[0].message).toBe('简单失败');
  });

  it('failWithEvent should clean up lease fields', async () => {
    const execId = `test-exec-lease-${Date.now()}`;
    testExecutionIds.push(execId);

    // 创建测试执行记录（带租约字段）
    await db.task_executions.create({
      data: {
        execution_id: execId,
        subject_type: 'task',
        subject_id: 'test-subject',
        target_project_id: 'test-project',
        target_repo_path: '/tmp/test',
        status: 'running',
        worker_id: 'test-worker',
        lease_token: 'test-token',
        lease_expires_at: new Date(Date.now() + 60000),
      },
    });

    // 调用 failWithEvent
    await executionStore.failWithEvent(execId, '清理租约测试');

    // 验证租约字段已清理
    const execution = await db.task_executions.findUnique({
      where: { execution_id: execId },
    });
    expect(execution).not.toBeNull();
    expect(execution!.worker_id).toBeNull();
    expect(execution!.lease_token).toBeNull();
    expect(execution!.lease_expires_at).toBeNull();
  });
});