// core/server/src/graph/conditions/default-conditions.mts —— 预定义条件函数
// V4 修复：
// 1. 增加 test_pass / test_fail 条件（配合 default-dev-flow.yaml）
// 2. 空状态防御：当节点无输出时，*_fail 条件返回 true（视为失败，而非跳过）
import { registerCondition } from './index.mjs'
import type { ConditionFunction } from './index.mjs'
import { sourceText } from './source-text.mjs'

const reading = (state: any, sourceId: string) => sourceText(state, sourceId)

// ─── 辅助函数：解析节点输出 ─────────────────────────────────────────────────────
export function parseNodeOutput(
  state: any,
  sourceId: string,
  sourceTextFn: (state: any, sourceId: string) => string | null = sourceText,
): { ok: boolean } | null {
  const text = sourceTextFn(state, sourceId)
  if (!text) return null

  // 尝试从 ```json 代码块提取
  const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      if (typeof parsed?.ok === 'boolean') return parsed
    } catch { }
  }

  // 回退：尝试直接解析整个输出
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.ok === 'boolean') return parsed
  } catch { }

  // 无法解析 → 返回 null（视为失败）
  return null
}

// ─── 编译类：输出文本形如 { ok: true } ──────────────────────────────────────────
export const compilePass: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'compile_check')
  return result?.ok === true
}
export const compileFail: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'compile_check')
  // 防御性处理：没有输出或 ok=false 都视为失败
  return result === null || result.ok === false
}

// ─── 测试类：test_check 节点的输出 ─────────────────────────────────────────────
export const testPass: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'test_check')
  return result?.ok === true
}
export const testFail: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'test_check')
  // 防御性处理：没有输出或 ok=false 都视为失败
  return result === null || result.ok === false
}

// ─── 代码审查类：code_review 节点的输出 ─────────────────────────────────
export const codeReviewPass: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'code_review')
  return result?.ok === true
}

export const codeReviewIssues: ConditionFunction = (state: any) => {
  const result = parseNodeOutput(state, 'code_review')
  // 防御性处理：没有输出或 ok=false 都视为有问题
  return result === null || result.ok === false
}

// ─── 审查类：reviewer agent 输出形如 { issues: false } 或 { issues: [...] } ───
const nodeIssues = (state: any, nodeId: string) => {
  try {
    const text = reading(state, nodeId)
    if (!text) return false  // 无输出视为无问题（放行）
    const parsed = JSON.parse(text || '{}')
    return parsed?.issues ?? false
  } catch {
    return false
  }
}

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
  // 新增 code_review 条件函数
  registerCondition('code_review_pass', codeReviewPass)
  registerCondition('code_review_issues', codeReviewIssues)
}
