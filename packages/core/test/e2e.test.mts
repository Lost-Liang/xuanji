// packages/core/test/e2e.test.mts
// 璇玑 V4 端到端集成测试
// 验证 Storage 层核心流程：需求 → 任务 → 执行 → 租约

import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { db } from '../src/db.mjs';
import { taskStore } from '../src/storage/task-store.mjs';
import { executionStore } from '../src/storage/execution-store.mjs';
import { requirementStore } from '../src/storage/requirement-store.mjs';
import { conversationStore } from '../src/storage/conversation-store.mjs';
import { createTaskTreeFromParsed, updateRequirementFromSpec } from '../src/graph/graph-runner.mjs';

// ============================================================================
// PostgreSQL 可用性检测 —— 数据库不可用时跳过全部测试
// 使用同步方式在模块加载时检测，以便条件性跳过 describe 块
// ============================================================================

function checkPgAvailable(): boolean {
  try {
    // 通过 Node.js 尝试连接 PostgreSQL，同步判断可用性
    const result = execSync(
      `node -e "const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL||'postgresql://postgres:postgres@localhost:5432/xuanji'});c.connect().then(()=>{console.log('OK');c.end()}).catch(()=>{console.log('FAIL');process.exit(1)})"`,
      { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() }
    );
    return result.toString().trim().includes('OK');
  } catch {
    return false;
  }
}

const pgAvailable = checkPgAvailable();

// 条件性 describe —— PostgreSQL 不可用时整个套件标记为 skipped
const describeIf = pgAvailable ? describe : describe.skip;

afterAll(async () => {
  if (pgAvailable) {
    await db.$disconnect();
  }
});

// ============================================================================
// 测试套件 —— PostgreSQL 不可用时全部跳过
// ============================================================================

