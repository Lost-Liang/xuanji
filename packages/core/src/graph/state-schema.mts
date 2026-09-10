// core/server/src/graph/state-schema.mts —— 两层 state，父子共享 results/loop_counters/session_refs（spec §4.2）
import { Annotation } from '@langchain/langgraph'

// 顶层 state
export const TopState = Annotation.Root({
  input: Annotation<string>(),                              // 一句话需求
  spec: Annotation<string>(),                               // 需求规格
  tasks: Annotation<any[]>(),                               // 任务列表
  task: Annotation<any>(),                                  // 当前任务（用于 ruoyi-dev-flow 等单任务流程）
  results: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),  // 子图回传合并
  review_decisions: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  loop_counters: Annotation<Record<string, number>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  session_refs: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  // 并行隔离通道（spec §6.0）
  node_outputs: Annotation<Record<string, string[]>>({ reducer: (_prev, next) => next ?? {}, default: () => ({}) }),  // sourceId → 各轮输出文本数组
  node_channels: Annotation<Record<string, string>>({ reducer: (_prev, next) => next ?? {}, default: () => ({}) }),    // sourceId → 私有 channel key
})

// 研发流程子图 state（与顶层共享 results/loop_counters/session_refs；task 独有）
export const SubState = Annotation.Root({
  task: Annotation<any>(),                                  // Send 传的单任务（子图独有，父图读不到）
  results: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  loop_counters: Annotation<Record<string, number>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  session_refs: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  // 并行隔离通道（spec §6.0）
  node_outputs: Annotation<Record<string, string[]>>({ reducer: (_prev, next) => next ?? {}, default: () => ({}) }),  // sourceId → 各轮输出文本数组
  node_channels: Annotation<Record<string, string>>({ reducer: (_prev, next) => next ?? {}, default: () => ({}) }),    // sourceId → 私有 channel key
})
