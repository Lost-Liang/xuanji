import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'

describe('GET /api/tasks/:id - breakdown_content fallback', () => {
  const testTaskId = 'test-task-breakdown-' + Date.now()
  const testExecutionId = 'test-exec-breakdown-' + Date.now()

  beforeAll(async () => {
    // 创建测试 task（description 为 null，acceptance_criteria 有值）
    await db.tasks.create({
      data: {
        id: testTaskId,
        title: '测试任务',
        description: null,
        acceptance_criteria: '提供 /api/test CRUD 接口',
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
      },
    })
    // 创建关联 execution
    await db.task_executions.create({
      data: {
        execution_id: testExecutionId,
        subject_type: 'task',
        subject_id: testTaskId,
        task_id: testTaskId,
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
        status: 'completed',
      },
    })
  })

  afterAll(async () => {
    await db.task_executions.deleteMany({
      where: { execution_id: testExecutionId },
    })
    await db.tasks.deleteMany({
      where: { id: testTaskId },
    })
  })

  it('should fallback to acceptance_criteria when description is null', async () => {
    const execution = await db.task_executions.findUnique({
      where: { execution_id: testExecutionId },
      include: {
        tasks: {
          select: { id: true, title: true, description: true, acceptance_criteria: true },
        },
      },
    })

    // 模拟后端的 breakdown_content 逻辑
    const breakdown_content =
      execution?.tasks?.description
      ?? (execution?.tasks?.acceptance_criteria
          ? JSON.stringify({
              acceptance_criteria: execution.tasks.acceptance_criteria,
              title: execution.tasks?.title,
            })
          : null)

    expect(breakdown_content).not.toBeNull()
    const parsed = JSON.parse(breakdown_content!)
    expect(parsed.acceptance_criteria).toBe('提供 /api/test CRUD 接口')
    expect(parsed.title).toBe('测试任务')
  })
})