describeIf('璇玑 V4 E2E 集成测试', () => {

  // --------------------------------------------------------------------------
  // 1. 需求管理
  // --------------------------------------------------------------------------
  describe('需求管理 (RequirementStore)', () => {
    const testIds: string[] = [];

    it('应该能创建需求', async () => {
      const r = await requirementStore.create({
        title: 'E2E 测试需求',
        description: '端到端测试自动创建的需求',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });

      expect(r.id).toBeTruthy();
      expect(r.title).toBe('E2E 测试需求');
      expect(r.status).toBe('draft');
      expect(r.targetProjectId).toBe('xuanji-e2e-test');
      testIds.push(r.id);
    });

    it('应该能根据 ID 查询需求', async () => {
      // 先创建一个需求
      const created = await requirementStore.create({
        title: '查询测试需求',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testIds.push(created.id);

      // 查询并验证
      const found = await requirementStore.getById(created.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('查询测试需求');
    });

    it('应该能更新需求状态', async () => {

      const r = await requirementStore.create({
        title: '状态更新测试需求',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testIds.push(r.id);

      const updated = await requirementStore.updateStatus(r.id, 'active');
      expect(updated.status).toBe('active');
    });

    it('应该能列出所有需求', async () => {

      const list = await requirementStore.list();
      expect(Array.isArray(list)).toBe(true);
      // 前面测试已创建多条需求，列表应不为空
      expect(list.length).toBeGreaterThan(0);
    });

    // 清理测试数据
    afterAll(async () => {
      for (const id of testIds) {
        await db.requirement.delete({ where: { id } }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. 任务管理
  // --------------------------------------------------------------------------
  describe('任务管理 (TaskStore)', () => {
    const testIds: string[] = [];

    it('应该能创建任务', async () => {

      const t = await taskStore.create({
        title: 'E2E 测试任务',
        description: '端到端测试自动创建的任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });

      expect(t.id).toBeTruthy();
      expect(t.title).toBe('E2E 测试任务');
      expect(t.status).toBe('pending');
      testIds.push(t.id);
    });

    it('创建的任务默认状态应为 pending', async () => {

      const t = await taskStore.create({
        title: '状态检查任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testIds.push(t.id);

      expect(t.status).toBe('pending');
    });

    it('应该能更新任务状态为 running 并记录 startedAt', async () => {

      const t = await taskStore.create({
        title: '状态流转任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testIds.push(t.id);

      const running = await taskStore.updateStatus(t.id, 'running');
      expect(running.status).toBe('running');
      expect(running.startedAt).toBeTruthy();
    });

    it('应该能获取下一个待执行任务', async () => {

      const t = await taskStore.create({
        title: '待执行任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
        sequence: 999, // 使用大序号确保排在后面
      });
      testIds.push(t.id);

      const next = await taskStore.getNextPending();
      expect(next).toBeTruthy();
      expect(next!.status).toBe('pending');
    });

    // 清理测试数据
    afterAll(async () => {
      for (const id of testIds) {
        await db.task.delete({ where: { id } }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. 执行实例 + 租约管理（核心并发控制）
  // --------------------------------------------------------------------------
  describe('执行与租约 (ExecutionStore)', () => {
    const testExecutionIds: string[] = [];
    const testTaskIds: string[] = [];

    it('应该能创建执行实例', async () => {
      // 先创建一个任务作为执行目标
      const t = await taskStore.create({
        title: '租约测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });

      expect(e.executionId).toBeTruthy();
      expect(e.status).toBe('pending');
      expect(e.subjectType).toBe('task');
      expect(e.fencingToken).toBe(0);
      testExecutionIds.push(e.executionId);
    });

    it('应该能获取租约 (acquireLease)', async () => {
      // 创建任务和执行实例
      const t = await taskStore.create({
        title: 'lease 测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 获取租约
      const lease = await executionStore.acquireLease(e.executionId, 'worker-test-1');
      expect(lease).toBeTruthy();
      expect(lease!.workerId).toBe('worker-test-1');
      expect(lease!.leaseToken).toBeTruthy();
      expect(lease!.fencingToken).toBeGreaterThan(0);
    });

    it('同一执行实例不应被两个 Worker 同时获取租约', async () => {

      const t = await taskStore.create({
        title: '互斥租约测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 第一个 Worker 获取租约 —— 应该成功
      const lease1 = await executionStore.acquireLease(e.executionId, 'worker-A');
      expect(lease1).toBeTruthy();

      // 第二个 Worker 尝试获取同一执行的租约 —— 应该失败
      const lease2 = await executionStore.acquireLease(e.executionId, 'worker-B');
      expect(lease2).toBeNull();
    });

    it('应该能续期心跳', async () => {

      const t = await taskStore.create({
        title: '心跳测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      const lease = await executionStore.acquireLease(e.executionId, 'worker-heartbeat');
      expect(lease).toBeTruthy();

      // 续期心跳
      const renewed = await executionStore.renewHeartbeat(e.executionId, lease!);
      expect(renewed).toBe(true);
    });

    it('应该能释放租约并允许重新获取', async () => {

      const t = await taskStore.create({
        title: '释放租约测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 第一个 Worker 获取租约
      const lease1 = await executionStore.acquireLease(e.executionId, 'worker-release');
      expect(lease1).toBeTruthy();

      // 释放租约
      await executionStore.releaseLease(e.executionId, lease1!);

      // 另一个 Worker 应该能获取租约
      const lease2 = await executionStore.acquireLease(e.executionId, 'worker-new');
      expect(lease2).toBeTruthy();
      expect(lease2!.workerId).toBe('worker-new');
    });

    it('应该能标记执行完成', async () => {

      const t = await taskStore.create({
        title: '完成标记测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 获取租约 → 标记完成
      const lease = await executionStore.acquireLease(e.executionId, 'worker-complete');
      expect(lease).toBeTruthy();

      await executionStore.complete(e.executionId, '任务执行成功，输出结果');

      // 验证状态已更新
      const completed = await executionStore.get(e.executionId);
      expect(completed!.status).toBe('completed');
      expect(completed!.finalOutput).toBe('任务执行成功，输出结果');
      // 租约字段应被清理
      expect(completed!.workerId).toBeNull();
      expect(completed!.leaseToken).toBeNull();
    });

    it('应该能标记执行失败', async () => {

      const t = await taskStore.create({
        title: '失败标记测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      const lease = await executionStore.acquireLease(e.executionId, 'worker-fail');
      await executionStore.fail(e.executionId, '编译失败：缺少依赖');

      const failed = await executionStore.get(e.executionId);
      expect(failed!.status).toBe('failed');
      expect(failed!.errorMessage).toBe('编译失败：缺少依赖');
    });

    it('应该能标记限流 (429) 并重试', async () => {

      const t = await taskStore.create({
        title: '限流测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testTaskIds.push(t.id);

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 模拟 429 限流
      const retryAt = new Date(Date.now() + 5 * 60 * 1000); // 5 分钟后重试
      await executionStore.setRateLimited(e.executionId, retryAt, 'API rate limit exceeded');

      const rateLimited = await executionStore.get(e.executionId);
      expect(rateLimited!.status).toBe('rate_limited');
      expect(rateLimited!.rateLimitCount).toBe(1);
      expect(rateLimited!.errorMessage).toBe('API rate limit exceeded');
    });

    // 清理测试数据
    afterAll(async () => {
      for (const id of testExecutionIds) {
        await db.taskExecution.delete({ where: { executionId: id } }).catch(() => {});
      }
      for (const id of testTaskIds) {
        await db.task.delete({ where: { id } }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. 对话事件存储（V4 新增功能）
  // --------------------------------------------------------------------------
  describe('对话事件 (ConversationStore)', () => {
    const testExecutionIds: string[] = [];
    const testEventIds: string[] = [];

    it('应该能保存对话事件', async () => {
      // 创建一个执行实例作为关联
      const t = await taskStore.create({
        title: '对话事件测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 保存 model_started 事件
      const event = await conversationStore.saveEvent({
        executionId: e.executionId,
        sessionId: 'session-test-001',
        turnIndex: 0,
        eventType: 'model_started',
        role: 'assistant',
        payload: { model: 'claude-3-opus', prompt: '请实现一个排序算法' },
      });

      expect(event.id).toBeTruthy();
      expect(event.eventType).toBe('model_started');
      testEventIds.push(event.id);
    });

    it('应该能按执行实例 ID 查询对话流', async () => {

      const t = await taskStore.create({
        title: '对话查询测试任务',
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });

      const e = await executionStore.create({
        subjectType: 'task',
        subjectId: t.id,
        taskId: t.id,
        targetProjectId: 'xuanji-e2e-test',
        targetRepoPath: '/tmp/xuanji-e2e-test',
      });
      testExecutionIds.push(e.executionId);

      // 保存多个事件
      const e1 = await conversationStore.saveEvent({
        executionId: e.executionId,
        eventType: 'model_started',
        role: 'assistant',
        payload: { model: 'claude-3-opus' },
      });
      testEventIds.push(e1.id);

      const e2 = await conversationStore.saveEvent({
        executionId: e.executionId,
        eventType: 'tool_started',
        role: 'assistant',
        payload: { tool: 'Bash', input: 'ls -la' },
      });
      testEventIds.push(e2.id);

      const e3 = await conversationStore.saveEvent({
        executionId: e.executionId,
        eventType: 'tool_completed',
        role: 'assistant',
        payload: { tool: 'Bash', output: 'file1.ts file2.ts' },
      });
      testEventIds.push(e3.id);

      // 查询对话流
      const events = await conversationStore.getByExecution(e.executionId);
      expect(events.length).toBe(3);
      expect(events[0].eventType).toBe('model_started');
      expect(events[1].eventType).toBe('tool_started');
      expect(events[2].eventType).toBe('tool_completed');
    });

    it('应该能按会话 ID 查询对话流', async () => {

      const sessionId = `session-e2e-${Date.now()}`;

      const ev1 = await conversationStore.saveEvent({
        sessionId,
        eventType: 'model_started',
        payload: { model: 'claude-3-opus' },
      });
      testEventIds.push(ev1.id);

      const ev2 = await conversationStore.saveEvent({
        sessionId,
        eventType: 'final_output',
        payload: { content: '实现完成' },
      });
      testEventIds.push(ev2.id);

      const events = await conversationStore.getBySession(sessionId);
      expect(events.length).toBe(2);
    });

    // 清理测试数据
    afterAll(async () => {
      for (const id of testEventIds) {
        await db.conversationEvent.delete({ where: { id } }).catch(() => {});
      }
      for (const id of testExecutionIds) {
        await db.taskExecution.delete({ where: { executionId: id } }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. 完整流程集成测试（端到端场景模拟）
  // --------------------------------------------------------------------------
  describe('完整流程集成', () => {
    const cleanupIds: { requirements: string[]; tasks: string[]; executions: string[]; events: string[] } = {
      requirements: [],
      tasks: [],
      executions: [],
      events: [],
    };

    it('完整流程：需求 → 任务 → 执行 → 租约 → 对话 → 完成', async () => {
      // Step 1: 创建需求
      const requirement = await requirementStore.create({
        title: '集成测试需求 - 用户登录模块',
        description: '实现用户登录功能，包括邮箱验证和密码加密',
        targetProjectId: 'xuanji-e2e-integration',
        targetRepoPath: '/tmp/xuanji-e2e-integration',
      });
      cleanupIds.requirements.push(requirement.id);
      expect(requirement.id).toBeTruthy();

      // Step 2: 创建任务
      const task = await taskStore.create({
        title: '实现邮箱验证逻辑',
        description: '使用 nodemailer 发送验证邮件',
        targetProjectId: 'xuanji-e2e-integration',
        targetRepoPath: '/tmp/xuanji-e2e-integration',
        sequence: 1,
      });
      cleanupIds.tasks.push(task.id);
      expect(task.id).toBeTruthy();
      expect(task.status).toBe('pending');

      // Step 3: 创建执行实例
      const execution = await executionStore.create({
        subjectType: 'task',
        subjectId: task.id,
        taskId: task.id,
        targetProjectId: 'xuanji-e2e-integration',
        targetRepoPath: '/tmp/xuanji-e2e-integration',
      });
      cleanupIds.executions.push(execution.executionId);
      expect(execution.status).toBe('pending');

      // Step 4: Worker 获取租约
      const lease = await executionStore.acquireLease(execution.executionId, 'worker-integration');
      expect(lease).toBeTruthy();
      expect(lease!.workerId).toBe('worker-integration');

      // Step 5: 更新任务状态为 running
      await taskStore.updateStatus(task.id, 'running');

      // Step 6: 记录对话事件
      const conv1 = await conversationStore.saveEvent({
        executionId: execution.executionId,
        sessionId: 'session-integration',
        turnIndex: 0,
        eventType: 'model_started',
        role: 'assistant',
        payload: { model: 'claude-3-opus', prompt: '实现邮箱验证' },
      });
      cleanupIds.events.push(conv1.id);

      const conv2 = await conversationStore.saveEvent({
        executionId: execution.executionId,
        sessionId: 'session-integration',
        turnIndex: 0,
        eventType: 'tool_started',
        payload: { tool: 'Bash', input: 'npm install nodemailer' },
      });
      cleanupIds.events.push(conv2.id);

      const conv3 = await conversationStore.saveEvent({
        executionId: execution.executionId,
        sessionId: 'session-integration',
        turnIndex: 0,
        eventType: 'final_output',
        payload: { content: '邮箱验证模块已完成' },
      });
      cleanupIds.events.push(conv3.id);

      // Step 7: 心跳续期
      const heartbeat = await executionStore.renewHeartbeat(execution.executionId, lease!);
      expect(heartbeat).toBe(true);

      // Step 8: 标记执行完成
      await executionStore.complete(execution.executionId, '邮箱验证模块实现完成，已通过单元测试');

      // Step 9: 更新任务状态为 completed
      await taskStore.updateStatus(task.id, 'completed');

      // Step 10: 验证最终状态
      const finalExecution = await executionStore.get(execution.executionId);
      expect(finalExecution!.status).toBe('completed');
      expect(finalExecution!.finalOutput).toBe('邮箱验证模块实现完成，已通过单元测试');

      const finalTask = await taskStore.getById(task.id);
      expect(finalTask!.status).toBe('completed');
      expect(finalTask!.completedAt).toBeTruthy();

      // 验证对话事件流完整
      const conversations = await conversationStore.getByExecution(execution.executionId);
      expect(conversations.length).toBe(3);
    });

    // 清理所有测试数据
    afterAll(async () => {
      // 按依赖顺序清理：事件 → 执行 → 任务 → 需求
      for (const id of cleanupIds.events) {
        await db.conversationEvent.delete({ where: { id } }).catch(() => {});
      }
      for (const id of cleanupIds.executions) {
        await db.taskExecution.delete({ where: { executionId: id } }).catch(() => {});
      }
      for (const id of cleanupIds.tasks) {
        await db.task.delete({ where: { id } }).catch(() => {});
      }
      for (const id of cleanupIds.requirements) {
        await db.requirement.delete({ where: { id } }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. 需求分析增强字段验证（V4.1 新字段）
  // --------------------------------------------------------------------------
  describe('需求分析增强字段验证', () => {
    let cleanupReqId: string | null = null;

    afterAll(async () => {
      if (cleanupReqId) {
        // 按依赖顺序清理
        const tasks = await db.task.findMany({
          where: { userStory: { epic: { requirementId: cleanupReqId } } },
        });
        for (const t of tasks) {
          await db.task.delete({ where: { id: t.id } }).catch(() => {});
        }
        const stories = await db.userStory.findMany({
          where: { epic: { requirementId: cleanupReqId } },
        });
        for (const s of stories) {
          await db.userStory.delete({ where: { id: s.id } }).catch(() => {});
        }
        const features = await db.feature.findMany({
          where: { epic: { requirementId: cleanupReqId } },
        });
        for (const f of features) {
          await db.feature.delete({ where: { id: f.id } }).catch(() => {});
        }
        const epics = await db.epic.findMany({ where: { requirementId: cleanupReqId } });
        for (const e of epics) {
          await db.epic.delete({ where: { id: e.id } }).catch(() => {});
        }
        await db.requirement.delete({ where: { id: cleanupReqId } }).catch(() => {});
      }
    });

    it('should write all new enhancement fields through createTaskTreeFromParsed', async () => {
      // 1. 创建测试需求
      const req = await db.requirement.create({
        data: {
          id: `req-e2e-${Date.now()}`,
          title: 'E2E 增强字段测试需求',
          description: '计划管理功能',
          targetProjectId: 'proj-test',
          targetRepoPath: '/tmp/test',
        },
      });
      cleanupReqId = req.id;

      // 2. 模拟 requirement-analyst 输出（epics + features）
      const analystOutput = {
        spec: {
          business_goal: '让项目经理能够管理开发计划',
          scope: { in_scope: ['计划 CRUD'], out_of_scope: [] },
          data_models: [{ entity: 'Plan', fields: [] }],
          api_design: [],
          ui_design: [],
          risks: [],
        },
        epics: [{
          id: 'E1',
          name: '计划管理',
          description: '实现开发计划的完整管理',
          module: 'plan',
          priority: 'P0',
          acceptance_criteria: '支持完整的 CRUD',
          features: [{
            id: 'F1',
            title: '计划列表',
            description: '展示计划列表',
            module: 'plan',
            priority: 'P0',
            acceptance_criteria: '支持分页查询',
          }],
        }],
        user_stories: [],
      };

      await createTaskTreeFromParsed(
        { id: req.id, targetProjectId: req.targetProjectId, targetRepoPath: req.targetRepoPath },
        analystOutput,
      );

      // 手动调用 updateRequirementFromSpec（实际流程中由 onFlowComplete 触发）
      // 参数是 spec 对象，而非整个 analystOutput
      await updateRequirementFromSpec(req.id, analystOutput.spec);

      // 3. 验证 Requirement 新字段
      const requirement = await db.requirement.findUnique({ where: { id: req.id } });
      expect(requirement).toBeTruthy();
      expect(requirement!.businessGoal).toBe('让项目经理能够管理开发计划');
      expect(requirement!.specDoc).toContain('scope');

      // 4. 验证 Epic 新字段
      const epic = await db.epic.findFirst({ where: { requirementId: req.id } });
      expect(epic).toBeTruthy();
      expect(epic!.module).toBe('plan');
      expect(epic!.priority).toBe('P0');
      expect(epic!.acceptanceCriteria).toBe('支持完整的 CRUD');

      // 5. 验证 Feature 新字段
      const feature = await db.feature.findFirst({ where: { epicId: epic!.id } });
      expect(feature).toBeTruthy();
      expect(feature!.module).toBe('plan');
      expect(feature!.priority).toBe('P0');
      expect(feature!.acceptanceCriteria).toBe('支持分页查询');

      // 6. 模拟 task-planner 输出（user_stories + tasks，含 acceptanceSteps）
      const plannerOutput = {
        user_stories: [{
          epic_id: 'E1',
          feature_id: 'F1',
          as_a: '项目经理',
          i_want: '查看计划列表',
          so_that: '了解项目进度',
          title: '作为项目经理，我想要查看计划列表，以便了解项目进度',
          module: 'plan',
          tasks: [{
            title: '实现计划列表 API',
            description: 'GET /api/plans 接口',
            acceptance_criteria: '返回分页计划列表',
            acceptance_steps: [
              'Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条',
            ],
            priority: 'P0',
            task_type: 'API',
            estimated_hours: 4,
          }],
        }],
      };

      await createTaskTreeFromParsed(
        { id: req.id, targetProjectId: req.targetProjectId, targetRepoPath: req.targetRepoPath },
        plannerOutput,
      );

      // 7. 验证 Task 新字段
      const task = await db.task.findFirst({
        where: { userStory: { epic: { requirementId: req.id } } },
      });
      expect(task).toBeTruthy();
      expect(task!.acceptanceSteps).toEqual([
        'Given 存在10条计划; When GET /api/plans?page=1&size=5; Then 返回第1页5条',
      ]);
      expect(task!.priority).toBe('P0');
    });
  });
});
