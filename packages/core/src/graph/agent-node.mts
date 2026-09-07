// packages/core/src/graph/agent-node.mts
// 通用 agent 节点 action —— 璇玑 V4 LangGraph 编排层
// 替代 V3 的 agent-node.mts（omnigent + pgClient）
//
// 职责：
// 1. makeAgentNode 工厂函数：根据节点配置创建 LangGraph 节点 action
// 2. 通过 runLocal() 调用 AgentOS Runner 执行 Agent（替代 omnigent 的 createSession + streamSession）
// 3. 通过 conversationStore 实时保存对话事件（替代 V3 的 execution_events SQLite 批量写入）
// 4. 通过 Prisma 操作数据库（替代 V3 的 pgClient 原始 SQL）
// 5. 支持 worktree 隔离（子图节点）、archive 节点、交互模式（interactive/autonomous）
// 6. handleInboxAsk 占位 —— Task 11 实现完整的 interrupt/resume 人机交互
//
// 与 worker-graph.mts 的关系：
// - worker-graph.mts：调度图的工作节点，负责任务队列的租约/心跳/429 重试
// - agent-node.mts：画布图的 agent 节点工厂，负责多步工作流中的 Agent 执行
// - 两者都使用 runLocal() 作为底层执行引擎

import { interrupt } from '@langchain/langgraph';
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import { conversationStore } from '../storage/conversation-store.mjs';
import { ensureTaskWorktree } from './worktree.mjs';
import { db } from '../db.mjs';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { SelectorRule } from './types.mjs';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

// runLocal 超时阈值：单次执行不可超过该时长
// 默认 1 小时（reviewer 跑 code-review/security skill 分析代码 + 输出 checklist 较久）
// env 可覆盖
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS) || 60 * 60 * 1000;

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

// ─── 返回构建 ──────────────────────────────────────────────────────────────────

/**
 * 按 writeKey 分支 return 三种 state channel shape（spec §4.A 末段）
 *
 * - spec=string 覆盖
 * - tasks=array 覆盖
 * - results=array append（reducer concat）
 */
export function buildReturn(
  writeKey: string,
  nodeId: string,
  output: string,
  sessionId: string,
  phaseInstanceId?: string,
) {
  const session_refs = [{ node_id: nodeId, session_id: sessionId }];

  if (writeKey === 'spec') {
    return { spec: output, session_refs };
  }
  if (writeKey === 'tasks') {
    return { tasks: [], session_refs };
  }
  return {
    results: [{ node_id: nodeId, output, phase_instance_id: phaseInstanceId }],
    session_refs,
  };
}

// ─── makeAgentNode 工厂 ────────────────────────────────────────────────────────

/**
 * Agent 节点工厂：根据配置创建 LangGraph 节点 action
 *
 * V3 → V4 改造要点：
 * - createSession + streamSession → runLocal()
 * - pgClient 原始 SQL → Prisma 客户端
 * - omnigent_session_refs → phase_instances 表
 * - execution_events（批量 token 写入）→ conversation_events（onEvent 回调）
 * - elicitation_requests → inbox_questions 表
 * - isKilled / stopSession / getSession → 不再需要（runLocal 是进程级）
 *
 * 节点类型支持：
 * - isSubgraph: 子图节点，建 worktree，有 task 上下文
 * - isArchive: 归档节点，prompt 拼 git push + gh pr create
 * - interactionMode: interactive（支持 interrupt 等待人类）/ autonomous（直接执行）
 */
