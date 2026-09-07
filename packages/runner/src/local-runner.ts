/**
 * 璇玑 Runner - 本地模式
 *
 * 直接 spawn CLI 进程（Claude Code / Codex），解析 stream-json 输出，
 * 通过回调函数传递事件和人机交互问题。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** CLI 适配器事件流 */
export type AdapterEvent =
  | { type: 'system'; subtype: 'init'; sessionId: string }
  | { type: 'assistant'; message: string; toolUse?: Array<{ id: string; name: string }> }
  | { type: 'user'; message: string; toolResult?: Array<{ toolUseId: string }> }
  | { type: 'result'; subtype: 'success' | 'error'; output?: string; error?: string };

/** 人机交互问题（来自 inbox_ask 工具） */
export interface InboxQuestion {
  id: string;
  body: string;
  choices?: string[];
}

/** 本地运行参数 */
export interface LocalRunOptions {
  /** CLI 提供者 */
  provider: 'claude' | 'codex';
  /** 发送给 Agent 的提示词 */
  prompt: string;
  /** 工作目录（CLI 进程的 cwd） */
  workDir: string;
  /** 模型名称（可选，不提供则使用 CLI 默认） */
  model?: string;
  /** 恢复已有会话（用于 429 重试） */
  resume?: { providerConversationId: string; input: string };
  /** 事件流回调，每个 JSON 行解析后调用 */
  onEvent?: (event: AdapterEvent) => void | Promise<void>;
  /** 人机交互回调，Agent 调用 inbox_ask 时触发，等待人类回答 */
  onInboxAsk?: (question: InboxQuestion) => Promise<string>;
  /** 中止信号 —— 用于外部取消执行（如进程管理中的取消请求） */
  abortSignal?: AbortSignal;
}

/** 本地运行结果 */
export interface LocalRunResult {
  /** 是否成功完成 */
  success: boolean;
  /** Agent 的最终输出 */
  finalOutput?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 会话信息（用于恢复） */
  sessionInfo?: { providerConversationId: string };
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 本地模式运行 Agent
 *
 * 直接 spawn CLI 进程，解析 stream-json 输出。
 * 不使用 API Server，适合作为璇玑内部的嵌入模块。
 */
export async function runLocal(options: LocalRunOptions): Promise<LocalRunResult> {
  const { provider } = options;

  if (provider === 'claude') {
    return runClaude(options);
  } else if (provider === 'codex') {
    return runCodex(options);
  } else {
    return {
      success: false,
      error: `不支持的提供者: ${provider}`,
    };
  }
}

// ─── Claude Code CLI 适配器 ────────────────────────────────────────────────────

/**
 * 构建 Claude CLI 参数
 *
 * 关键参数说明：
 * - `-p`: 非交互模式（pipe 模式）
 * - `--output-format stream-json`: 输出 NDJSON 格式事件流
 * - `--verbose`: 包含完整信息
 * - `--dangerously-skip-permissions`: 跳过权限检查（本地开发环境）
 * - `--setting-sources project,local`: 仅使用项目和本地配置
 */
function buildClaudeArgs(options: LocalRunOptions): string[] {
  const { model, resume } = options;

  const args: string[] = [
    '-p',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ];

  // 模型参数
  if (model) {
    args.push('--model', model);
  }

  // 恢复会话参数
  if (resume) {
    args.push('--resume', resume.providerConversationId);
  }

  return args;
}

/**
 * 解析 Claude stream-json 事件
 *
 * 事件类型：
 * - system: 初始化事件，包含 session_id
 * - assistant: Agent 输出，包含 message.content
 * - user: 工具执行结果
 * - result: 终止事件，包含最终输出
 */
function parseClaudeEvent(
  event: Record<string, unknown>,
  onEvent?: (event: AdapterEvent) => void | Promise<void>,
): { sessionId?: string; finalOutput?: string; isError?: boolean } {
  const type = event.type as string;
  const result: { sessionId?: string; finalOutput?: string; isError?: boolean } = {};

  if (type === 'system') {
    // 初始化事件，提取 session_id
    const sessionId = event.session_id as string;
    result.sessionId = sessionId;
    onEvent?.({ type: 'system', subtype: 'init', sessionId });
  } else if (type === 'assistant') {
    // Agent 输出事件
    const message = event.message as Record<string, unknown> | undefined;
    const content = (message?.content as Array<Record<string, unknown>>) ?? [];

    // 提取文本内容
    const textParts: string[] = [];
    const toolUse: Array<{ id: string; name: string }> = [];

    for (const item of content) {
      if (item.type === 'text') {
        textParts.push(item.text as string);
      } else if (item.type === 'tool_use') {
        toolUse.push({
          id: item.id as string,
          name: item.name as string,
        });
      }
    }

    const messageText = textParts.join('\n');
    onEvent?.({
      type: 'assistant',
      message: messageText,
      toolUse: toolUse.length > 0 ? toolUse : undefined,
    });
  } else if (type === 'user') {
    // 工具执行结果事件
    const message = event.message as Record<string, unknown> | undefined;
    const content = (message?.content as Array<Record<string, unknown>>) ?? [];

    const toolResult: Array<{ toolUseId: string }> = [];
    const textParts: string[] = [];

    for (const item of content) {
      if (item.type === 'tool_result') {
        toolResult.push({ toolUseId: item.tool_use_id as string });
      } else if (item.type === 'text') {
        textParts.push(item.text as string);
      }
    }

    const messageText = textParts.join('\n');
    onEvent?.({
      type: 'user',
      message: messageText,
      toolResult: toolResult.length > 0 ? toolResult : undefined,
    });
  } else if (type === 'result') {
    // 终止事件
    const isError = event.is_error === true;
    const output = event.result as string | undefined;

    result.finalOutput = output;
    result.isError = isError;

    onEvent?.({
      type: 'result',
      subtype: isError ? 'error' : 'success',
      output: isError ? undefined : output,
      error: isError ? output : undefined,
    });
  }

  return result;
}

/**
 * 运行 Claude Code CLI
 */
async function runClaude(options: LocalRunOptions): Promise<LocalRunResult> {
  const { prompt, workDir, resume, onEvent, abortSignal } = options;

  const args = buildClaudeArgs(options);
  const promptText = resume ? resume.input : prompt;

  return new Promise((resolve) => {
    // spawn claude 进程
    const child: ChildProcess = spawn('claude', args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let sessionId: string | undefined;
    let finalOutput: string | undefined;
    let hasError = false;
    let errorMessage: string | undefined;
    let buffer = '';
    let killed = false;

    // 处理中止信号 —— 用于进程管理中的取消请求
    if (abortSignal) {
      if (abortSignal.aborted) {
        // 信号已被触发，立即终止
        child.kill('SIGTERM');
        killed = true;
      } else {
        abortSignal.addEventListener('abort', () => {
          child.kill('SIGTERM');
          killed = true;
        }, { once: true });
      }
    }

    // 发送 prompt 到 stdin
    child.stdin?.write(promptText);
    child.stdin?.end();

    // 处理 stdout（NDJSON 格式）
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // 按行分割处理
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // 保留未完成的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const result = parseClaudeEvent(event, onEvent);

          if (result.sessionId) sessionId = result.sessionId;
          if (result.finalOutput !== undefined) finalOutput = result.finalOutput;
          if (result.isError) {
            hasError = true;
            errorMessage = result.finalOutput;
          }
        } catch {
          // 忽略 JSON 解析错误（可能是非 JSON 输出）
          console.warn('[runner] 无法解析 Claude 输出行:', trimmed);
        }
      }
    });

