import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../../src/db.mts'
import { buildGraphFromDef } from '../../src/graph/builder.mts'
import { loadWorkflowFromFile } from '../../src/graph/yaml-loader.mts'

describe('Workflow V2 Integration Tests', () => {
  let workflowDef: any
  let graph: any

  beforeAll(async () => {
    // 加载工作流
    workflowDef = await loadWorkflowFromFile('workflows/ruoyi-dev-flow-v2.yaml')
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('should load workflow with 10 nodes', () => {
    expect(workflowDef.nodes).toHaveLength(10)
  })

  it('should load workflow with 16 edges', () => {
    expect(workflowDef.edges).toHaveLength(16)
  })

  it('should have run_initial_tests node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'run_initial_tests')
    expect(node).toBeDefined()
    expect(node.type).toBe('agent')
  })

  it('should have compile_check node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'compile_check')
    expect(node).toBeDefined()
    expect(node.agent_binding_ids).toContain('compiler')
  })

  it('should have security_scan node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'security_scan')
    expect(node).toBeDefined()
    expect(node.agent_binding_ids).toContain('security-scanner')
  })

  it('should have regression_test node', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'regression_test')
    expect(node).toBeDefined()
  })

  it('should have final_review gate', () => {
    const node = workflowDef.nodes.find((n: any) => n.id === 'final_review')
    expect(node).toBeDefined()
    expect(node.type).toBe('gate')
  })
})