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
// 注意：编排器的内部端点使用长轮询分片模式（long-polling chunking），
// 每次请求最多等待 30 秒，MCP Bridge 循环调用直到收到回答。
// 总超时：24 小时（2880 次轮询）。

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
 * 通过 HTTP 长轮询分片等待人类回答
 *
 * 使用循环调用编排器 /api/internal/inbox-ask 端点：
 * 1. 首次调用：创建问题并返回 questionId
 * 2. 后续调用：轮询等待回答（每次最多 30 秒）
 * 3. 收到 answered 状态后返回答案
 *
 * @param question - 问题内容
 * @param choices - 可选的预设选项
 * @returns 人类的回答
 */
async function handleInboxAskViaHttp(
  question: string,
  choices?: string[],
): Promise<string> {
  let questionId: string | null = null;
  let isFirst = true;
  const maxAttempts = 24 * 60 * 2; // 24 小时 / 30 秒 = 2880 次
  let attempts = 0;

  // 循环调用直到收到回答
  while (attempts < maxAttempts) {
    attempts++;

    const body: Record<string, any> = isFirst
      ? { create: true, executionId: EXECUTION_ID, question, choices }
      : { questionId };

    try {
      const response = await fetch(`${API_URL}/api/internal/inbox-ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // 单次请求超时 35 秒（略大于服务端 30 秒）
        signal: AbortSignal.timeout(35_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`inbox-ask 请求失败: ${response.status} ${errorText}`);
      }

      const result = await response.json() as {
        questionId: string;
        status: 'answered' | 'pending' | 'timeout';
        answer?: string;
        continue?: boolean;
        error?: string;
      };

      if (result.status === 'answered' && result.answer) {
        return result.answer;
      }

      if (result.status === 'timeout') {
        throw new Error(result.error || '等待人类回答超时');
      }

      // 继续轮询
      questionId = result.questionId;
      isFirst = false;

    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        // 单次请求超时，继续重试
        console.warn('[mcp-bridge] 单次轮询超时，继续重试...');
        continue;
      }
      throw err;
    }
  }

  throw new Error('等待人类回答超时（超过 24 小时）');
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
