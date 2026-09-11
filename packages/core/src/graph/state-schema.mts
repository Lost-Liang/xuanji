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
  node_outputs: Annotation<Record<string, string[]>>({ reducer: (prev, next) => ({ ...prev, ...next }), default: () => ({}) }),  // sourceId → 各轮输出文本数组（合并语义）
  node_channels: Annotation<Record<string, string>>({ reducer: (_prev, next) => next ?? {}, default: () => ({}) }),    // sourceId → 私有 channel key
  // 回环重入标记（Task 2/Task 7）：nodeId → 本次是否由回环边重入该节点
  // 条件边 path 函数无法写 state，因此由路由前执行的节点包装器注入；
  // agent-node 读取该标记，决定「强制开新会话（重做）」还是「复用会话（续跑）」
  reentry: Annotation<Record<string, boolean>>({ reducer: (prev, next) => ({ ...prev, ...next }), default: () => ({}) }),
})

// 研发流程子图 state（与顶层共享 results/loop_counters/session_refs；task 独有）
export const SubState = Annotation.Root({
  task: Annotation<any>(),                                  // Send 传的单任务（子图独有，父图读不到）
  results: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  loop_counters: Annotation<Record<string, number>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  session_refs: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  // 并行隔离通道（spec §6.0）
  node_outputs: Annotation<Record<string, string[]>>({ reducer: (prev, next) => ({ ...prev, ...next }), default: () => ({}) }),  // sourceId → 各轮输出文本数组（合并语义）
  node_channels: Annotation<Record<string, string>>({ reducer: (_prev, next) => next ?? {}, default: () => ({}) }),    // sourceId → 私有 channel key
  // 回环重入标记（Task 2/Task 7）：nodeId → 本次是否由回环边重入该节点
  // 条件边 path 函数无法写 state，因此由路由前执行的节点包装器注入；
  // agent-node 读取该标记，决定「强制开新会话（重做）」还是「复用会话（续跑）」
  reentry: Annotation<Record<string, boolean>>({ reducer: (prev, next) => ({ ...prev, ...next }), default: () => ({}) }),
})
