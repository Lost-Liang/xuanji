// core/server/src/graph/conditions/source-text.mts —— 统一读取节点输出
// TODO: Task 7 迁移 — TopState/SubState 未使用，改用自定义 SourceState 接口
// import type { TopState, SubState } from '../state-schema.mjs'

/**
 * 统一读取某 sourceId 节点最近一次可判文本。
 * 1) 若节点声明 private channel（condition_config.write_key），从该 channel 取（array 尾部）；
 * 2) 否则从 "sourceId → 最近一次文本" 的隔离映射取尾部；
 */
export interface SourceState {
  node_outputs?: Record<string, string[]>   // sourceId → 各轮文本
  node_channels?: Record<string, string>     // sourceId → 私有 channel key
}

export function sourceText(state: SourceState, sourceId: string): string {
  // 1) 有私有 channel 的节点走 channel 尾部
  const ck = state.node_channels?.[sourceId]
  if (ck) {
    const ch = (state as any)[ck]
    if (Array.isArray(ch)) return String(ch.at(-1) ?? '')
    return String(ch ?? '')
  }
  // 2) 回退隔离映射
  const outputs = state.node_outputs?.[sourceId]
  if (Array.isArray(outputs)) return String(outputs.at(-1) ?? '')
  return String(outputs ?? '')
}