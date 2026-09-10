// packages/core/src/concurrency-config.mts
// 并发配置 —— 璇玑 V4 架构层
// 提供全局可访问的并发数配置
//
// 设计目标：
// - 通过环境变量 MAX_CONCURRENT_EXECUTIONS 配置并发数
// - 默认值为 1（串行执行，符合 CLAUDE.md 设计目标）
// - 支持运行时动态调整（未来扩展）

/**
 * 最大并发执行数
 *
 * 从环境变量 MAX_CONCURRENT_EXECUTIONS 读取，默认为 1。
 * 串行执行（并发 1）是默认行为，符合项目设计目标。
 * 设置为 > 1 时，调度器将并行执行多个任务。
 */
export const MAX_CONCURRENT_EXECUTIONS = Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 1;

/**
 * 获取当前并发配置
 */
export function getMaxConcurrent(): number {
  return MAX_CONCURRENT_EXECUTIONS;
}

/**
 * 检查是否已达到并发上限
 * @param currentRunning 当前正在运行的执行数
 */
export function isAtCapacity(currentRunning: number): boolean {
  return currentRunning >= MAX_CONCURRENT_EXECUTIONS;
}