export function makeAgentNode(opts: {
  bindingIds: string[];                       // 多数 1 个；development 多个 + selector
  selector?: SelectorRule;
  buildPrompt: (state: any) => string;
  writeKey: string;
  nodeId: string;
  isSubgraph?: boolean;                       // 子图节点有 task，建 worktree
  isArchive?: boolean;                        // archive 节点：prompt 拼 git push + gh pr create
  interactionMode?: 'interactive' | 'autonomous';
}) {
  return async (state: any, config: any) => {
    const task = state.task;
    const topExecId = config.configurable?.execution_id as string;
    const execShortid = config.configurable?.exec_shortid as string;

    // 子图节点用子图 execution id 作 ref 键（spec §6 子图有独立 GraphExecution 行）
    // Send fan-out 并行场景需按子图实例区分，避免 ref 撞键
    const execId = opts.isSubgraph && task?.shortid
      ? `exec-task-${execShortid}-${task.shortid}`
      : topExecId;

    // 循环节点第几轮（fix 节点 action 末尾自增）
    const iteration = (state.loop_counters?.[opts.nodeId] || 0);

    // ── 子图 execution 行状态更新 ────────────────────────────────────────────
    // 子图节点执行时推进子图 execution 行的 status + current_node_id
    if (opts.isSubgraph && execId) {
      await updateSubgraphExec(execId, 'running', opts.nodeId);
    }

    // ── reject 重做检测（spec §5）────────────────────────────────────────────
    // 上游 gate reject 后 path 回到此节点，续原 session 发 message 带 comments
    const lastReview = state.review_decisions?.[state.review_decisions.length - 1];
    const isRejectRedo = lastReview?.decision === 'reject' && !!lastReview?.comments;

    // ── 构建 Prompt ──────────────────────────────────────────────────────────
    const taskContent = opts.buildPrompt(state);
    let promptText = taskContent;

    if (isRejectRedo) {
      promptText = `人审驳回意见：${lastReview.comments}\n\n请据此修正：${taskContent}`;
    }

    // archive 节点 prompt 拼 git push + gh pr create（spec §4.2/§4.5）
    if (opts.isArchive) {
      if (process.env.TARGET_REPO_URL) {
        promptText = `${promptText}\n\n完成后执行：git push origin task-${task?.shortid} && gh pr create --base ${process.env.TARGET_BASE_BRANCH} --repo ${process.env.TARGET_REPO_URL} --fill`;
      } else {
        promptText = `${promptText}\n\n完成后执行：git tag archive-${task?.shortid} && echo "已本地归档 task-${task?.shortid}（未配 TARGET_REPO_URL，跳过远端 push/PR）"`;
      }
    }

    // ── 创建/复用 PhaseInstance（替代 V3 的 omnigent_session_refs）──────────
    // V4 使用 phase_instances 表追踪每个节点每次迭代的执行状态
    let phaseInstance: { id: string; sessionId: string | null } | null = null;

    if (execId) {
      // 查找已有的 phase instance（幂等续跑）
      const existing = await db.phaseInstance.findFirst({
        where: {
          executionId: execId,
          phaseId: opts.nodeId,
          attempt: iteration + 1,
        },
      });

      if (existing) {
        phaseInstance = { id: existing.id, sessionId: existing.sessionId };
      } else {
        // 创建新的 phase instance
        const newPhase = await db.phaseInstance.create({
          data: {
            id: randomUUID(),
            executionId: execId,
            phaseId: opts.nodeId,
            taskId: task?.id ?? null,
            attempt: iteration + 1,
            status: 'running',
            startedAt: new Date(),
          },
        });
        phaseInstance = { id: newPhase.id, sessionId: null };
      }
    }

    // ── 确定工作目录 ─────────────────────────────────────────────────────────
    let workDir = process.cwd();
    if (opts.isSubgraph && task) {
      const wtPath = await ensureTaskWorktree(task.shortid, execShortid);
      workDir = wtPath;
    }

    // ── 会话恢复（用于 429 重试后继续）────────────────────────────────────────
    const existingSessionId = phaseInstance?.sessionId;

    // ── 执行 Agent ───────────────────────────────────────────────────────────
    let output = '';
    let currentSessionId: string | null = null;

    // 超时保护
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Agent 执行超时（${RUN_TIMEOUT_MS}ms）`)), RUN_TIMEOUT_MS);
    });

    try {
      const runPromise = runLocal({
        provider: 'claude', // TODO: 从 binding 配置读取 provider
        prompt: promptText,
        workDir,
        model: undefined, // 使用 CLI 默认模型
        // 如果有 sessionId，尝试恢复会话
        resume: existingSessionId
          ? { providerConversationId: existingSessionId, input: promptText }
          : undefined,
        // 事件流回调 —— 实时保存对话事件到 conversation_events 表
        onEvent: async (event: AdapterEvent) => {
          // 提取 sessionId（来自 system/init 事件）
          if (event.type === 'system' && event.subtype === 'init') {
            currentSessionId = event.sessionId;

            // 更新 phase instance 的 sessionId
            if (phaseInstance) {
              await db.phaseInstance.update({
                where: { id: phaseInstance.id },
                data: { sessionId: event.sessionId },
              });
              phaseInstance.sessionId = event.sessionId;
            }
          }

          // 映射并保存对话事件
          const mapped = mapAdapterEvent(event);
          await conversationStore.saveEvent({
            executionId: execId,
            sessionId: currentSessionId ?? undefined,
            eventType: mapped.eventType,
            role: mapped.role,
            payload: mapped.payload,
          });

          // 累积最终输出
          if (event.type === 'result' && event.subtype === 'success' && event.output) {
            output = event.output;
          }
        },
        // 人机交互回调 —— inbox_ask 工具触发
        onInboxAsk: async (question) => {
          return await handleInboxAsk(execId, currentSessionId, question);
        },
      });

      // 超时竞争
      const result = await Promise.race([runPromise, timeoutPromise]);

      // 提取最终输出
      if (result.success && result.finalOutput) {
        output = result.finalOutput;
      }

      // 更新 sessionId
      if (result.sessionInfo?.providerConversationId) {
        currentSessionId = result.sessionInfo.providerConversationId;
        if (phaseInstance && phaseInstance.sessionId !== currentSessionId) {
          await db.phaseInstance.update({
            where: { id: phaseInstance.id },
            data: { sessionId: currentSessionId },
          });
        }
      }

      // 执行失败处理
      if (!result.success) {
        const errorMsg = result.error || 'Agent 执行失败，无输出';

        if (phaseInstance) {
          await db.phaseInstance.update({
            where: { id: phaseInstance.id },
            data: { status: 'failed', errorMessage: errorMsg, completedAt: new Date() },
          });
        }

        if (opts.isSubgraph && execId) {
          await updateSubgraphExec(execId, 'failed', opts.nodeId);
        }

        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      // 超时错误
      if (err instanceof Error && err.message.includes('超时')) {
        if (phaseInstance) {
          await db.phaseInstance.update({
            where: { id: phaseInstance.id },
            data: { status: 'failed', errorMessage: err.message, completedAt: new Date() },
          });
        }
        if (opts.isSubgraph && execId) {
          await updateSubgraphExec(execId, 'failed', opts.nodeId);
        }
        throw err;
      }

      // inbox_ask 中断（LangGraph interrupt）—— 向上透传
      throw err;
    }

    // ── 保存阶段产出物 ───────────────────────────────────────────────────────
    if (phaseInstance) {
      await db.phaseOutput.create({
        data: {
          phaseInstanceId: phaseInstance.id,
          key: opts.writeKey,
          value: output,
        },
      });

      // 标记 phase instance 完成
      await db.phaseInstance.update({
        where: { id: phaseInstance.id },
        data: {
          status: 'completed',
          resultContent: output,
          sessionId: currentSessionId,
          completedAt: new Date(),
        },
      });
    }

    // ── 子图 archive 节点：标记子图 execution 完成 ──────────────────────────
    if (opts.isSubgraph && opts.isArchive && execId) {
      await updateSubgraphExec(execId, 'completed', opts.nodeId);
    }

    // ── interactive 模式：session 完成后 interrupt 等待用户回复 ──────────────
    // TODO: Task 11 实现完整的 interactive 多轮对话
    // 当前简化：autonomous 模式直接返回，interactive 模式也直接返回（不 interrupt）

    // ── 返回 state 更新 ──────────────────────────────────────────────────────
    return buildReturn(
      opts.writeKey,
      opts.nodeId,
      output,
      currentSessionId || '',
      phaseInstance?.id,
    );
  };
}

// ─── handleInboxAsk 占位 ──────────────────────────────────────────────────────

/**
 * 处理 Agent 的 inbox_ask 请求
 *
 * 当前为占位实现：
 * 1. 保存问题到 inbox_questions 表
 * 2. 抛出错误终止执行
 *
 * TODO: Task 11 实现完整的 interrupt/resume 机制：
 * - 保存问题后调用 interrupt() 挂起执行
 * - Dashboard 通过 API 回答问题
 * - LangGraph Command(resume=answer) 恢复执行
 * - 将答案返回给 Agent 继续对话
 */
async function handleInboxAsk(
  executionId: string | undefined,
  sessionId: string | null,
  question: { id: string; body: string; choices?: string[] },
): Promise<string> {
  // 保存问题到数据库
  await db.inboxQuestion.create({
    data: {
      id: randomUUID(),
      executionId: executionId ?? null,
      sessionId: sessionId ?? null,
      body: question.body,
      choices: question.choices ? question.choices : Prisma.JsonNull,
      status: 'pending',
    },
  });

  // TODO: Task 11 实现完整的 interrupt/resume
  // 当前抛出错误终止执行，等待 Dashboard 交互实现后替换为：
  // const answer = interrupt({ type: 'inbox_ask', question_id: question.id, body: question.body });
  // return answer;
  throw new Error('inbox_ask 等待机制待 Task 11 实现');
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * 子图 execution 行状态更新
 *
 * 替代 V3 的 markSubgraphExec（pgClient 原始 SQL）
 * 使用 Prisma 操作 task_executions 表
 *
 * 状态机：
 * - status: running → completed/failed
 * - current_node_id: 记录当前执行的节点
 * - started_at: 首次写入
 * - completed_at: 终态时写入
 */
async function updateSubgraphExec(
  execId: string,
  status: string,
  nodeId?: string,
): Promise<void> {
  try {
    await db.taskExecution.update({
      where: { executionId: execId },
      data: {
        status,
        ...(nodeId ? { stage: nodeId } : {}),
        ...(status === 'running' ? { startedAt: new Date() } : {}),
        ...((status === 'completed' || status === 'failed')
          ? { completedAt: new Date() }
          : {}),
      },
    });
  } catch {
    // 子图 execution 行更新失败不影响主流程
    console.warn(`[agent-node] 更新子图 execution 状态失败: ${execId}`);
  }
}
