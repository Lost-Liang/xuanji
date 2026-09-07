// core/server/src/graph/conditions/index.mts —— 条件函数注册表
// TODO: Task 7 迁移 — TopState/SubState 是 Annotation.Root() 值，不能直接作类型；
// 条件函数统一使用 any（与 default-conditions.mts 中 (state: any) 保持一致）
// import type { TopState, SubState } from '../state-schema.mjs'

export type ConditionFunction = (state: any) => boolean

// 条件函数注册表
export const conditionRegistry: Map<string, ConditionFunction> = new Map()

/**
 * 注册条件函数
 */
export function registerCondition(name: string, fn: ConditionFunction): void {
  conditionRegistry.set(name, fn)
}

/**
 * 获取条件函数
 */
export function getCondition(name: string): ConditionFunction {
  const fn = conditionRegistry.get(name)
  if (!fn) {
    throw new Error(`Unknown condition function: ${name}`)
  }
  return fn
}

/**
 * 重置注册表（测试用）
 */
export function resetRegistry(): void {
  conditionRegistry.clear()
}

/**
 * 检查条件函数是否存在
 */
export function hasCondition(name: string): boolean {
  return conditionRegistry.has(name)
}

/**
 * 列出所有已注册的条件函数
 */
export function listConditions(): string[] {
  return Array.from(conditionRegistry.keys())
}