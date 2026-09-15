// packages/core/src/graph/recovery-graph.mts
// 恢复图 —— 璇玑 V4 LangGraph 编排层
// 职责：
// 1. 周期性检测并清理僵尸执行（心跳超过 10 分钟未续期）
// 2. D2: 检查 waiting 执行的 inbox 状态，自动恢复（所有问题已回答）
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
 * - cleanedCount:  本轮成功清理的僵尸数量
 * - detectedAt:    本轮检测时间戳（ISO）
 * - recoveredIds:  本轮恢复的 waiting 执行 ID 列表（D2）
 * - recoveredCount: 本轮成功恢复的 waiting 执行数量（D2）
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
  // D2: waiting 恢复
  recoveredIds: Annotation<string[]>({
    reducer: (_prev: string[], next: string[]) => next,
    default: () => [],
  }),
  recoveredCount: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
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
  return zombies.map(z => z.execution_id);
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
        await db.execution_events.create({
          data: {
            execution_id: executionId,
            event_type: 'zombie_cleaned',
            from_status: 'running',
            to_status: 'pending',
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

/**
 * D2: recover_waiting 节点：检查并恢复 waiting 执行
 *
 * 查找 status='waiting' 的执行，检查其 inbox 问题是否全部已回答。
 * 如果所有问题都已回答，将执行状态重置为 'pending'，让调度器重新拾取。
 *
 * 适用场景：
 * - Agent 执行完成但有待回答问题，设为 waiting
 * - 人类回答完所有问题后，执行应该自动恢复
 */
async function recoverWaitingNode(
  _state: RecoveryStateType,
): Promise<Partial<RecoveryStateType>> {
  // 1. 查找所有 waiting 执行
  const waitingExecs = await db.task_executions.findMany({
    where: { status: 'waiting' },
    select: { execution_id: true },
  });

  if (waitingExecs.length === 0) {
    return { recoveredIds: [], recoveredCount: 0 };
  }

  const recoveredIds: string[] = [];

  // 2. 检查每个 waiting 执行的 inbox 状态
  for (const exec of waitingExecs) {
    try {
      // 查询该执行的 pending 问题数
      const pendingCount = await db.inbox_questions.count({
        where: {
          execution_id: exec.execution_id,
          status: 'pending',
        },
      });

      // 3. 如果所有问题都已回答，恢复执行
      if (pendingCount === 0) {
        // 获取完整执行信息，保留 session_id 用于 resume
        const fullExec = await db.task_executions.findUnique({
          where: { execution_id: exec.execution_id },
          select: { session_id: true },
        });

        // 重置状态为 pending，让调度器重新拾取
        // 注意：session_id 保持不变，用于恢复执行
        await db.task_executions.update({
          where: { execution_id: exec.execution_id },
          data: {
            status: 'pending',
            // 清除旧的租约信息
            worker_id: null,
            lease_token: null,
            lease_expires_at: null,
            // session_id 保持不变，graphRunner 应使用 resume
          },
        });

        // 写入审计事件
        await db.execution_events.create({
          data: {
            execution_id: exec.execution_id,
            event_type: 'waiting_recovered',
            from_status: 'waiting',
            to_status: 'pending',
            message: 'recovery-worker 恢复 waiting 执行：所有 inbox 问题已回答',
          },
        });

        recoveredIds.push(exec.execution_id);
        console.log(`[recovery] 恢复 waiting 执行: ${exec.execution_id} (所有问题已回答)`);
      }
    } catch (err) {
      // 单条恢复失败不中断批处理
      console.error(
        `[recovery] 恢复 waiting 执行失败: ${exec.execution_id}`,
        (err as Error).message,
      );
    }
  }

  return {
    recoveredIds,
    recoveredCount: recoveredIds.length,
  };
}

// ─── 构建恢复图 ─────────────────────────────────────────────────────────────────

/**
 * 构建 Recovery Graph
 *
 * 图结构：
 * ```
 * START → find_zombies → cleanup_zombies → recover_waiting → END
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
 *   if (result.recoveredIds.length > 0) {
 *     console.log(`本轮恢复 ${result.recoveredCount} 个 waiting 执行`);
 *   }
 * }, 60_000); // 每分钟检测一次
 * ```
 */
export function buildRecoveryGraph() {
  const graph = new StateGraph(RecoveryState)

    // 注册节点
    .addNode('find_zombies', findZombiesNode)
    .addNode('cleanup_zombies', cleanupZombiesNode)
    .addNode('recover_waiting', recoverWaitingNode)  // D2: waiting 恢复

    // 入口 → 检测
    .addEdge(START, 'find_zombies')

    // 检测 → 清理
    .addEdge('find_zombies', 'cleanup_zombies')

    // 清理 → waiting 恢复
    .addEdge('cleanup_zombies', 'recover_waiting')

    // waiting 恢复 → 结束
    .addEdge('recover_waiting', END);

  return graph.compile();
}
