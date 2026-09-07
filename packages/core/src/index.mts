// 璇玑 Core - 入口
export const VERSION = '0.1.0';

// Storage 层
export { taskStore } from './storage/task-store.mjs';
export { executionStore } from './storage/execution-store.mjs';
export type { LeaseInfo } from './storage/execution-store.mjs';
export { requirementStore } from './storage/requirement-store.mjs';
export { conversationStore } from './storage/conversation-store.mjs';

// Graph 层（V3 迁移）
// 类型
export type {
  GraphDef, GraphNode, GraphEdge, NodeType,
  WorkflowDef, WorkflowNode, WorkflowEdge, EdgeCondition,
} from './graph/types.mjs';
// 状态定义
export { TopState, SubState } from './graph/state-schema.mjs';
// 工具函数
export { gatePath, findEntryNodes, routeFromSource, withLoopCounter, collectRoutes } from './graph/builder.mjs';
export type { RouteMeta } from './graph/builder.mjs';
// YAML 加载器
export { assertWorkflowValid, loadWorkflowFromYaml, mapYamlToGraphDef, loadWorkflowFromFile, loadWorkflowsFromDir } from './graph/yaml-loader.mjs';
// 条件函数注册表
export { conditionRegistry, registerCondition, getCondition, hasCondition, listConditions } from './graph/conditions/index.mjs';
export type { ConditionFunction } from './graph/conditions/index.mjs';
export { initDefaultConditions } from './graph/conditions/default-conditions.mjs';
export { evaluateKeywordCondition } from './graph/conditions/keyword-evaluator.mjs';
export type { KeywordConfig } from './graph/conditions/keyword-evaluator.mjs';
export { sourceText } from './graph/conditions/source-text.mjs';
export type { SourceState } from './graph/conditions/source-text.mjs';
// 节点工厂
export { makeGateNode } from './graph/nodes/gate-node.mjs';
export { makeCommandNode } from './graph/nodes/command-node.mjs';
// Worktree 管理
export { ensureTargetClone, ensureReqBranch, ensureTaskWorktree, removeTaskWorktree } from './graph/worktree.mjs';
