// packages/core/src/graph/session-control-v2.mts
// Interrupt/Resume 机制 —— 璇玑 V4 人机交互核心
//
// 提供两种暂停/恢复策略：
//
// 1. Promise 阻塞（waitForHumanAnswer / notifyHumanAnswered）
//    用于 handleInboxAsk 回调：阻塞 onInboxAsk 直到人类回答，然后返回答案给 Agent
//    适用场景：Agent 运行中通过 inbox_ask 工具向人类提问
//    流程：Agent → inbox_ask MCP 工具 → onInboxAsk 回调 → waitForHumanAnswer 阻塞
//          → 人类 Dashboard 提交回答 → notifyHumanAnswered 解除阻塞 → Agent 继续
//
// 2. LangGraph interrupt（sessionInterrupt / resumeGraph）
//    用于 interactive 模式的节点级暂停：LangGraph interrupt() 挂起整个图
//    适用场景：节点完成后等待人类确认再继续（未来 interactive 模式，见 agent-node.mts L372 TODO）
//    流程：节点执行完成 → sessionInterrupt() 挂起图 → 人类 Dashboard 确认
//          → resumeGraph(Command(resume=answer)) 恢复图 → 下一个节点执行
//
// 设计说明：
// - Promise 阻塞方式用于 Agent 运行中的实时问答（CLI 进程仍在运行，阻塞回调即可）
// - LangGraph interrupt 方式用于节点间的人工确认（需要持久化挂起状态，支持进程重启）
// - pendingAnswers Map 是进程内的，单实例部署；多实例需替换为 Redis Pub/Sub

import { interrupt } from '@langchain/langgraph';
import type { CompiledStateGraph } from '@langchain/langgraph';
import { db } from '../db.mjs';

// ─── Promise 阻塞策略 ──────────────────────────────────────────────────────────

/**
 * 等待中的人类回答条目
 * key: questionId（inbox_questions 表主键）
 */
interface PendingAnswer {
  /** 人类回答后调用，解除 waitForHumanAnswer 的阻塞 */
  resolve: (answer: string) => void;
  /** 超时或其他错误时调用 */
  reject: (err: Error) => void;
  /** 超时定时器，unref 后不阻止进程退出 */
  timer?: NodeJS.Timeout;
}

/**
 * 轮询结果（数据库轮询方式）
 */
interface PollResult {
  /** 状态：answered = 已回答, pending = 仍在等待, timeout = 超时 */
  status: 'answered' | 'pending' | 'timeout';
  /** 人类的回答内容（仅 status='answered' 时有值） */
  answer?: string;
  /** 是否继续轮询（用于 HTTP 长轮询场景，告知客户端继续） */
  continue?: boolean;
}

/**
 * 全局等待 Map（进程内单例）
 *
 * 键：inbox_questions 表的 question id
 * 值：对应的 Promise resolve/reject 函数 + 超时定时器
 *
 * 局限：仅支持单进程部署。多进程/多实例部署需替换为 Redis Pub/Sub 或 DB 轮询。
 */
const pendingAnswers = new Map<string, PendingAnswer>();

/**
 * 默认超时：24 小时
 *
 * 人审场景可能跨工作日（如 overnight review），24h 是合理的上限。
 * 可通过 waitForHumanAnswer 第二个参数覆盖。
 */
const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * 等待人类回答（Promise 阻塞方式）
 *
 * 在 handleInboxAsk 中调用：
 * 1. 创建一个 Promise，将 resolve/reject 存入 pendingAnswers Map
 * 2. 启动超时定时器（默认 24h）
 * 3. 阻塞直到 notifyHumanAnswered 触发 resolve，或超时 reject
 *
 * 注意：此函数会阻塞调用方（onInboxAsk 回调），进而阻塞 runLocal()。
 * 这意味着 CLI 进程在等待人类回答期间处于空闲状态（不消耗 token），
 * 但进程不会退出。超时后 Promise reject，handleInboxAsk 抛错，runLocal 失败。
 *
 * @param questionId - inbox_questions 表主键（由 db.inboxQuestion.create 返回）
 * @param timeoutMs - 超时毫秒数，默认 DEFAULT_TIMEOUT_MS（24h）
 * @returns 人类的回答内容（string）
 * @throws Error 等待超时
 */
