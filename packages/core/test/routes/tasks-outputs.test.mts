import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'

describe('GET /api/tasks/:id - phase_outputs', () => {
  const testExecutionId = 'test-exec-outputs-' + Date.now()
  const testPhaseId = 'test-phase-' + Date.now()

  beforeAll(async () => {
    // 创建测试 execution
    await db.task_executions.create({
      data: {
        execution_id: testExecutionId,
        subject_type: 'task',
        subject_id: 'test-task',
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
        status: 'completed',
        stage: 'test',
      },
    })
    // 创建测试 phase_instance
    await db.phase_instances.create({
      data: {
        id: testPhaseId,
        execution_id: testExecutionId,
        phase_id: 'write_tests',
        attempt: 1,
        status: 'completed',
        started_at: new Date('2026-09-11T01:00:00Z'),
        completed_at: new Date('2026-09-11T01:10:00Z'),
      },
    })
    // 创建测试 phase_output
    await db.phase_outputs.create({
      data: {
        phase_instance_id: testPhaseId,
        key: 'results',
        value: '## 测试结果\n\n✅ 全部通过',
      },
    })
  })

  afterAll(async () => {
    await db.phase_outputs.deleteMany({
      where: { phase_instance_id: testPhaseId },
    })
    await db.phase_instances.deleteMany({
      where: { id: testPhaseId },
    })
    await db.task_executions.deleteMany({
      where: { execution_id: testExecutionId },
    })
  })

  it('should return phase_outputs for the execution', async () => {
    const phases = await db.phase_instances.findMany({
      where: { execution_id: testExecutionId },
    })
    const outputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
    })

    expect(outputs).toHaveLength(1)
    expect(outputs[0].key).toBe('results')
    expect(outputs[0].value).toContain('## 测试结果')
  })

  it('should join phase_outputs with phase_instances to get node_id', async () => {
    const phases = await db.phase_instances.findMany({
      where: { execution_id: testExecutionId },
    })
    const outputs = await db.phase_outputs.findMany({
      where: {
        phase_instance_id: { in: phases.map(p => p.id) },
      },
    })

    const enriched = outputs.map(o => {
      const pi = phases.find(p => p.id === o.phase_instance_id)
      return {
        node_id: pi?.phase_id,
        iteration: pi?.attempt,
        key: o.key,
        value: o.value,
      }
    })

    expect(enriched[0].node_id).toBe('write_tests')
    expect(enriched[0].iteration).toBe(1)
  })
})