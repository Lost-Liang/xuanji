// packages/core/test/graph-runner.test.mts
// 验证 createTaskTreeFromParsed 的 Epic/Feature/UserStory/Task 字段映射

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { db } from '../src/db.mjs';
import { createTaskTreeFromParsed } from '../src/graph/graph-runner.mjs';
import { randomUUID } from 'node:crypto';

// ============================================================================
// PostgreSQL 可用性检测
// ============================================================================

function checkPgAvailable(): boolean {
  try {
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
const describeIf = pgAvailable ? describe : describe.skip;

afterAll(async () => {
  if (pgAvailable) {
    await db.$disconnect();
  }
});

// ============================================================================
// 测试套件
// ============================================================================

describeIf('createTaskTreeFromParsed 字段映射', () => {
  let requirementId: string;

  beforeAll(async () => {
    // 创建测试需求
    requirementId = `req-test-${randomUUID().slice(0, 8)}`;
    await db.requirement.create({
      data: {
        id: requirementId,
        title: '测试需求',
        description: '测试描述',
        targetProjectId: 'proj-test',
        targetRepoPath: '/tmp/test',
      },
    });
  });

  afterAll(async () => {
    // 清理：先删子表，再删主表
    await db.task.deleteMany({ where: { epic: { requirementId } } });
    await db.userStory.deleteMany({ where: { epic: { requirementId } } });
    await db.feature.deleteMany({ where: { epic: { requirementId } } });
    await db.epic.deleteMany({ where: { requirementId } });
    await db.requirement.delete({ where: { id: requirementId } });
  });

  it('should write all Epic fields correctly (from parsed.epics[])', async () => {
    const parsed = {
      epics: [{
        id: 'E1',
        name: '测试 Epic',
        description: 'Epic 描述',
        module: 'test',
        priority: 'P0',
        acceptance_criteria: 'Epic 验收标准',
      }],
      user_stories: [],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    const epic = await db.epic.findFirst({
      where: { requirementId, title: '测试 Epic' },
    });

    expect(epic).not.toBeNull();
    expect(epic!.title).toBe('测试 Epic');
    expect(epic!.description).toBe('Epic 描述');
    expect(epic!.module).toBe('test');
    expect(epic!.priority).toBe('P0');
    expect(epic!.acceptanceCriteria).toBe('Epic 验收标准');
  });

  it('should write all Feature fields correctly (from parsed.epics[].features[])', async () => {
    const parsed = {
      epics: [{
        id: 'E2',
        name: 'Feature Epic',
        features: [{
          id: 'F1',
          title: '测试 Feature',
          description: 'Feature 描述',
          module: 'feature-module',
          priority: 'P1',
          acceptance_criteria: 'Feature 验收标准',
        }],
      }],
      user_stories: [],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    const feature = await db.feature.findFirst({
      where: { epic: { requirementId }, title: '测试 Feature' },
    });

    expect(feature).not.toBeNull();
    expect(feature!.title).toBe('测试 Feature');
    expect(feature!.description).toBe('Feature 描述');
    expect(feature!.module).toBe('feature-module');
    expect(feature!.priority).toBe('P1');
    expect(feature!.acceptanceCriteria).toBe('Feature 验收标准');
  });

  it('should write UserStory module field correctly', async () => {
    const parsed = {
      epics: [{ id: 'E3', name: 'US Epic' }],
      user_stories: [{
        id: 'US1',
        epic_id: 'E3',
        title: '测试用户故事',
        as_a: '用户',
        i_want: '功能',
        so_that: '目的',
        acceptance_text: '验收文本',
        module: 'user-story-module',
        priority: 'P1',
      }],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    const us = await db.userStory.findFirst({
      where: { title: '测试用户故事' },
    });

    expect(us).not.toBeNull();
    expect(us!.title).toBe('测试用户故事');
    expect(us!.asA).toBe('用户');
    expect(us!.iWant).toBe('功能');
    expect(us!.soThat).toBe('目的');
    expect(us!.acceptanceText).toBe('验收文本');
    expect(us!.module).toBe('user-story-module');
    expect(us!.priority).toBe('P1');
  });

  it('should write Task acceptanceSteps and priority fields correctly', async () => {
    const parsed = {
      epics: [{ id: 'E4', name: 'Task Epic' }],
      user_stories: [{
        id: 'US2',
        epic_id: 'E4',
        title: 'Task US',
        tasks: [{
          title: '测试任务',
          description: '任务描述',
          acceptance_criteria: '任务验收',
          acceptance_steps: ['步骤1', '步骤2', '步骤3'],
          priority: 'P0',
          tech_constraints: '技术约束',
          task_type: 'CRUD',
          estimated_hours: 8,
        }],
      }],
      tasks: [],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    const task = await db.task.findFirst({
      where: { title: '测试任务' },
    });

    expect(task).not.toBeNull();
    expect(task!.title).toBe('测试任务');
    expect(task!.description).toBe('任务描述');
    expect(task!.acceptanceCriteria).toBe('任务验收');
    expect(task!.acceptanceSteps).toEqual(['步骤1', '步骤2', '步骤3']);
    expect(task!.priority).toBe('P0');
    expect(task!.techConstraints).toBe('技术约束');
    expect(task!.taskType).toBe('CRUD');
    expect(task!.estimatedHours).toBe(8);
  });

  it('should fallback to Epic ${id} when no name or title is provided', async () => {
    const parsed = {
      epics: [{
        id: 'E5',
        // no name, no title
      }],
      user_stories: [],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    const epic = await db.epic.findFirst({
      where: { requirementId, title: 'Epic E5' },
    });

    expect(epic).not.toBeNull();
    expect(epic!.title).toBe('Epic E5');
  });
});