export function waitForHumanAnswer(questionId: string, timeoutMs?: number): Promise<string> {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    // 超时处理：清理 Map 条目并 reject
    const timer = setTimeout(() => {
      pendingAnswers.delete(questionId);
      reject(new Error(`等待人类回答超时（${timeout}ms），questionId=${questionId}`));
    }, timeout);

    // unref 允许定时器不阻止 Node.js 进程正常退出
    // 避免"人类未回答时进程永远不退出"的问题
    if (timer.unref) timer.unref();

    pendingAnswers.set(questionId, { resolve, reject, timer });
  });
}

/**
 * 通知人类已回答，解除 waitForHumanAnswer 的阻塞
 *
 * 由 inbox 路由 POST /api/inbox/:id/answer 调用（inbox.mts）。
 * 调用顺序：
 * 1. 路由更新 inbox_questions 表（answer, status='answered', answeredAt）
 * 2. 调用 notifyHumanAnswered(questionId, answer)
 * 3. 此函数从 pendingAnswers Map 取出 resolve 并调用
 * 4. waitForHumanAnswer 的 Promise 完成，handleInboxAsk 返回答案给 Agent
 *
 * 如果找不到等待中的条目（可能已超时或重复回答），记录 warn 并返回 false，
 * 不影响路由的正常响应（DB 已更新，只是没有等待中的 Promise 需要解除）。
 *
 * @param questionId - inbox_questions 表主键
 * @param answer - 人类的回答内容
 * @returns true = 成功通知，false = 无等待中的 Promise（已超时或 questionId 无效）
 */
export function notifyHumanAnswered(questionId: string, answer: string): boolean {
  const pending = pendingAnswers.get(questionId);

  if (!pending) {
    // 两种情况：1) 超时后 Map 条目已删除；2) 重复回答（DB 幂等更新，但 Promise 已 resolve）
    console.warn(
      `[session-control] notifyHumanAnswered: 无等待中的 questionId=${questionId}` +
      `（可能已超时或已回答，DB 更新不受影响）`
    );
    return false;
  }

  // 清除超时定时器，避免 reject 在 resolve 之后触发
  if (pending.timer) clearTimeout(pending.timer);

  // 从 Map 移除，防止重复 resolve
  pendingAnswers.delete(questionId);

  // 解除 waitForHumanAnswer 的阻塞
  pending.resolve(answer);
  return true;
}

/**
 * 辅助函数：睡眠指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 数据库轮询：等待人类回答（替代进程内 Map）
 *
 * 与 waitForHumanAnswer 的区别：
 * - waitForHumanAnswer：使用进程内 Map + Promise 阻塞，仅支持单进程
 * - pollForAnswer：数据库轮询，支持多进程/多实例部署
 *
 * 使用场景：
 * - HTTP API 长轮询：Dashboard 通过 HTTP 轮询检查问题是否已回答
 * - 多实例部署：多个 Core 实例可共享同一数据库
 *
 * 实现逻辑：
 * 1. 快速路径：先检查内存缓存（避免频繁 DB 查询）
 * 2. 轮询循环：每 1 秒查询一次 DB，直到回答或超时
 * 3. 更新缓存：回答后更新内存缓存，供后续查询使用
 *
 * @param questionId - inbox_questions 表主键
 * @param timeoutMs - 超时毫秒数，默认 30 秒（适合 HTTP 长轮询）
 * @returns PollResult 对象，包含状态和答案（如有）
 */
export async function pollForAnswer(
  questionId: string,
  timeoutMs: number = 30_000
): Promise<PollResult> {
  // 快速路径：先检查内存缓存
  const cached = pendingAnswers.get(questionId);
  if (cached && (cached as any).answer) {
    return { status: 'answered', answer: (cached as any).answer };
  }

  const startTime = Date.now();
  const pollInterval = 1000; // 1秒轮询间隔

  while (Date.now() - startTime < timeoutMs) {
    const question = await db.inboxQuestion.findUnique({
      where: { id: questionId },
      select: { status: true, answer: true },
    });

    if (!question) {
      return { status: 'timeout' };
    }

    if (question.status === 'answered' && question.answer) {
      // 更新内存缓存
      const existing = pendingAnswers.get(questionId);
      if (existing) {
        (existing as any).answer = question.answer;
      }
      return { status: 'answered', answer: question.answer };
    }

    if (question.status === 'timeout') {
      return { status: 'timeout' };
    }

    await sleep(pollInterval);
  }

  return { status: 'pending', continue: true };
}

