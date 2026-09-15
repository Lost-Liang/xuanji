// packages/core/src/graph/worker-graph.mts
// 工作节点 —— 璇玑 V4 LangGraph 编排层
// 替代 V3 的 task-worker.mjs + phase-runner.mjs
//
// 职责：纯执行协调器
// 1. 获取执行实例的租约（lease）—— 并发控制核心
// 2. 委托给 graphRunner 执行实际工作流（心跳、重试、对话事件均由 graphRunner 处理）
// 3. 分支：已有工作流重派发 / 任务执行 / 需求执行 / 兜底 idle

import { executionStore } from '../storage/execution-store.mjs';
import { taskStore } from '../storage/task-store.mjs';
import { db } from '../db.mjs';
import { graphRunner } from './graph-runner.mjs';
import type { SchedulerStateType } from './scheduler-graph.mjs';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** Worker 标识（单实例模式，后续可扩展为多 Worker） */
const WORKER_ID = 'worker-1';

// ─── 工作节点 ──────────────────────────────────────────────────────────────────

/**
 * 工作节点：协调任务/需求执行
 *
 * 职责：获取租约 → 委托给 graphRunner → 返回结果
 * 所有实际执行逻辑（心跳、重试、对话事件）由 graphRunner 内部处理。
 *
 * 分支：
 * 1. execution 已有 graph_definition_id + pending → 重新派发工作流
 * 2. execution 已有 graph_definition_id + 非 pending → 跳过（已在执行中）
 * 3. subject_type === 'task' → 派发 ruoyi-dev-flow
 * 4. subject_type === 'requirement' → 派发 requirement-decomposition
 * 5. 无匹配 → 返回 idle
 */
export async function workerNode(
  state: SchedulerStateType,
): Promise<Partial<SchedulerStateType>> {
  const { executionId, taskId } = state;

  console.log('[worker-graph] 开始执行', { executionId, taskId });

  // 参数校验
  if (!executionId) {
    console.error('[worker-graph] 缺少 executionId，终止执行');
    return { status: 'failed', error: '缺少 executionId' };
  }

  // 获取执行实例信息
  const execution = await executionStore.get(executionId);
  if (!execution) {
    console.error(`[worker-graph] 执行实例不存在: ${executionId}`);
    return { status: 'failed', error: `执行实例不存在: ${executionId}` };
  }

  // ── M2.2: 工作流检测 ─────────────────────────────────────────────────────────
  // 如果执行已有 graph_definition_id，说明之前已派发过工作流
  // 但如果状态仍是 pending，说明上次派发未成功（如进程中断），需要重新派发
  if (execution.graph_definition_id) {
    if (execution.status === 'pending') {
      // 重新派发给 graphRunner
      console.log(`[worker-graph] 执行有工作流 ${execution.graph_definition_id} 但仍 pending，重新派发`);

      // 先获取租约
      const lease = await executionStore.acquireLease(executionId, WORKER_ID);
      if (!lease) {
        return { status: 'idle' };  // 被其他 worker 抢占
      }

      try {
        await graphRunner.startExecution({
          executionId,
          flowId: execution.graph_definition_id,
          input: '',
          task: taskId ? await taskStore.getById(taskId) : undefined,
          lease,  // 传递租约
        });
        return { status: 'completed' };
      } catch (err) {
        const errorMsg = (err as Error).message || '工作流重新派发失败';
        console.error(`[worker-graph] graphRunner 重新派发失败:`, err);
        await executionStore.failWithEvent(executionId, errorMsg);
        return { status: 'failed', error: errorMsg };
      }
    }
    // 非 pending 状态，说明已在执行中，跳过
    console.log(`[worker-graph] 执行已有工作流 ${execution.graph_definition_id}，状态 ${execution.status}，跳过调度`);
    return { status: 'idle' };
  }

  // 任务执行：走 ruoyi-dev-flow-v2 工作流（真正的 TDD + 编译检查 + 安全扫描）
  if (execution.subject_type === 'task' && taskId) {
    console.log(`[worker-graph] 任务执行，委托给 graphRunner (ruoyi-dev-flow-v2)`);

    // 先获取租约
    const lease = await executionStore.acquireLease(executionId, WORKER_ID);
    if (!lease) {
      return { status: 'idle' };  // 被其他 worker 抢占
    }

    try {
      // 传递租约给 graphRunner
      await graphRunner.startExecution({
        executionId,
        flowId: 'ruoyi-dev-flow-v2',
        input: '',
        task: await taskStore.getById(taskId),
        lease,  // 传递租约
      });

      return { status: 'completed' };
    } catch (err) {
      const errorMsg = (err as Error).message || '工作流执行失败';
      console.error(`[worker-graph] graphRunner 执行失败:`, err);
      await executionStore.failWithEvent(executionId, errorMsg);
      return { status: 'failed', error: errorMsg };
    }
  }

  // 需求执行：走 requirement-decomposition 工作流（长期方案：经过调度器，统一并发控制）
  if (execution.subject_type === 'requirement' && execution.requirement_id) {
    console.log(`[worker-graph] 需求执行，委托给 graphRunner (requirement-decomposition)`);

    // 先获取租约
    const lease = await executionStore.acquireLease(executionId, WORKER_ID);
    if (!lease) {
      return { status: 'idle' };  // 被其他 worker 抢占
    }

    try {
      const requirement = await db.requirements.findUnique({
        where: { id: execution.requirement_id },
      });
      if (!requirement) {
        throw new Error(`需求不存在: ${execution.requirement_id}`);
      }

      await graphRunner.startExecution({
        executionId,
        flowId: requirement.workflow_id || 'requirement-decomposition',
        input: requirement.title,
        requirementId: execution.requirement_id,
        lease,  // 传递租约
      });

      return { status: 'completed' };
    } catch (err) {
      const errorMsg = (err as Error).message || '需求执行失败';
      console.error(`[worker-graph] graphRunner 执行失败:`, err);
      await executionStore.failWithEvent(executionId, errorMsg);
      return { status: 'failed', error: errorMsg };
    }
  }

  // 未匹配任何可执行分支
  console.log(`[worker-graph] 无可执行任务: executionId=${executionId}, subject_type=${execution.subject_type}`);
  return { status: 'idle' };
}
