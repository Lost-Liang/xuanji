// packages/core/src/__tests__/dataflow-inputs.test.ts
// Task 5 测试：数据流 inputs 声明

import { buildAgentContext } from '../graph/agent-node.mjs'
import { UpstreamMissingError } from '../graph/errors.mjs'

describe('Dataflow Inputs', () => {
  describe('buildAgentContext', () => {
    it('should include task in prompt when inputs=["task"]', async () => {
      const state = {
        task: { title: '实现登录功能', description: '用户可以通过用户名密码登录' },
      }
      const inputs = ['task']
      const result = buildAgentContext(state, inputs)
      expect(result).toContain('实现登录功能')
      expect(result).toContain('用户可以通过用户名密码登录')
    })

    it('should include spec in prompt when inputs=["spec"]', async () => {
      const state = {
        spec: { title: '需求规格', features: ['登录', '注册'] },
      }
      const inputs = ['spec']
      const result = buildAgentContext(state, inputs)
      expect(result).toContain('需求规格')
    })

    it('should include input in prompt when inputs=["input"]', async () => {
      const state = {
        input: '这是一个测试输入',
      }
      const inputs = ['input']
      const result = buildAgentContext(state, inputs)
      expect(result).toContain('这是一个测试输入')
    })

    it('should include upstream output in prompt when inputs references node id', async () => {
      const state = {
        task: { title: '测试任务' },
        node_outputs: {
          testing: ['{"ok": false, "passed": false, "summary": "测试失败"}'],
        },
      }
      const inputs = ['task', 'testing']
      const result = buildAgentContext(state, inputs)
      expect(result).toContain('测试任务')
      expect(result).toContain('上游阶段产出：testing')
      expect(result).toContain('测试失败')
    })

    it('should throw UpstreamMissingError when upstream node not found', () => {
      const state = {
        task: { title: '测试任务' },
      }
      const inputs = ['nonexistent']
      expect(() => buildAgentContext(state, inputs)).toThrow(UpstreamMissingError)
    })

    it('should combine multiple sources with separators', async () => {
      const state = {
        task: { title: '任务标题' },
        input: '输入内容',
        node_outputs: {
          analyze: ['分析结果'],
        },
      }
      const inputs = ['task', 'input', 'analyze']
      const result = buildAgentContext(state, inputs)
      expect(result).toContain('任务标题')
      expect(result).toContain('输入内容')
      expect(result).toContain('分析结果')
      expect(result).toContain('---') // 分隔符
    })

    it('should handle empty outputs gracefully', async () => {
      const state = {
        node_outputs: {
          empty_node: [],
        },
      }
      const inputs = ['empty_node']
      const result = buildAgentContext(state, inputs)
      expect(result).toContain('上游阶段产出：empty_node')
      // 空输出也应该正常工作，不会崩溃
    })
  })

  describe('WorkflowValidationError in builder', () => {
    // 这部分测试在 builder.test.ts 中验证
    it.skip('should validate inputs references exist in nodes', () => {
      // 在 builder 测试中验证
    })
  })
})