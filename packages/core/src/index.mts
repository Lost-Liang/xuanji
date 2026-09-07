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

// 调度图（Task 8: LangGraph 调度）
export { buildSchedulerGraph, SchedulerState } from './graph/scheduler-graph.mjs';
export type { SchedulerStateType } from './graph/scheduler-graph.mjs';
export { workerNode } from './graph/worker-graph.mjs';

// 时序常量
export { MAX_RATE_LIMIT_RETRIES, computeRateLimitBackoff, SCHEDULER_IDLE_WAIT_MS, LEASE_DURATION_MS, ZOMBIE_TIMEOUT_MINUTES } from './timing-constants.mjs';

// ─── API 路由（Express） ──────────────────────────────────────────────────────
import express from 'express';
import { tasksRouter } from './routes/tasks.mjs';
import { requirementsRouter } from './routes/requirements.mjs';
import { executionsRouter } from './routes/executions.mjs';
import { inboxRouter } from './routes/inbox.mjs';
import { conversationsRouter } from './routes/conversations.mjs';
import { internalRouter } from './routes/internal.mjs';

/**
 * 创建 Express 应用并注册所有路由
 * 独立导出便于测试和复用
 */
export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  // 注册 RESTful 路由
  app.use('/api/tasks', tasksRouter);
  app.use('/api/requirements', requirementsRouter);
  app.use('/api/executions', executionsRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/conversations', conversationsRouter);

  // 内部 API（MCP Bridge 专用）
  app.use('/api/internal', internalRouter);

  // 健康检查端点
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION });
  });

  return app;
}

/**
 * 启动 HTTP 服务器
 * 默认端口 3000，可通过 PORT 环境变量覆盖
 */
const PORT = Number(process.env.PORT) || 3000;
const app = createApp();
app.listen(PORT, () => {
  console.log(`璇玑 Core API 运行在端口 ${PORT}`);
});
