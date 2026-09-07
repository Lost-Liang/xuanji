// core/server/src/graph/conditions/default-conditions.mts —— 预定义条件函数
import { registerCondition } from './index.mjs'
import type { ConditionFunction } from './index.mjs'
import { sourceText } from './source-text.mjs'

const reading = (state: any, sourceId: string) => sourceText(state, sourceId)

// 编译类：输出文本形如 { ok: true }
export const compilePass: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'compile_check'))?.ok) === true }
  catch { return false }
}
export const compileFail: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'compile_check'))?.ok) === false }
  catch { return false }
}

// 审查类
const nodeIssues = (state: any, nodeId: string) =>
  (JSON.parse(reading(state, nodeId) || '{}')?.issues ?? false)

export const qualityPass: ConditionFunction = (state: any) => !nodeIssues(state, 'quality_check')
export const qualityIssues: ConditionFunction = (state: any) => nodeIssues(state, 'quality_check')
export const securityPass: ConditionFunction = (state: any) => !nodeIssues(state, 'security_check')
export const securityIssues: ConditionFunction = (state: any) => nodeIssues(state, 'security_check')

export function initDefaultConditions(): void {
  registerCondition('compile_pass', compilePass)
  registerCondition('compile_fail', compileFail)
  registerCondition('quality_pass', qualityPass)
  registerCondition('quality_issues', qualityIssues)
  registerCondition('security_pass', securityPass)
  registerCondition('security_issues', securityIssues)
}