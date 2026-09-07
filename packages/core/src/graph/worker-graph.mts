// packages/core/src/graph/worker-graph.mts
// 工作节点 —— 璇玑 V4 LangGraph 编排层
// 替代 V3 的 task-worker.mjs + phase-runner.mjs
//
// 职责：
// 1. 获取执行实例的租约（lease）—— 并发控制核心
// 2. 调用 runLocal() 执行 Agent 任务
// 3. 实时保存对话事件到 conversation_events 表
// 4. 处理 429 限流（退避重试策略）
// 5. 更新任务和执行实例的最终状态
// 6. 进程管理：心跳循环中检查 controlStatus，响应暂停/取消请求
// 7. 人机交互：通过共享 handleInboxAsk 处理 inbox_ask 请求

import { executionStore } from '../storage/execution-store.mjs';
import { taskStore } from '../storage/task-store.mjs';
import { conversationStore } from '../storage/conversation-store.mjs';
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import type { Prisma } from '@prisma/client';
import { MAX_RATE_LIMIT_RETRIES, computeRateLimitBackoff, HEARTBEAT_INTERVAL_MS } from '../timing-constants.mjs';
import type { SchedulerStateType } from './scheduler-graph.mjs';
import { mapAdapterEvent, handleInboxAsk } from './shared-agent-utils.mjs';
import { db } from '../db.mjs';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** Worker 标识（单实例模式，后续可扩展为多 Worker） */
const WORKER_ID = 'worker-1';

// ─── Prompt 构建 ───────────────────────────────────────────────────────────────

/**
 * 从任务数据构建 Agent prompt
 *
 * 当前为简化版：拼接任务标题和描述。
 * 后续可根据 acceptanceCriteria、techConstraints、storyContext 构建更丰富的 prompt。
 */
async function buildPrompt(taskId: string | null): Promise<string> {
  if (!taskId) {
    return '请执行当前任务。';
  }

  const task = await taskStore.getById(taskId);
  if (!task) {
    return `请执行任务：${taskId}`;
  }

  const parts: string[] = [];

  // 任务标题
  parts.push(`# 任务：${task.title}`);

  // 任务描述
  if (task.description) {
    parts.push(`\n## 描述\n${task.description}`);
  }

  // 验收标准
  if (task.acceptanceCriteria) {
    parts.push(`\n## 验收标准\n${task.acceptanceCriteria}`);
  }

  // 技术约束
  if (task.techConstraints) {
    const constraints = typeof task.techConstraints === 'string'
      ? task.techConstraints
      : JSON.stringify(task.techConstraints, null, 2);
    parts.push(`\n## 技术约束\n${constraints}`);
  }

  // 故事上下文
  if (task.storyContext) {
    parts.push(`\n## 上下文\n${task.storyContext}`);
  }

  return parts.join('\n');
}

// ─── 工作节点 ──────────────────────────────────────────────────────────────────

/**
 * 工作节点：执行一个任务
 *
 * 执行流程：
 * 1. 参数校验（executionId 必须存在）
 * 2. 获取执行实例信息
 * 3. 尝试获取租约（CAS 原子操作，失败说明被其他 Worker 抢占）
 * 4. 更新任务状态为 running
 * 5. 构建 prompt
 * 6. 调用 runLocal() 执行 Agent
 * 7. 通过 onEvent 回调实时保存对话事件
 * 8. 心跳循环中检查 controlStatus 响应暂停/取消请求
 * 9. 根据执行结果更新状态（completed / failed / rate_limited）
 *
 * 429 限流处理：
 * - 检测错误消息中的 429 / rate_limit 关键字
 * - 检查重试次数是否超过 MAX_RATE_LIMIT_RETRIES
 * - 未超限：设置 rate_limited 状态 + retryAt 时间，使用 releaseLeaseKeepStatus 保留状态
 * - 已超限：标记为失败
 *
 * 进程管理：
 * - 心跳循环中每 HEARTBEAT_INTERVAL_MS 检查 controlStatus
 * - cancel_requested: 终止 CLI 进程，标记执行失败
 * - pause_requested: 目前记录日志（完整暂停需要 CLI 进程信号支持）
 */
