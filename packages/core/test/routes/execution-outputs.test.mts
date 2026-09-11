import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mjs'

describe('GET /api/executions/:id/outputs', () => {
  const testExecutionId = 'test-exec-outputs-endpoint-' + Date.now()
  const testPhaseId = 'test-phase-outputs-endpoint-' + Date.now()

  beforeAll(async () => {
    await db.task_executions.create({
      data: {
        execution_id: testExecutionId,
        subject_type: 'task',
        subject_id: 'test-task',
        target_project_id: 'test',
        target_repo_path: '/tmp/test',
        status: 'completed',
      },
    })
    await db.phase_instances.create({
      data: {
        id: testPhaseId,
        execution_id: testExecutionId,
        phase_id: 'develop',
        attempt: 1,
        status: 'completed',
      },
    })
    await db.phase_outputs.create({
      data: {
        phase_instance_id: testPhaseId,
        key: 'results',
        value: '开发完成',
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
      orderBy: { created_at: 'asc' },
    })

    const list = outputs.map(o => {
      const pi = phases.find(p => p.id === o.phase_instance_id)
      return {
        id: o.id,
        node_id: pi?.phase_id,
        iteration: pi?.attempt,
        key: o.key,
        value: o.value,
        created_at: o.created_at,
      }
    })

    expect(list).toHaveLength(1)
    expect(list[0].node_id).toBe('develop')
    expect(list[0].key).toBe('results')
  })
})