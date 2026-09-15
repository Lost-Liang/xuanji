// packages/core/src/graph/checkpointer.mts
// LangGraph Checkpoint 持久化 —— 璇玑 V4
//
// 已知限制：
// - @langchain/langgraph@0.2.74 使用 langgraph-checkpoint@0.0.18
// - @langchain/langgraph-checkpoint-postgres@1.0.5 需要 checkpoint@1.1.4+
// - 版本不兼容，PostgresSaver 的 serde 接口是 async 而 BaseCheckpointSaver 期望 sync
// - 当前使用 MemorySaver 作为降级方案（进程重启后状态丢失）
//
// TODO: 等待 langgraph 升级到兼容 checkpoint@1.x 后启用 PostgresSaver

import { MemorySaver } from '@langchain/langgraph';

// 单例 checkpointer（当前使用 MemorySaver）
let _checkpointer: MemorySaver | null = null;

/**
 * 获取 Checkpointer 单例
 *
 * 当前返回 MemorySaver（进程内状态）。
 * 未来升级到 PostgresSaver 后支持跨进程恢复。
 *
 * @returns MemorySaver 实例
 */
export async function getCheckpointer(): Promise<MemorySaver> {
  if (!_checkpointer) {
    _checkpointer = new MemorySaver();
    console.log('[checkpointer] MemorySaver 已初始化（PostgresSaver 版本待兼容）');
  }
  return _checkpointer;
}

/**
 * 同步获取 checkpointer
 *
 * @returns MemorySaver 实例
 */
export function getCheckpointerSync(): MemorySaver {
  if (!_checkpointer) {
    _checkpointer = new MemorySaver();
  }
  return _checkpointer;
}

/**
 * 检查 checkpointer 是否已初始化
 */
export function isCheckpointerReady(): boolean {
  return _checkpointer !== null;
}