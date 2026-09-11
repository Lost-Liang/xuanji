// packages/core/src/graph/errors.mts
// 图相关错误类型定义

/**
 * 上游节点输出缺失错误
 *
 * 当节点的 inputs 引用了不存在的上游节点时抛出
 */
export class UpstreamMissingError extends Error {
  constructor(public readonly sourceId: string) {
    super(`上游节点 '${sourceId}' 的输出不存在`)
    this.name = 'UpstreamMissingError'
  }
}

/**
 * 工作流校验错误
 *
 * 当工作流定义不符合规范时抛出
 */
export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowValidationError'
  }
}