/**
 * 获取当前等待回答的问题数量
 *
 * 用于调试、监控、Dashboard 健康检查。
 * 正常情况下数量应等于 Dashboard /pending 接口显示的待回答问题数。
 * 如果 pendingAnswers.size > DB pending 数量，说明有"幽灵"Promise（可能因超时竞争）。
 */
export function getPendingAnswerCount(): number {
  return pendingAnswers.size;
}

// ─── LangGraph interrupt 策略（未来 interactive 模式）────────────────────────────

/**
 * sessionInterrupt 的输入参数（传给 LangGraph interrupt，可在 checkpoint 中看到）
 */
interface InterruptPayload {
  /** 当前执行 ID，Dashboard 用于定位问题所属任务 */
  execution_id: string;
  /** inbox_questions 表主键 */
  question_id: string;
  /** 向人类展示的问题内容 */
  body: string;
}

/**
 * sessionInterrupt 的返回值（LangGraph 图恢复时 interrupt() 返回的值）
 */
interface InterruptResult {
  execution_id: string;
  question_id: string;
  body: string;
  /** 人类的答案（由 resumeGraph 传入） */
  answer: string;
}

/**
 * LangGraph 节点级 interrupt：挂起整个工作流等待人类介入
 *
 * 用于 interactive 模式（agent-node.mts L372 TODO 的完整实现）：
 * - 在节点 action 中调用，LangGraph 抛出 GraphInterrupt 挂起整个图
 * - 图的 checkpoint 保存当前状态（包括 interrupt 的输入 payload）
 * - Dashboard 展示挂起原因，人类通过 Dashboard 提交答案
 * - 调用 resumeGraph(graph, config, answer) 恢复图
 * - interrupt() 返回 answer，节点 action 可以继续执行
 *
 * 与 waitForHumanAnswer 的区别：
 * - waitForHumanAnswer：阻塞 CLI 进程内的回调，进程不能退出，无 checkpoint
 * - sessionInterrupt：LangGraph 原生机制，支持进程重启，状态持久化在 PostgreSQL
 *
 * 使用示例（future interactive mode）：
 * ```typescript
 * // 在 interactive 节点的 action 中：
 * const result = sessionInterrupt(executionId, {
 *   id: questionId,
 *   body: '节点已完成，是否继续？',
 * });
 * // 图恢复后，result.answer 包含人类的答案
 * if (result.answer === 'continue') { ... }
 * ```
 *
 * @param executionId - 当前执行 ID
 * @param question - 向人类展示的问题（id + body）
 * @returns 图恢复时返回 InterruptResult，包含人类答案
 */
export function sessionInterrupt(
  executionId: string,
  question: { id: string; body: string },
): InterruptResult {
  // LangGraph interrupt() 同步抛出 GraphInterrupt 挂起图。
  // 泛型参数：<interrupt 输入类型, resume 返回值类型>
  // 当图以 Command(resume=answer) 恢复时，interrupt() 返回 answer（string）。
  const resumeValue = interrupt<InterruptPayload, string>({
    execution_id: executionId,
    question_id: question.id,
    body: question.body,
  });

  return {
    execution_id: executionId,
    question_id: question.id,
    body: question.body,
    answer: resumeValue,
  };
}

/**
 * 恢复被 sessionInterrupt 挂起的 LangGraph 图
 *
 * 通过动态导入 Command 并调用 graph.invoke(new Command({ resume: answer }), config) 恢复。
 * config 必须包含 thread_id，LangGraph 据此找到对应的 checkpoint 并从挂起点继续执行。
 *
 * 前置条件：
 * - graph 必须配置 checkpointer（@langchain/langgraph-checkpoint-postgres）
 * - config.configurable.thread_id 必须与挂起时相同
 *
 * @param graph - LangGraph 编译后的图实例（CompiledStateGraph）
 * @param config - 图运行配置，configurable.thread_id 用于定位 checkpoint
 * @param answer - 人类的答案，传给 interrupt() 作为返回值
 */
export async function resumeGraph(
  graph: CompiledStateGraph<any, any>,
  config: { configurable: { thread_id: string; [key: string]: unknown } },
  answer: string,
): Promise<void> {
  // 动态导入 Command 避免顶层导入问题（Command 是运行时类）
  const { Command } = await import('@langchain/langgraph');
  await graph.invoke(new Command({ resume: answer }), config);
}
