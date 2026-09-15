// core/server/src/graph/conditions/default-conditions.mts —— 预定义条件函数
// Task 3 修复：
// 1. 条件函数签名改为 (sourceText: string | null) => boolean
// 2. 条件函数不再硬编码节点 ID，节点引用由 YAML 的 source 字段注入
// 3. 空状态防御：当节点无输出时，*_fail 条件返回 true（视为失败，而非跳过）
import { registerCondition } from './index.mjs'
import type { ConditionFunction } from './index.mjs'

// ─── 辅助函数：解析节点输出文本 ─────────────────────────────────────────────────────
/**
 * 解析节点输出文本为 JSON 对象
 *
 * Task 3: 此函数不再依赖 state 和 sourceId，只解析文本
 * 支持两种格式：
 * 1. ```json 代码块包裹的 JSON
 * 2. 直接的 JSON 字符串
 *
 * @param text 节点输出文本
 * @returns 解析结果，如果无法解析返回 null
 */
export function parseOutput(text: string | null): { ok: boolean } | null {
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

/**
 * 解析问题报告格式 { issues: boolean | any[] }
 * @param text 节点输出文本
 * @returns 是否有问题
 */
function parseIssues(text: string | null): boolean {
  if (!text) return false // 无输出视为无问题（放行）
  try {
    const parsed = JSON.parse(text || '{}')
    return parsed?.issues ?? false
  } catch {
    return false
  }
}

// ─── 编译类：输出文本形如 { ok: true } ──────────────────────────────────────────
export const compilePass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}
export const compileFail: ConditionFunction = (text) => {
  const result = parseOutput(text)
  // 防御性处理：没有输出或 ok=false 都视为失败
  return result === null || result.ok === false
}

// ─── 测试类：输出文本形如 { ok: true } ─────────────────────────────────────────────
export const testPass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}
export const testFail: ConditionFunction = (text) => {
  const result = parseOutput(text)
  // 防御性处理：没有输出或 ok=false 都视为失败
  return result === null || result.ok === false
}

// ─── 代码审查类：输出文本形如 { ok: true } ─────────────────────────────────
export const codeReviewPass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const codeReviewIssues: ConditionFunction = (text) => {
  const result = parseOutput(text)
  // 防御性处理：没有输出或 ok=false 都视为有问题
  return result === null || result.ok === false
}

// ─── 审查类：输出文本形如 { issues: false } 或 { issues: [...] } ───
export const qualityPass: ConditionFunction = (text) => !parseIssues(text)
export const qualityIssues: ConditionFunction = (text) => !!parseIssues(text)

// ─── 安全类：输出文本形如 { ok: true } ─────────────────────────────────────────────
export const securityPass: ConditionFunction = (text) => {
  const result = parseOutput(text)
  return result?.ok === true
}

export const securityIssues: ConditionFunction = (text) => {
  const result = parseOutput(text)
  // 防御性处理：没有输出或 ok=false 都视为有问题
  return result === null || result.ok === false
}

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
