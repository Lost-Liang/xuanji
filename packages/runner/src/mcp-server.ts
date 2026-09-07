// packages/runner/src/mcp-server.ts
// MCP Server —— 璇玑 V4 人机交互工具层
//
// 为 Agent（Claude Code / Codex CLI）提供 inbox_ask MCP 工具。
// Agent 在 CLI 进程中调用 inbox_ask 时，MCP Server 将问题转发给编排层，
// 编排层写入 inbox_questions 表并阻塞等待人类在 Dashboard 中回答。
// 人类回答后，答案通过 MCP 协议返回给 Agent，Agent 继续执行。
//
// 架构（两种模式）：
//
// 模式 A —— 编排进程内回调（callbackId 模式）：
// ```
// Agent (CLI) → inbox_ask MCP 工具
//       ↓ (stdio)
// MCP Server (编排进程) → 回调注册表 → onInboxAsk 回调
//       ↓
// handleInboxAsk → inbox_questions 表 → waitForHumanAnswer
//       ↓
// Dashboard → POST /api/inbox/:id/answer → notifyHumanAnswered → 返回答案
// ```
//
// 模式 B —— HTTP 桥接（mcp-bridge.ts 子进程模式）：
// ```
// Agent (CLI) → inbox_ask MCP 工具
//       ↓ (stdio)
// mcp-bridge.ts (子进程) → HTTP POST /api/internal/inbox-ask
//       ↓
// 编排器内部端点 → handleInboxAsk → waitForHumanAnswer → 返回答案
// ```
//
// 回调注册机制（模式 A）：
// - createInboxMcpServer(callbackId) 创建 MCP Server
// - setInboxCallback(callbackId, fn) 注册回调
// - removeInboxCallback(callbackId) 清理回调
// - MCP 工具调用时通过 callbackId 查找对应的回调函数

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { InboxQuestion } from './local-runner.js';

// ─── 回调注册表 ────────────────────────────────────────────────────────────────

/**
 * 全局回调注册表
 *
 * key: callbackId（由 runLocal 生成）
 * value: onInboxAsk 回调函数
 *
 * 每个执行实例有独立的回调，MCP 工具调用时通过 callbackId 路由到正确的回调。
 */
const callbacks = new Map<string, (question: InboxQuestion) => Promise<string>>();

/**
 * 设置/更新 inbox_ask 回调
 *
 * 在 runLocal 调用前注册，确保 MCP 工具能路由到正确的执行实例。
 */
export function setInboxCallback(
  callbackId: string,
  fn: (question: InboxQuestion) => Promise<string>,
): void {
  callbacks.set(callbackId, fn);
}

/**
 * 移除 inbox_ask 回调
 *
 * 任务完成/失败后调用，防止内存泄漏。
 */
export function removeInboxCallback(callbackId: string): void {
  callbacks.delete(callbackId);
}

// ─── inbox_ask 工具定义 ────────────────────────────────────────────────────────

/**
 * inbox_ask 工具 schema（MCP 协议标准格式）
 *
 * Agent 调用此工具时传入 question（必填）和 choices（可选），
 * 工具返回人类的回答文本。
 */
const INBOX_ASK_TOOL = {
  name: 'inbox_ask',
  description:
    '向人类提问并等待回答。当你在执行任务过程中遇到需要人类决策的问题时，' +
    '使用此工具向人类提问。人类会在 Dashboard 中看到你的问题并给出回答。' +
    '提问后你会等待人类回答，然后继续执行任务。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: '要向人类提出的问题内容',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: '可选的预设选项，人类可以从这些选项中选择',
      },
    },
    required: ['question'],
  },
};

// ─── MCP Server 创建 ──────────────────────────────────────────────────────────

/**
 * 创建 inbox_ask MCP Server（基于回调注册表）
 *
 * Server 注册 inbox_ask 工具。当 Agent 调用该工具时：
 * 1. 通过 callbackId 查找注册的回调函数
 * 2. 调用回调（回调负责写入 DB 并等待人类回答）
 * 3. 将人类回答返回给 Agent
 *
 * @param callbackId - 回调标识，用于路由到正确的执行实例
 * @returns MCP Server 实例（已注册工具处理器，未连接传输层）
 */
export function createInboxMcpServer(callbackId: string): Server {
  const server = new Server(
    {
      name: 'xuanji-inbox',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 注册工具列表
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [INBOX_ASK_TOOL],
  }));

  // 注册工具调用处理
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'inbox_ask') {
      return handleInboxAskCall(callbackId, request.params.arguments as {
        question: string;
        choices?: string[];
      });
    }

    return {
      content: [{ type: 'text' as const, text: `未知工具：${request.params.name}` }],
      isError: true,
    };
  });

  return server;
}

/**
 * 创建 inbox_ask MCP Server（基于自定义处理器）
 *
 * 与 createInboxMcpServer 不同，此函数接受一个自定义处理器函数，
 * 用于桥接场景（mcp-bridge.ts）——处理器通过 HTTP 调用编排器。
 *
 * @param handler - 处理 inbox_ask 调用的函数
 * @returns MCP Server 实例
 */
export function createBridgeMcpServer(
  handler: (question: string, choices?: string[]) => Promise<string>,
): Server {
  const server = new Server(
    {
      name: 'xuanji-inbox-bridge',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [INBOX_ASK_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'inbox_ask') {
      const { question, choices } = request.params.arguments as {
        question: string;
        choices?: string[];
      };

      try {
        const answer = await handler(question, choices);
        return {
          content: [{ type: 'text' as const, text: `人类的回答：${answer}` }],
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `inbox_ask 失败：${errorMsg}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{ type: 'text' as const, text: `未知工具：${request.params.name}` }],
      isError: true,
    };
  });

  return server;
}

/**
 * 处理 inbox_ask 工具调用（回调注册表模式）
 *
 * 从回调注册表中查找 callbackId 对应的回调函数并调用。
 */
async function handleInboxAskCall(
  callbackId: string,
  args: { question: string; choices?: string[] },
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const callback = callbacks.get(callbackId);
  if (!callback) {
    return {
      content: [{
        type: 'text' as const,
        text: '错误：人机交互回调未注册，无法处理 inbox_ask 请求。请确认编排器已正确初始化。',
      }],
      isError: true,
    };
  }

  try {
    const inboxQuestion: InboxQuestion = {
      id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      body: args.question,
      choices: args.choices,
    };

    const answer = await callback(inboxQuestion);
    return {
      content: [{ type: 'text' as const, text: `人类的回答：${answer}` }],
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `inbox_ask 失败：${errorMsg}` }],
      isError: true,
    };
  }
}

// ─── 传输层连接 ────────────────────────────────────────────────────────────────

/**
 * 启动 MCP Server 并连接 stdio 传输层
 *
 * @param server - MCP Server 实例
 * @returns stdio 传输层实例（可用于清理）
 */
export async function connectMcpServer(server: Server): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}
