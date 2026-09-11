import { describe, it, expect } from 'vitest'
import { mapAdapterEvent } from '../src/graph/shared-agent-utils.mjs'

describe('mapAdapterEvent', () => {
  it('system/init 事件映射为 model_started', () => {
    const result = mapAdapterEvent({
      type: 'system',
      subtype: 'init',
      sessionId: 'test-session-123',
    })
    expect(result).toEqual({
      eventType: 'model_started',
      payload: { sessionId: 'test-session-123' },
    })
  })

  it('system 非 init 事件返回 null', () => {
    // 模拟 streaming chunk 发送的 system 事件（无 subtype 或 subtype 非 init）
    const result = mapAdapterEvent({
      type: 'system',
      subtype: 'progress',  // 非 init
    } as any)
    expect(result).toBeNull()
  })

  it('assistant 事件映射为 model_delta', () => {
    const result = mapAdapterEvent({
      type: 'assistant',
      message: 'Hello',
      toolUse: [{ id: 'tool-1', name: 'read_file' }],
    })
    expect(result).toEqual({
      eventType: 'model_delta',
      role: 'assistant',
      payload: {
        message: 'Hello',
        toolUse: [{ id: 'tool-1', name: 'read_file' }],
      },
    })
  })

  it('user 事件映射为 tool_completed', () => {
    const result = mapAdapterEvent({
      type: 'user',
      message: 'Tool result',
      toolResult: [{ toolUseId: 'tool-1' }],
    })
    expect(result).toEqual({
      eventType: 'tool_completed',
      role: 'user',
      payload: {
        message: 'Tool result',
        toolResult: [{ toolUseId: 'tool-1' }],
      },
    })
  })

  it('result success 映射为 final_output', () => {
    const result = mapAdapterEvent({
      type: 'result',
      subtype: 'success',
      output: 'Done',
    })
    expect(result).toEqual({
      eventType: 'final_output',
      payload: { output: 'Done' },
    })
  })

  it('result error 映射为 error', () => {
    const result = mapAdapterEvent({
      type: 'result',
      subtype: 'error',
      error: 'Failed',
    })
    expect(result).toEqual({
      eventType: 'error',
      payload: { error: 'Failed' },
    })
  })
})
