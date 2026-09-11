// packages/core/src/__tests__/condition-source.test.ts —— 条件边 source 注入校验测试
import { describe, it, expect, beforeEach } from 'vitest'
import { loadWorkflowFromYaml } from '../graph/yaml-loader.mjs'
import { resetRegistry, registerCondition, getCondition } from '../graph/conditions/index.mjs'
import { initDefaultConditions } from '../graph/conditions/default-conditions.mjs'

describe('Condition Source Validation', () => {
  beforeEach(() => {
    resetRegistry()
    initDefaultConditions()
  })

  it('should throw on missing source in function condition', () => {
    const yaml = `
version: '1.0'
id: test-workflow
name: 测试工作流
nodes:
  - id: test
    type: agent
    agent_binding_id: default
  - id: develop
    type: agent
    agent_binding_id: default
edges:
  - from: test
    to: develop
    condition:
      type: function
      config:
        name: test_pass
start:
  - test
`
    expect(() => loadWorkflowFromYaml(yaml)).toThrow('缺少 source 字段')
  })

  it('should throw on invalid source node reference', () => {
    const yaml = `
version: '1.0'
id: test-workflow
name: 测试工作流
nodes:
  - id: test
    type: agent
    agent_binding_id: default
  - id: develop
    type: agent
    agent_binding_id: default
edges:
  - from: test
    to: develop
    condition:
      type: function
      config:
        name: test_pass
        source: nonexistent
start:
  - test
`
    expect(() => loadWorkflowFromYaml(yaml)).toThrow("source 'nonexistent' 不存在于 nodes")
  })

  it('should pass with valid source', () => {
    const yaml = `
version: '1.0'
id: test-workflow
name: 测试工作流
nodes:
  - id: test
    type: agent
    agent_binding_id: default
  - id: develop
    type: agent
    agent_binding_id: default
edges:
  - from: test
    to: develop
    condition:
      type: function
      config:
        name: test_pass
        source: test
start:
  - test
`
    expect(() => loadWorkflowFromYaml(yaml)).not.toThrow()
  })

  it('should not require source for keyword condition', () => {
    const yaml = `
version: '1.0'
id: test-workflow
name: 测试工作流
nodes:
  - id: test
    type: agent
    agent_binding_id: default
  - id: develop
    type: agent
    agent_binding_id: default
edges:
  - from: test
    to: develop
    condition:
      type: keyword
      config:
        any:
          - 'OK'
start:
  - test
`
    expect(() => loadWorkflowFromYaml(yaml)).not.toThrow()
  })
})

describe('Condition Function Signature', () => {
  beforeEach(() => {
    resetRegistry()
    initDefaultConditions()
  })

  it('should call condition function with source text instead of full state', () => {
    // 注册一个测试条件函数，记录调用参数
    let receivedArg: any = null
    const testCondition = (text: string | null) => {
      receivedArg = text
      return true
    }
    registerCondition('test_condition', testCondition)

    // 验证：条件函数应该接收字符串或 null，而不是完整的 state 对象
    const fn = getCondition('test_condition')
    const result = fn('test output')

    expect(result).toBe(true)
    expect(receivedArg).toBe('test output')
    expect(typeof receivedArg).toBe('string')
  })

  it('should handle null source text', () => {
    let receivedArg: any = null
    const testCondition = (text: string | null) => {
      receivedArg = text
      return false
    }
    registerCondition('test_null', testCondition)

    const fn = getCondition('test_null')
    const result = fn(null)

    expect(result).toBe(false)
    expect(receivedArg).toBe(null)
  })
})