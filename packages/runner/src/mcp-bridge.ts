// packages/runner/src/mcp-bridge.ts
// MCP Bridge —— 璇玑 V4 人机交互桥接脚本
//
// 这是一个独立的入口脚本，由 Claude Code CLI 作为 MCP Server 子进程启动。
// 通过 HTTP 调用编排器的内部 API 端点来实现 inbox_ask 功能。
//
// 环境变量：
// - XUANJI_API_URL: 编排器 API 地址（如 http://localhost:3000）
// - XUANJI_EXECUTION_ID: 当前执行实例 ID
//
// 使用方式：
// Claude CLI 通过 --mcp-config 指定此脚本为 MCP Server：
// ```json
// {
//   "mcpServers": {
//     "xuanji-inbox": {
//       "command": "node",
//       "args": ["path/to/dist/mcp-bridge.js"],
//       "env": {
//         "XUANJI_API_URL": "http://localhost:3000",
//         "XUANJI_EXECUTION_ID": "uuid-here"
//       }
//     }
//   }
// }
// ```
//
// 通信流程：
// 1. CLI 启动此脚本（通过 MCP 协议，stdio）
// 2. Agent 调用 inbox_ask 工具
// 3. 此脚本 POST /api/internal/inbox-ask 到编排器
// 4. 编排器写入 inbox_questions 表，阻塞等待人类回答
// 5. 人类在 Dashboard 回答 → 编排器返回答案
// 6. 此脚本将答案通过 MCP 协议返回给 Agent
//
// 注意：编排器的内部端点使用长轮询（long-polling），
// 请求会阻塞直到人类回答或超时（默认 24 小时）。
// HTTP 客户端需设置较长的超时时间。

import {
  createBridgeMcpServer,
  connectMcpServer,
} from './mcp-server.js';

// ─── 环境变量读取 ──────────────────────────────────────────────────────────────

const API_URL = process.env.XUANJI_API_URL;
const EXECUTION_ID = process.env.XUANJI_EXECUTION_ID;

if (!API_URL) {
  console.error('[mcp-bridge] 缺少环境变量 XUANJI_API_URL');
  process.exit(1);
}

if (!EXECUTION_ID) {
  console.error('[mcp-bridge] 缺少环境变量 XUANJI_EXECUTION_ID');
  process.exit(1);
}

// ─── HTTP 桥接处理器 ───────────────────────────────────────────────────────────

/**
 * 通过 HTTP 调用编排器内部端点处理 inbox_ask
 *
 * 发送 POST 请求到编排器的 /api/internal/inbox-ask 端点。
 * 编排器会：
 * 1. 将问题写入 inbox_questions 表
 * 2. 阻塞等待人类回答（long-polling，最长 24 小时）
 * 3. 返回人类的回答
 *
 * @param question - 问题内容
 * @param choices - 可选的预设选项
 * @returns 人类的回答
 */
async function handleInboxAskViaHttp(
  question: string,
  choices?: string[],
): Promise<string> {
  const url = `${API_URL}/api/internal/inbox-ask`;

  // 长轮询：请求可能阻塞很长时间（直到人类回答）
  // 使用 fetch + AbortController 设置合理的超时（25 小时，略大于服务端 24h 超时）
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25 * 60 * 60 * 1000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionId: EXECUTION_ID,
        question,
        choices,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`编排器返回 ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { answer: string; questionId: string };
    return data.answer;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── 启动 ──────────────────────────────────────────────────────────────────────

/**
 * 启动 MCP Bridge
 *
 * 创建桥接 MCP Server 并连接 stdio 传输层。
 * 日志输出到 stderr（不影响 stdio MCP 协议通信）。
 */
async function main() {
  process.stderr.write(
    `[mcp-bridge] 启动: apiUrl=${API_URL}, executionId=${EXECUTION_ID}\n`,
  );

  const server = createBridgeMcpServer(handleInboxAskViaHttp);
  await connectMcpServer(server);

  process.stderr.write('[mcp-bridge] MCP Server 已连接，等待 CLI 请求...\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-bridge] 启动失败: ${err.message}\n`);
  process.exit(1);
});
