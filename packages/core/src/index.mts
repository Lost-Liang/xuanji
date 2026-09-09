// 璇玑 Core - 入口
export const VERSION = '0.1.0';

// Storage 层
export { taskStore } from './storage/task-store.mjs';
export { executionStore } from './storage/execution-store.mjs';
export type { LeaseInfo } from './storage/execution-store.mjs';
export { requirementStore } from './storage/requirement-store.mjs';
export { conversationStore } from './storage/conversation-store.mjs';
// Agent Binding Store（V4 新增：读取 Agent 配置）
export { getByRole, list, getById } from './storage/agent-binding-store.mjs';
// 审计 store（V4 新增：decision/intervention/log/event 留痕）
export { logStore } from './storage/log-store.mjs';
export { decisionStore } from './storage/decision-store.mjs';
export { interventionStore } from './storage/intervention-store.mjs';
export { eventStore } from './storage/event-store.mjs';

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
// 图构建核心函数（V4 修复：从注释恢复）
export { buildTopGraph, buildSubGraph, buildGraphFromDef } from './graph/builder.mjs';
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

// 恢复图（僵尸执行检测与清理）
export { buildRecoveryGraph, findZombies, RecoveryState } from './graph/recovery-graph.mjs';
export type { RecoveryStateType } from './graph/recovery-graph.mjs';

// 流程执行运行时（M1.2 graph-runner）
export { graphRunner, startExecution, resumeExecution, loadFlow } from './graph/graph-runner.mjs';
export type { StartExecutionOpts, ResumeExecutionOpts } from './graph/graph-runner.mjs';

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
import { workflowsRouter } from './routes/workflows.mjs';
import { agentBindingsRouter } from './routes/agent-bindings.mjs';
import { skillsRouter } from './routes/skills.mjs';
import { graphDefinitionsRouter } from './routes/graph-definitions.mjs';
import { booksRouter } from './routes/books.mjs';
import { projectsRouter } from './routes/projects.mjs';

// ─── 后台调度 ────────────────────────────────────────────────────────────────
import { buildSchedulerGraph } from './graph/scheduler-graph.mjs';
import { buildRecoveryGraph } from './graph/recovery-graph.mjs';
import { initDefaultConditions } from './graph/conditions/default-conditions.mjs';
import { recoverOrphanedQuestions, startPeriodicCleanup } from './graph/orphan-detection.mjs';

// 启动前注册所有默认条件函数（compile_pass / test_pass / quality_pass / security_pass 等）
initDefaultConditions();

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
  app.use('/api/workflows', workflowsRouter);
  app.use('/api/agent-bindings', agentBindingsRouter);
  app.use('/api/skills', skillsRouter);
  app.use('/api/graph-definitions', graphDefinitionsRouter);
  app.use('/api/books', booksRouter);
  app.use('/api/projects', projectsRouter);

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

// ─── 后台调度循环 ────────────────────────────────────────────────────────────

/** 调度器运行标志（用于优雅关闭） */
let schedulerRunning = true;

/**
 * 启动调度器后台循环
 * 轮询 pending/rate_limited 的 TaskExecution，分发给 workerNode 执行
 */
async function startSchedulerLoop() {
  const schedulerGraph = buildSchedulerGraph();
  console.log('[scheduler] 调度器后台循环已启动');

  while (schedulerRunning) {
    try {
      await schedulerGraph.invoke({});
    } catch (err) {
      console.error('[scheduler] 调度循环出错:', (err as Error).message);
    }
    // 等待后重新轮询（补偿移除的 waitNode，避免空转消耗数据库）
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('[scheduler] 调度器已停止');
}

/**
 * 启动僵尸恢复循环（每 5 分钟检测一次）
 * 检测 heartbeat 超时的执行实例，重置为 pending 重新调度
 */
function startRecoveryLoop() {
  const recoveryGraph = buildRecoveryGraph();
  const RECOVERY_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

  const interval = setInterval(async () => {
    try {
      await recoveryGraph.invoke({});
    } catch (err) {
      console.error('[recovery] 恢复循环出错:', (err as Error).message);
    }
  }, RECOVERY_INTERVAL_MS);
  interval.unref(); // 不阻塞进程退出
  console.log('[recovery] 僵尸恢复循环已启动（每 5 分钟）');
}

// 启动后台循环
startSchedulerLoop().catch(err => console.error('[scheduler] 致命错误:', err));
startRecoveryLoop();

// 启动时运行孤儿检测
recoverOrphanedQuestions().catch(err => {
  console.error('[startup] 孤儿检测失败:', err);
});

// 启动定期清理
startPeriodicCleanup();

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[core] 收到 SIGTERM，正在关闭...');
  schedulerRunning = false;
});
process.on('SIGINT', () => {
  console.log('[core] 收到 SIGINT，正在关闭...');
  schedulerRunning = false;
});