export async function workerNode(
  state: SchedulerStateType,
): Promise<Partial<SchedulerStateType>> {
  const { executionId, taskId } = state;

  // 参数校验
  if (!executionId) {
    return { status: 'failed', error: '缺少 executionId' };
  }

  // 获取执行实例信息
  const execution = await executionStore.get(executionId);
  if (!execution) {
    return { status: 'failed', error: `执行实例不存在: ${executionId}` };
  }

  // 尝试获取租约 —— CAS 原子操作
  // 如果返回 null，说明已被其他 Worker 获取或状态已变更
  const lease = await executionStore.acquireLease(executionId, WORKER_ID);
  if (!lease) {
    // 被其他 Worker 抢走，回到调度循环
    return { status: 'idle' };
  }

  // 记录 sessionId（从 system 事件中提取）
  let currentSessionId: string | null = null;

  // AbortController —— 用于进程管理中取消 CLI 执行
  // 心跳循环检测到 cancel_requested 时调用 abort()，runLocal 监听信号终止 CLI 进程
  const abortController = new AbortController();

  // 取消标志 —— 心跳循环检测到 cancel_requested 时设为 true
  let cancelled = false;

  // 心跳续期 + 进程管理定时器
  const heartbeatTimer = setInterval(async () => {
    // 1. 续期心跳
    try {
      const ok = await executionStore.renewHeartbeat(executionId, lease);
      if (!ok) {
        console.warn(`[worker] 心跳续期失败，租约可能已失效: ${executionId}`);
      }
    } catch (err) {
      console.error(`[worker] 心跳续期异常:`, err);
    }

    // 2. 检查 controlStatus（进程管理）
    try {
      const currentExec = await db.taskExecution.findUnique({
        where: { executionId },
        select: { controlStatus: true },
      });

      if (currentExec?.controlStatus === 'cancel_requested') {
        console.log(`[worker] 检测到取消请求，终止执行: ${executionId}`);
        cancelled = true;

        // 通过 AbortSignal 通知 runLocal 终止 CLI 进程
        abortController.abort();
      } else if (currentExec?.controlStatus === 'pause_requested') {
        // 暂停功能：记录日志，后续版本可实现完整的暂停/恢复机制
        // 完整的暂停需要 CLI 进程支持 SIGSTOP 信号或 MCP 协议扩展
        console.log(`[worker] 检测到暂停请求（当前版本仅记录，不暂停）: ${executionId}`);
        // 重置 controlStatus 避免重复日志
        await db.taskExecution.update({
          where: { executionId },
          data: { controlStatus: 'paused' },
        });
      }
    } catch (err) {
      console.error(`[worker] 检查 controlStatus 失败:`, err);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // 更新任务状态为 running
    if (taskId) {
      await taskStore.updateStatus(taskId, 'running');
    }

    // 重置 controlStatus 为 idle（清除之前的暂停/取消请求）
    await db.taskExecution.update({
      where: { executionId },
      data: { controlStatus: 'idle' },
    });

    // 构建 prompt
    const prompt = await buildPrompt(taskId);

    // 调用 Runner 执行 Agent
    const result = await runLocal({
      provider: (execution.provider as 'claude' | 'codex') || 'claude',
      prompt,
      workDir: execution.targetRepoPath,
      model: undefined, // 使用 CLI 默认模型
      // AbortSignal 用于进程管理取消 —— 心跳循环检测到 cancel_requested 时触发
      abortSignal: abortController.signal,
      // 如果有 sessionId，尝试恢复会话（用于 429 重试后继续）
      resume: execution.sessionId
        ? { providerConversationId: execution.sessionId, input: prompt }
        : undefined,
      onEvent: async (event: AdapterEvent) => {
        // 提取 sessionId（来自 system/init 事件）
        if (event.type === 'system' && event.subtype === 'init') {
          currentSessionId = event.sessionId;
        }

        // 映射并保存对话事件（使用共享函数）
        const mapped = mapAdapterEvent(event);
        await conversationStore.saveEvent({
          executionId,
          sessionId: currentSessionId ?? undefined,
          eventType: mapped.eventType,
          role: mapped.role,
          payload: mapped.payload,
        });
      },
      // 人机交互回调 —— 使用共享的 handleInboxAsk 实现
      // 完整流程：写入 inbox_questions 表 → waitForHumanAnswer → 人类回答 → 返回
      onInboxAsk: async (question) => {
        return await handleInboxAsk(executionId, currentSessionId, question);
      },
    });

    // P0-4 修复：持久化 sessionId 到执行实例（用于后续 --resume 恢复会话）
    if (currentSessionId && currentSessionId !== execution.sessionId) {
      await db.taskExecution.update({
        where: { executionId },
        data: { sessionId: currentSessionId },
      });
    }

    // 检查是否被取消
    if (cancelled) {
      await executionStore.fail(executionId, '执行已被用户取消');
      if (taskId) {
        await taskStore.updateStatus(taskId, 'failed');
      }
      return { status: 'failed', error: '执行已被用户取消' };
    }

    // 根据执行结果更新状态
    if (result.success && result.finalOutput) {
      await executionStore.complete(executionId, result.finalOutput);
      if (taskId) {
        await taskStore.updateStatus(taskId, 'completed');
      }
      return { status: 'completed' };
    }

    if (result.success && !result.finalOutput) {
      // 成功但无输出，记录为完成（可能 Agent 执行了操作但无文本输出）
      await executionStore.complete(executionId, '任务已完成（无文本输出）');
      if (taskId) {
        await taskStore.updateStatus(taskId, 'completed');
      }
      return { status: 'completed' };
    }

    // 执行失败
    const errorMsg = result.error || 'Agent 执行失败，无输出';
    await executionStore.fail(executionId, errorMsg);
    if (taskId) {
      await taskStore.updateStatus(taskId, 'failed');
    }
    return { status: 'failed', error: errorMsg };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 检查是否为 429 限流错误
    if (isRateLimitError(errorMessage)) {
      const currentCount = execution.rateLimitCount;

      // 检查是否超过最大重试次数
      if (currentCount >= MAX_RATE_LIMIT_RETRIES) {
        await executionStore.fail(
          executionId,
          `限流重试次数已达上限 (${MAX_RATE_LIMIT_RETRIES})，放弃执行`,
        );
        if (taskId) {
          await taskStore.updateStatus(taskId, 'failed');
        }
        return { status: 'failed', error: '限流超限' };
      }

      // 计算退避时间并设置限流状态
      const backoffMs = computeRateLimitBackoff(currentCount + 1);
      const retryAt = new Date(Date.now() + backoffMs);
      const retryAtStr = retryAt.toLocaleString('zh-CN');

      // 先设置限流状态（status='rate_limited' + retryAt）
      await executionStore.setRateLimited(
        executionId,
        retryAt,
        `429 限流，第 ${currentCount + 1} 次重试，将于 ${retryAtStr} 重试`,
      );

      // P0-1 修复：使用 releaseLeaseKeepStatus 释放租约但不覆盖 rate_limited 状态
      // 旧代码使用 releaseLease 会将 status 重置为 'pending'，导致限流退避策略失效
      await executionStore.releaseLeaseKeepStatus(executionId, lease);

      return {
        status: 'rate_limited',
        error: `429 限流，将于 ${retryAtStr} 重试`,
      };
    }

    // 非限流错误，直接标记失败
    await executionStore.fail(executionId, errorMessage);
    if (taskId) {
      await taskStore.updateStatus(taskId, 'failed');
    }
    return { status: 'failed', error: errorMessage };
  } finally {
    // 无论成功、失败还是异常，都清除心跳续期定时器
    clearInterval(heartbeatTimer);
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * 判断错误消息是否为 429 限流错误
 *
 * 检测关键字：
 * - "429": HTTP 状态码
 * - "rate_limit" / "rate limit": 限流标识
 * - "throttl": 节流标识
 * - "too many requests": 请求过多
 */
function isRateLimitError(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('429') ||
    lowerMsg.includes('rate_limit') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('throttl') ||
    lowerMsg.includes('too many requests')
  );
}
