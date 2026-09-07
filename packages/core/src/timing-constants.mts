// packages/core/src/timing-constants.mts
// 时序常量 —— 璇玑 V4 限流退避与调度参数

/**
 * 429 限流最大重试次数
 *
 * 退避策略：5分钟 → 10分钟 → 30分钟 → 60分钟
 * 超过此次数后标记为失败，不再重试
 */
export const MAX_RATE_LIMIT_RETRIES = 4;

/**
 * 限流退避时间表（毫秒）
 *
 * 索引 0 = 第 1 次重试等待 5 分钟
 * 索引 1 = 第 2 次重试等待 10 分钟
 * 索引 2 = 第 3 次重试等待 30 分钟
 * 索引 3 = 第 4 次重试等待 60 分钟
 */
const RATE_LIMIT_BACKOFF_MS: number[] = [
  5 * 60 * 1000,   // 5 分钟
  10 * 60 * 1000,  // 10 分钟
  30 * 60 * 1000,  // 30 分钟
  60 * 60 * 1000,  // 60 分钟
];

/**
 * 计算限流退避时间（毫秒）
 *
 * @param retryCount 当前重试次数（1-based）
 * @returns 退避等待时间（毫秒），超出最大次数后返回最后一次的值
 */
export function computeRateLimitBackoff(retryCount: number): number {
  const index = Math.min(retryCount - 1, RATE_LIMIT_BACKOFF_MS.length - 1);
  return RATE_LIMIT_BACKOFF_MS[Math.max(0, index)];
}

/**
 * 调度器空闲轮询间隔（毫秒）
 *
 * 当没有待执行任务时，调度器等待此时间后重新检查
 */
export const SCHEDULER_IDLE_WAIT_MS = 5_000;

/**
 * 租约有效期（毫秒）
 *
 * Worker 获取租约后的默认有效期
 */
export const LEASE_DURATION_MS = 5 * 60 * 1000;

/**
 * 僵尸检测超时（分钟）
 *
 * 心跳超过此时间视为僵尸进程
 */
export const ZOMBIE_TIMEOUT_MINUTES = 10;

/**
 * 心跳续期间隔（毫秒）
 *
 * Worker 在执行任务期间，每隔此时间调用一次 renewHeartbeat()
 * 防止长时间任务（> 5 分钟）因租约过期被僵尸检测误判
 */
export const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 分钟
