// core/server/src/graph/conditions/default-conditions.mts —— 预定义条件函数
// V4 修复：增加 test_pass / test_fail 条件（配合 default-dev-flow.yaml）
import { registerCondition } from './index.mjs'
import type { ConditionFunction } from './index.mjs'
import { sourceText } from './source-text.mjs'

const reading = (state: any, sourceId: string) => sourceText(state, sourceId)

// ─── 编译类：输出文本形如 { ok: true } ──────────────────────────────────────────
export const compilePass: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'compile_check'))?.ok) === true }
  catch { return false }
}
export const compileFail: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'compile_check'))?.ok) === false }
  catch { return false }
}

// ─── 测试类：test_check 节点的输出 ─────────────────────────────────────────────
export const testPass: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'test_check'))?.ok) === true }
  catch { return false }
}
export const testFail: ConditionFunction = (state: any) => {
  try { return (JSON.parse(reading(state, 'test_check'))?.ok) === false }
  catch { return false }
}

// ─── 审查类：reviewer agent 输出形如 { issues: false } 或 { issues: [...] } ───
const nodeIssues = (state: any, nodeId: string) =>
  (JSON.parse(reading(state, nodeId) || '{}')?.issues ?? false)

export const qualityPass: ConditionFunction = (state: any) => !nodeIssues(state, 'quality_review')
export const qualityIssues: ConditionFunction = (state: any) => !!nodeIssues(state, 'quality_review')
export const securityPass: ConditionFunction = (state: any) => !nodeIssues(state, 'security_review')
export const securityIssues: ConditionFunction = (state: any) => !!nodeIssues(state, 'security_review')

/**
 * 注册所有默认条件函数
 * 在应用启动或图构建前应调用一次
 */
export function initDefaultConditions(): void {
  registerCondition('compile_pass', compilePass)
  registerCondition('compile_fail', compileFail)
  registerCondition('test_pass', testPass)
  registerCondition('test_fail', testFail)
  registerCondition('quality_pass', qualityPass)
  registerCondition('quality_issues', qualityIssues)
  registerCondition('security_pass', securityPass)
  registerCondition('security_issues', securityIssues)
}
