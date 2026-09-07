// packages/core/src/graph/recovery-graph.mts
// 恢复图 —— 璇玑 V4 LangGraph 编排层
// 职责：周期性检测并清理僵尸执行（心跳超过 10 分钟未续期）
//
// 僵尸产生场景：
// - Worker 进程被 SIGKILL 或 OOM，未触发 releaseLease
// - 网络分区导致心跳上报丢失
// - CLI 子进程异常退出，宿主 Worker 未感知
//
// 清理动作：
// - 强制释放租约（workerId/leaseToken/leaseExpiresAt 全部清空）
// - 重置 status='pending'，让 scheduler-graph 重新拾取
// - 记录恢复事件到 execution_events（审计留痕）

import {
  Annotation,
  StateGraph,
  END,
  START,
} from '@langchain/langgraph';
import { executionStore } from '../storage/execution-store.mjs';
import { ZOMBIE_TIMEOUT_MINUTES } from '../timing-constants.mjs';
import { db } from '../db.mjs';

// ─── 状态定义 ──────────────────────────────────────────────────────────────────

/**
 * Recovery Graph 状态
 *
 * - zombieIds:     本轮检测到的僵尸执行 ID 列表
 * - cleanedCount:  本轮成功清理的数量
 * - detectedAt:    本轮检测时间戳（ISO）
 */
export const RecoveryState = Annotation.Root({
  zombieIds: Annotation<string[]>({
    reducer: (_prev: string[], next: string[]) => next,
    default: () => [],
  }),
  cleanedCount: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),
  detectedAt: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => new Date().toISOString(),
  }),
});

export type RecoveryStateType = typeof RecoveryState.State;

// ─── 僵尸检测 ──────────────────────────────────────────────────────────────────

/**
 * 查找僵尸执行
 *
 * 委托给 executionStore.findZombies()，使用 ZOMBIE_TIMEOUT_MINUTES 作为阈值。
 * 返回 status='running' 且 heartbeatAt 早于阈值的执行实例 ID 列表。
 */
export async function findZombies(): Promise<string[]> {
  const zombies = await executionStore.findZombies(ZOMBIE_TIMEOUT_MINUTES);
  return zombies.map(z => z.executionId);
}

// ─── 节点实现 ──────────────────────────────────────────────────────────────────

/**
 * find_zombies 节点：检测僵尸
 *
 * 将检测结果写入 state.zombieIds，并记录检测时间戳。
 * 无僵尸时返回空数组，cleanup_zombies 节点会跳过处理。
 */
async function findZombiesNode(
  _state: RecoveryStateType,
): Promise<Partial<RecoveryStateType>> {
  const zombieIds = await findZombies();
  return {
    zombieIds,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * cleanup_zombies 节点：清理僵尸
 *
 * 对每个僵尸执行：
 * 1. 调用 executionStore.forceReleaseZombie 强制释放租约（无需 leaseToken）
 * 2. 写入 execution_events 审计事件（eventType='zombie_cleaned'）
 * 3. 统计成功清理的数量
 *
 * 失败不阻塞其他僵尸的清理（单条失败仅记录日志，不抛异常）
 */
async function cleanupZombiesNode(
  state: RecoveryStateType,
): Promise<Partial<RecoveryStateType>> {
  let cleanedCount = 0;

  for (const executionId of state.zombieIds) {
    try {
      const released = await executionStore.forceReleaseZombie(executionId);

      if (released) {
        // 写入审计事件，供 Dashboard 和后续排障使用
        // ExecutionEvent 使用自增 int id + fromStatus/toStatus/message 字段
        await db.executionEvent.create({
          data: {
            executionId,
            eventType: 'zombie_cleaned',
            fromStatus: 'running',
            toStatus: 'pending',
            message: `recovery-worker 清理僵尸执行：心跳超时 ${ZOMBIE_TIMEOUT_MINUTES} 分钟，租约强制释放`,
          },
        });
        cleanedCount++;
        console.warn(
          `[recovery] 清理僵尸执行: ${executionId} (心跳超时 ${ZOMBIE_TIMEOUT_MINUTES} 分钟)`,
        );
      }
    } catch (err) {
      // 单条清理失败不中断批处理，记录后继续
      console.error(
        `[recovery] 清理僵尸失败: ${executionId}`,
        (err as Error).message,
      );
    }
  }

  return { cleanedCount };
}

// ─── 构建恢复图 ─────────────────────────────────────────────────────────────────

/**
 * 构建 Recovery Graph
 *
 * 图结构：
 * ```
 * START → find_zombies → cleanup_zombies → END
 * ```
 *
 * 调度方式：
 * 由外层定时器（如 set interval）周期性调用 graph.invoke()。
 * 每轮独立执行，状态不跨轮持久化（无 checkpoint 需求）。
 *
 * 使用示例：
 * ```ts
 * const graph = buildRecoveryGraph();
 * setInterval(async () => {
 *   const result = await graph.invoke({});
 *   if (result.zombieIds.length > 0) {
 *     console.log(`本轮清理 ${result.cleanedCount} 个僵尸`);
 *   }
 * }, 60_000); // 每分钟检测一次
 * ```
 */
export function buildRecoveryGraph() {
  const graph = new StateGraph(RecoveryState)

    // 注册节点
    .addNode('find_zombies', findZombiesNode)
    .addNode('cleanup_zombies', cleanupZombiesNode)

    // 入口 → 检测
    .addEdge(START, 'find_zombies')

    // 检测 → 清理
    .addEdge('find_zombies', 'cleanup_zombies')

    // 清理 → 结束
    .addEdge('cleanup_zombies', END);

  return graph.compile();
}
