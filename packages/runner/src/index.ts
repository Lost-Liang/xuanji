/**
 * 璇玑 Runner - 入口
 *
 * 提供本地模式运行 Agent 的能力，支持 Claude Code 和 Codex CLI。
 * 包含 MCP Server 用于人机交互（inbox_ask 工具）。
 */

// 导出本地模式核心函数和类型
export {
  runLocal,
  generateQuestionId,
  createInboxQuestion,
  type LocalRunOptions,
  type LocalRunResult,
  type AdapterEvent,
  type InboxQuestion,
} from './local-runner.js';

// 导出 MCP Server 人机交互功能
export {
  createInboxMcpServer,
  connectMcpServer,
  setInboxCallback,
  removeInboxCallback,
} from './mcp-server.js';

// 版本常量
export const RUNNER_VERSION = '0.1.0';
