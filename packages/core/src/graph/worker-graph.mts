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

import { executionStore } from '../storage/execution-store.mjs';
import { taskStore } from '../storage/task-store.mjs';
import { conversationStore } from '../storage/conversation-store.mjs';
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import type { Prisma } from '@prisma/client';
import { MAX_RATE_LIMIT_RETRIES, computeRateLimitBackoff, HEARTBEAT_INTERVAL_MS } from '../timing-constants.mjs';
import type { SchedulerStateType } from './scheduler-graph.mjs';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** Worker 标识（单实例模式，后续可扩展为多 Worker） */
const WORKER_ID = 'worker-1';

// ─── 事件映射 ──────────────────────────────────────────────────────────────────

/**
 * 将 AdapterEvent 映射为 conversationStore 的 eventType
 *
 * Adapter 事件类型 → 对话事件类型：
 * - system/init     → model_started（模型开始生成）
 * - assistant       → model_delta（模型增量输出）
 * - user            → tool_completed（工具执行完成）
 * - result/success  → final_output（最终输出）
 * - result/error    → error（错误事件）
 */
function mapAdapterEvent(event: AdapterEvent): {
  eventType: string;
  role?: string;
  payload: Prisma.InputJsonValue;
} {
  switch (event.type) {
    case 'system':
      return {
        eventType: 'model_started',
        payload: { sessionId: event.sessionId } as Prisma.InputJsonValue,
      };
    case 'assistant':
      return {
        eventType: 'model_delta',
        role: 'assistant',
        payload: {
          message: event.message,
          toolUse: event.toolUse,
        } as Prisma.InputJsonValue,
      };
    case 'user':
      return {
        eventType: 'tool_completed',
        role: 'user',
        payload: {
          message: event.message,
          toolResult: event.toolResult,
        } as Prisma.InputJsonValue,
      };
    case 'result':
      if (event.subtype === 'error') {
        return {
          eventType: 'error',
          payload: { error: event.error } as Prisma.InputJsonValue,
        };
      }
      return {
        eventType: 'final_output',
        payload: { output: event.output } as Prisma.InputJsonValue,
      };
  }
}

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
 * 8. 根据执行结果更新状态（completed / failed / rate_limited）
 *
 * 429 限流处理：
 * - 检测错误消息中的 429 / rate_limit 关键字
 * - 检查重试次数是否超过 MAX_RATE_LIMIT_RETRIES
 * - 未超限：设置 rate_limited 状态 + retryAt 时间
 * - 已超限：标记为失败
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

  // 心跳续期定时器 —— 防止长时间任务租约过期被僵尸检测误判
  const heartbeatTimer = setInterval(() => {
    executionStore.renewHeartbeat(executionId, lease).then((ok) => {
      if (!ok) {
        console.warn(`[worker] 心跳续期失败，租约可能已失效: ${executionId}`);
      }
    }).catch((err) => {
      console.error(`[worker] 心跳续期异常:`, err);
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // 更新任务状态为 running
    if (taskId) {
      await taskStore.updateStatus(taskId, 'running');
    }

    // 构建 prompt
    const prompt = await buildPrompt(taskId);

    // 调用 Runner 执行 Agent
    const result = await runLocal({
      provider: (execution.provider as 'claude' | 'codex') || 'claude',
      prompt,
      workDir: execution.targetRepoPath,
      model: undefined, // 使用 CLI 默认模型
      // 如果有 sessionId，尝试恢复会话（用于 429 重试后继续）
      resume: execution.sessionId
        ? { providerConversationId: execution.sessionId, input: prompt }
        : undefined,
      onEvent: async (event: AdapterEvent) => {
        // 提取 sessionId（来自 system/init 事件）
        if (event.type === 'system' && event.subtype === 'init') {
          currentSessionId = event.sessionId;
        }

        // 映射并保存对话事件
        const mapped = mapAdapterEvent(event);
        await conversationStore.saveEvent({
          executionId,
          sessionId: currentSessionId ?? undefined,
          eventType: mapped.eventType,
          role: mapped.role,
          payload: mapped.payload,
        });
      },
      onInboxAsk: async (question) => {
        // 保存问题到数据库
        await conversationStore.saveEvent({
          executionId,
          sessionId: currentSessionId ?? undefined,
          eventType: 'inbox_ask',
          payload: {
            questionId: question.id,
            body: question.body,
            choices: question.choices,
          } as Prisma.InputJsonValue,
        });

        // TODO: Task 12 实现 Dashboard 人机交互
        // 目前抛出错误终止执行，等待 Dashboard 交互实现后替换为等待人类回答
        throw new Error('inbox_ask 尚未实现，请在 Dashboard 中回答');
      },
    });

    // 更新 sessionId 到执行实例（用于后续 --resume）
    if (result.sessionInfo?.providerConversationId && currentSessionId !== result.sessionInfo.providerConversationId) {
      // sessionId 已在 onEvent 中捕获，此处无需额外处理
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

      await executionStore.setRateLimited(
        executionId,
        retryAt,
        `429 限流，第 ${currentCount + 1} 次重试，将于 ${retryAtStr} 重试`,
      );

      // 释放租约，让调度器在 retryAt 后重新获取
      await executionStore.releaseLease(executionId, lease);

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
