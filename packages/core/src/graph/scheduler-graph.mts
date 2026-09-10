// packages/core/src/graph/scheduler-graph.mts
// 调度图 —— 璇玑 V4 LangGraph 编排层
// 替代 V3 的 task-scheduler.mjs + state-machine.mjs
//
// 职责：
// 1. 查找待执行的 execution（pending 且 retryAt 已过期或为空）
// 2. 找到后分发给 worker 节点执行
// 3. 未找到则 END，由外层循环重新 invoke
// 4. 根据状态路由到对应节点

import {
  Annotation,
  StateGraph,
  END,
  START,
} from '@langchain/langgraph';
import { db } from '../db.mjs';
import { workerNode } from './worker-graph.mjs';

// ─── 状态定义 ──────────────────────────────────────────────────────────────────

/**
 * 调度器状态
 *
 * 在调度图的节点间传递，驱动条件路由决策：
 * - idle:          无待执行任务，进入等待
 * - dispatched:    已找到待执行任务，交给 worker
 * - rate_limited:  遇到 429 限流，需延迟重试
 * - completed:     任务执行完成
 * - failed:        任务执行失败
 */
export const SchedulerState = Annotation.Root({
  /** 当前调度的执行实例 ID */
  executionId: Annotation<string | null>({
    reducer: (_prev: string | null, next: string | null) => next,
    default: () => null,
  }),

  /** 当前调度的任务 ID */
  taskId: Annotation<string | null>({
    reducer: (_prev: string | null, next: string | null) => next,
    default: () => null,
  }),

  /** 调度状态 —— 驱动条件路由 */
  status: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => 'idle',
  }),

  /** 错误信息（失败时限流时记录） */
  error: Annotation<string | undefined>({
    reducer: (_prev: string | undefined, next: string | undefined) => next,
    default: () => undefined,
  }),
});

/** 调度器状态的 TypeScript 类型（用于节点函数签名） */
export type SchedulerStateType = typeof SchedulerState.State;

// ─── 调度节点 ──────────────────────────────────────────────────────────────────

/**
 * 调度节点：查找下一个待执行的任务
 *
 * 查询条件：
 * - status = 'pending'（等待执行）
 * - retryAt 为空（首次执行）或已过期（限流重试到期）
 *
 * 按 createdAt 升序排列，确保先来先服务（FIFO）。
 * 找到则设置 executionId + taskId + dispatched；
 * 未找到则保持 idle，进入等待节点。
 */
async function scheduleNode(
  _state: SchedulerStateType,
): Promise<Partial<SchedulerStateType>> {
  // 查找待执行的 execution：
  // 1. status='pending' 且 retryAt 为空或已过期（首次执行）
  // 2. status='rate_limited' 且 retryAt 已过期（限流重试到期）
  const pending = await db.task_executions.findFirst({
    where: {
      OR: [
        {
          status: 'pending',
          OR: [
            { retry_at: null },
            { retry_at: { lte: new Date() } },
          ],
        },
        {
          status: 'rate_limited',
          retry_at: { lte: new Date() },
        },
      ],
    },
    orderBy: { created_at: 'asc' },
  });

  if (!pending) {
    // 无待执行任务，结束本轮 invoke，由外层循环重新轮询
    return { status: 'idle' };
  }

  // 找到待执行任务，分发给 worker
  return {
    executionId: pending.execution_id,
    taskId: pending.task_id,
    status: 'dispatched',
  };
}

/**
 * 调度节点注释：无待执行任务时 status='idle'，由 routeAfterSchedule 路由到 END。
 * 外层 while(schedulerRunning) 循环负责等待后重新 invoke，避免内部循环触发递归限制。
 */

// ── 条件路由 ──────────────────────────────────────────────────────────────────

/**
 * 条件路由函数：根据调度状态决定下一步
 *
 * - dispatched → worker（执行任务）
 * - idle       → END（无任务，由外层循环重新轮询）
 * - rate_limited → END（限流，由外层循环重新轮询）
 * - 其他终态   → END（结束调度循环）
 */
function routeAfterSchedule(state: SchedulerStateType): string {
  switch (state.status) {
    case 'dispatched':
      return 'worker';
    default:
      // idle / rate_limited / 其他 → 结束本轮 invoke
      return END;
  }
}

// ─── 构建调度图 ─────────────────────────────────────────────────────────────────

/**
 * 构建调度图
 *
 * 图结构：
 * ```
 * START → schedule ──dispatched──→ worker → END
 *              │
 *              │ idle / rate_limited
 *              ▼
 *             END
 * ```
 *
 * 每次 invoke() 最多处理一个任务，然后返回 END。
 * 外层 while(schedulerRunning) 循环（含 5s sleep）负责连续轮询。
 * 这样彻底避免单次 invoke 内部循环触发 LangGraph 递归限制。
 *
 * 并发控制：通过 lease 机制在 worker 节点实现（见 worker-graph.mts）。
 * 调度器本身是单线程循环，每次只分发一个任务。
 */
export function buildSchedulerGraph() {
  const graph = new StateGraph(SchedulerState)

    // 注册节点
    .addNode('schedule', scheduleNode)
    .addNode('worker', workerNode)

    // 入口：从 START 到 schedule
    .addEdge(START, 'schedule')

    // schedule 后的条件路由
    .addConditionalEdges('schedule', routeAfterSchedule, {
      worker: 'worker',
      [END]: END,
    })

    // worker 完成后结束本轮 invoke，外层循环重新拾取
    .addEdge('worker', END);

  return graph.compile();
}