    // 处理 stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      console.warn('[runner] Claude stderr:', text);
    });

    // 处理进程退出
    child.on('close', (code) => {
      // 处理缓冲区中剩余的数据
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as Record<string, unknown>;
          const result = parseClaudeEvent(event, onEvent);
          if (result.sessionId) sessionId = result.sessionId;
          if (result.finalOutput !== undefined) finalOutput = result.finalOutput;
          if (result.isError) {
            hasError = true;
            errorMessage = result.finalOutput;
          }
        } catch {
          // 忽略
        }
      }

      // 被中止信号终止
      if (killed) {
        resolve({
          success: false,
          error: '执行已被中止（进程管理取消）',
          sessionInfo: sessionId ? { providerConversationId: sessionId } : undefined,
        });
        return;
      }

      if (code !== 0 && !hasError) {
        hasError = true;
        errorMessage = `Claude CLI 退出，代码: ${code}`;
      }

      resolve({
        success: !hasError,
        finalOutput,
        error: errorMessage,
        sessionInfo: sessionId ? { providerConversationId: sessionId } : undefined,
      });
    });

    // 处理进程错误
    child.on('error', (err) => {
      resolve({
        success: false,
        error: `Claude CLI 启动失败: ${err.message}`,
      });
    });
  });
}

// ─── Codex CLI 适配器 ──────────────────────────────────────────────────────────

/**
 * 构建 Codex CLI 参数
 *
 * 关键参数说明：
 * - `exec`: 执行模式
 * - `--json`: 输出 JSON 格式事件流
 * - `-m <model>`: 指定模型
 * - `--dangerously-bypass-approvals-and-sandbox`: 跳过审批和沙箱
 * - `-`: 从 stdin 读取 prompt
 */
function buildCodexArgs(options: LocalRunOptions): string[] {
  const { model, resume } = options;

  const args: string[] = ['exec'];

  // 恢复会话模式
  if (resume) {
    args.push('resume', '--json');
    if (model) {
      args.push('-m', model);
    }
    args.push(resume.providerConversationId, '-');
  } else {
    args.push('--json');
    if (model) {
      args.push('-m', model);
    }
    args.push('--dangerously-bypass-approvals-and-sandbox', '-');
  }

  return args;
}

