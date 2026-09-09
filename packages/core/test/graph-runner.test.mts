// packages/core/test/graph-runner.test.mts
// 验证 createTaskTreeFromParsed 的 Epic/Feature/UserStory/Task 字段映射

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { db } from '../src/db.mjs';
import { createTaskTreeFromParsed, safeJsonParse, updateRequirementFromSpec } from '../src/graph/graph-runner.mjs';
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

  it('should create Epic/Feature from flattened user_stories format (no epics array)', async () => {
    const parsed = {
      // 没有 epics 数组，只有 user_stories
      user_stories: [{
        id: 'US-001',
        epic_id: 'E6',
        feature_id: 'F6',
        epic_name: '图书管理系统',
        feature_name: '图书借阅',
        title: '作为图书管理员，我想借阅图书',
        as_a: '图书管理员',
        i_want: '借阅图书',
        so_that: '管理图书流通',
        module: 'library',
        tasks: [{
          title: '创建 Book 实体类',
          task_type: 'CRUD',
        }],
      }],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, title: '图书管理需求', targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    // 验证 Epic 创建
    const epic = await db.epic.findFirst({
      where: { requirementId, title: '图书管理系统' },
    });
    expect(epic).not.toBeNull();
    expect(epic!.title).toBe('图书管理系统');
    expect(epic!.module).toBe('library');

    // 验证 Feature 创建
    const feature = await db.feature.findFirst({
      where: { epic: { requirementId }, title: '图书借阅' },
    });
    expect(feature).not.toBeNull();
    expect(feature!.title).toBe('图书借阅');

    // 验证 UserStory 创建
    const us = await db.userStory.findFirst({
      where: { title: '作为图书管理员，我想借阅图书' },
    });
    expect(us).not.toBeNull();
    expect(us!.asA).toBe('图书管理员');
    expect(us!.iWant).toBe('借阅图书');

    // 验证 Task 创建
    const task = await db.task.findFirst({
      where: { title: '创建 Book 实体类' },
    });
    expect(task).not.toBeNull();
    expect(task!.taskType).toBe('CRUD');
  });

  it('should fallback to requirement title when epic has no name', async () => {
    const parsed = {
      // 没有 epics 数组，user_stories 也没有 epic_name
      user_stories: [{
        id: 'US-002',
        epic_id: 'E7',
        feature_id: 'F7',
        // 没有 epic_name, feature_name
        title: '测试默认标题',
        tasks: [{
          title: '测试任务2',
        }],
      }],
    };

    await createTaskTreeFromParsed(
      { id: requirementId, title: '默认标题测试需求', targetProjectId: 'proj-test', targetRepoPath: '/tmp/test' },
      parsed,
    );

    // Epic 标题应该回退到需求标题
    const epic = await db.epic.findFirst({
      where: { requirementId, title: '默认标题测试需求' },
    });
    expect(epic).not.toBeNull();

    // Feature 标题也应该回退到 Epic 标题（即需求标题）
    const feature = await db.feature.findFirst({
      where: { epic: { requirementId }, title: '默认标题测试需求' },
    });
    expect(feature).not.toBeNull();
  });
});

// ============================================================================
// safeJsonParse 单元测试
// ============================================================================

describe('safeJsonParse', () => {
  it('should parse valid JSON string', () => {
    const result = safeJsonParse('{"business_goal": "测试目标", "scope": {}}');
    expect(result).toEqual({ business_goal: '测试目标', scope: {} });
  });

  it('should return null for invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
    expect(safeJsonParse('{bad}')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });

  it('should parse JSON array', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// updateRequirementFromSpec 集成测试
// ============================================================================

describeIf('updateRequirementFromSpec', () => {
  let requirementId: string;

  beforeAll(async () => {
    requirementId = `req-spec-${randomUUID().slice(0, 8)}`;
    await db.requirement.create({
      data: {
        id: requirementId,
        title: 'Spec 测试需求',
        description: '测试 specDoc 和 businessGoal',
        targetProjectId: 'proj-test',
        targetRepoPath: '/tmp/test',
      },
    });
  });

  afterAll(async () => {
    await db.requirement.delete({ where: { id: requirementId } });
  });

  it('should write Requirement.specDoc and businessGoal from JSON string', async () => {
    const specString = JSON.stringify({
      business_goal: '测试业务目标',
      scope: { in_scope: ['功能1'], out_of_scope: [] },
      data_models: [{ entity: 'Test', fields: [] }],
      api_design: [],
      ui_design: [],
      risks: [],
    });

    await updateRequirementFromSpec(requirementId, specString);

    const req = await db.requirement.findUnique({ where: { id: requirementId } });

    expect(req).not.toBeNull();
    expect(req!.businessGoal).toBe('测试业务目标');
    expect(req!.specDoc).toContain('scope');
    expect(req!.specDoc).toContain('data_models');
    expect(req!.specDoc).not.toContain('business_goal'); // 已去重
  });

  it('should accept object input directly', async () => {
    const specObj = {
      business_goal: '对象业务目标',
      scope: { in_scope: ['功能2'] },
    };

    await updateRequirementFromSpec(requirementId, specObj);

    const req = await db.requirement.findUnique({ where: { id: requirementId } });
    expect(req!.businessGoal).toBe('对象业务目标');
    expect(req!.specDoc).toContain('功能2');
  });

  it('should skip update when spec is empty string', async () => {
    // 先写入一个已知值
    await updateRequirementFromSpec(requirementId, JSON.stringify({
      business_goal: '保留目标',
      scope: {},
    }));

    // 用空字符串调用，应该不改变已有值
    await updateRequirementFromSpec(requirementId, '');

    const req = await db.requirement.findUnique({ where: { id: requirementId } });
    expect(req!.businessGoal).toBe('保留目标');
  });

  it('should skip update when spec is invalid JSON', async () => {
    await updateRequirementFromSpec(requirementId, JSON.stringify({
      business_goal: '保留目标2',
      scope: {},
    }));

    // 无效 JSON 应该不改变已有值
    await updateRequirementFromSpec(requirementId, 'invalid json{{{');

    const req = await db.requirement.findUnique({ where: { id: requirementId } });
    expect(req!.businessGoal).toBe('保留目标2');
  });

  it('should set businessGoal to null when business_goal field is absent', async () => {
    const specString = JSON.stringify({
      scope: { in_scope: ['无目标功能'] },
      data_models: [],
    });

    await updateRequirementFromSpec(requirementId, specString);

    const req = await db.requirement.findUnique({ where: { id: requirementId } });
    expect(req!.businessGoal).toBeNull();
    expect(req!.specDoc).toContain('scope');
  });
});