/**
 * 解析 Codex stream-json 事件
 *
 * 事件类型：
 * - thread.started: 初始化事件，包含 thread_id
 * - item.started: 项目开始（command_execution 等）
 * - item.completed: 项目完成
 * - error: 错误事件
 * - turn.completed: 回合完成（终止事件）
 */
function parseCodexEvent(
  event: Record<string, unknown>,
  onEvent?: (event: AdapterEvent) => void | Promise<void>,
): { sessionId?: string; finalOutput?: string; isError?: boolean } {
  const type = event.type as string;
  const result: { sessionId?: string; finalOutput?: string; isError?: boolean } = {};

  if (type === 'thread.started') {
    // 初始化事件
    const sessionId = event.thread_id as string;
    result.sessionId = sessionId;
    onEvent?.({ type: 'system', subtype: 'init', sessionId });
  } else if (type === 'item.started') {
    // 项目开始
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === 'command_execution') {
      onEvent?.({
        type: 'assistant',
        message: `执行命令: ${item.command ?? ''}`,
        toolUse: [{ id: item.id as string, name: 'command_execution' }],
      });
    }
  } else if (type === 'item.completed') {
    // 项目完成
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === 'command_execution') {
      onEvent?.({
        type: 'user',
        message: `命令执行完成`,
        toolResult: [{ toolUseId: item.id as string }],
      });
    } else if (item?.type === 'agent_message') {
      // Agent 消息
      const text = item.text as string;
      result.finalOutput = text;
      onEvent?.({ type: 'assistant', message: text });
    }

    // 检查项目级别错误
    if (item?.error) {
      result.isError = true;
    }
  } else if (type === 'error') {
    // 错误事件
    result.isError = true;
    const errorMsg = (event.message ?? event.error ?? '未知错误') as string;
    result.finalOutput = errorMsg;
    onEvent?.({
      type: 'result',
      subtype: 'error',
      error: errorMsg,
    });
  } else if (type === 'turn.completed') {
    // 终止事件
    onEvent?.({
      type: 'result',
      subtype: result.isError ? 'error' : 'success',
      output: result.isError ? undefined : result.finalOutput,
      error: result.isError ? result.finalOutput : undefined,
    });
  }

  return result;
}

/**
 * 运行 Codex CLI
 */
async function runCodex(options: LocalRunOptions): Promise<LocalRunResult> {
  const { prompt, workDir, resume, onEvent } = options;

  const args = buildCodexArgs(options);
  const promptText = resume ? resume.input : prompt;

  return new Promise((resolve) => {
    // spawn codex 进程
    const child: ChildProcess = spawn('codex', args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let sessionId: string | undefined;
    let finalOutput: string | undefined;
    let hasError = false;
    let errorMessage: string | undefined;
    let buffer = '';

    // 发送 prompt 到 stdin
    child.stdin?.write(promptText);
    child.stdin?.end();

    // 处理 stdout（NDJSON 格式）
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // 按行分割处理
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // 保留未完成的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const result = parseCodexEvent(event, onEvent);

          if (result.sessionId) sessionId = result.sessionId;
          if (result.finalOutput !== undefined) finalOutput = result.finalOutput;
          if (result.isError && !errorMessage) {
            hasError = true;
            errorMessage = result.finalOutput;
          }
        } catch {
          // 忽略 JSON 解析错误
          console.warn('[runner] 无法解析 Codex 输出行:', trimmed);
        }
      }
    });

    // 处理 stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      console.warn('[runner] Codex stderr:', text);
    });

    // 处理进程退出
    child.on('close', (code) => {
      // 处理缓冲区中剩余的数据
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as Record<string, unknown>;
          const result = parseCodexEvent(event, onEvent);
          if (result.sessionId) sessionId = result.sessionId;
          if (result.finalOutput !== undefined) finalOutput = result.finalOutput;
          if (result.isError && !errorMessage) {
            hasError = true;
            errorMessage = result.finalOutput;
          }
        } catch {
          // 忽略
        }
      }

      if (code !== 0 && !hasError) {
        hasError = true;
        errorMessage = `Codex CLI 退出，代码: ${code}`;
      }

      resolve({
        success: !hasError,
        finalOutput,
        error: errorMessage,
        sessionInfo: sessionId ? { providerConversationId: sessionId } : undefined,
      });
    });

    // 处理进程错误
    child.on('error', (err) => {
      resolve({
        success: false,
        error: `Codex CLI 启动失败: ${err.message}`,
      });
    });
  });
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * 生成唯一问题 ID（用于 inbox_ask）
 */
export function generateQuestionId(): string {
  return randomUUID();
}

/**
 * 创建 InboxQuestion 对象
 */
export function createInboxQuestion(body: string, choices?: string[]): InboxQuestion {
  return {
    id: generateQuestionId(),
    body,
    choices,
  };
}
