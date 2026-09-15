// packages/core/src/graph/builder.mts —— 画布 JSON / YAML → LangGraph StateGraph（spec §4.2/§6.2）
// V4 修复：恢复 buildTopGraph / buildSubGraph / buildGraphFromDef 三个核心构建函数
//
// V3 → V4 关键调整：
// - checkpointer：V3 用 SQLite，V4 暂用 MemorySaver（后续接入 Prisma-based checkpoint）
// - pgClient → db（Prisma 客户端）
// - loop-paths.mts 暂未迁移，buildSubGraph 中 testing/quality/security 条件边内联处理
// - seed-graph.mts 暂未迁移，defaultSubGraph 使用空图占位
import { Send, StateGraph, MemorySaver } from '@langchain/langgraph'
import type { GraphDef, WorkflowDef, GraphNode } from './types.mjs'
import { TopState, SubState } from './state-schema.mjs'
import { makeAgentNode, buildAgentContext } from './agent-node.mjs'
import { makeGateNode } from './nodes/gate-node.mjs'
import { makeCommandNode } from './nodes/command-node.mjs'
import { db } from '../db.mjs'
import { getCondition } from './conditions/index.mjs'
import { evaluateKeywordCondition } from './conditions/keyword-evaluator.mjs'
import { loadWorkflowFromYaml, mapYamlToGraphDef } from './yaml-loader.mjs'
import { sourceText } from './conditions/source-text.mjs'
import { WorkflowValidationError } from './errors.mjs'
import { getCheckpointer, getCheckpointerSync } from './checkpointer.mjs'

// ─── Checkpointer 初始化 ─────────────────────────────────────────────────────
// V4: 当前使用 MemorySaver（langgraph-checkpoint-postgres 版本不兼容，待升级）
// 已知限制：进程重启后 checkpoint 状态丢失

/**
 * 初始化 Checkpointer（异步）
 *
 * 首次调用创建 checkpointer 实例。
 * 当前使用 MemorySaver，未来升级为 PostgresSaver。
 */
export async function initCheckpointer(): Promise<void> {
  await getCheckpointer()
}

/**
 * 获取当前 checkpointer 实例（同步）
 *
 * 未初始化时创建 MemorySaver 作为降级方案。
 */
function getCheckpointerInstance() {
  return getCheckpointerSync()
}

// ─── 默认子图占位（seed-graph.mts 暂未迁移） ───────────────────────────────────
const defaultSubGraph: GraphDef = {
  name: 'default-dev-flow',
  plugin_id: 'default',
  nodes: [],
  edges: [],
  loops: [],
  subgraphs: [],
  version: 1,
}

// ─── 循环节点计数器统一管理（V4 修复）──────────────────────────────────────
// 所有节点都通过 withLoopCounter 包装，统一递增 loop_counters
// 删除 V3 的 FIX_LOOP_KEY 映射表，避免遗漏

// ─── 条件边源节点集合（spec §4.5） ─────────────────────────────────────────────
// 这些节点不使用普通 addEdge，而使用 addConditionalEdges（V3 buildSubGraph 用）
const CONDITIONAL_SOURCES = new Set([
  'compile_check', 'testing', 'quality_check', 'security_check',
])

// 条件边目的地（spec §4.5）：compile_check/testing/quality_check/security_check 条件边可能路由到的节点。
// 其中 bug_fix/quality_issue_fix/security_issue_fix 只经条件边到达、从不出现在普通 edge 的 target ——
// findEntryNodes 须排除，否则误判为入口、__start__ 连入导致 step 0 并行触发 fix 节点，
// 跳过 compile_check/testing/quality_check/security_check（子图 current_node_id 直接跳到 fix 节点）。
const CONDITIONAL_TARGETS = new Set([
  'bug_fix', 'testing',                         // compile_check 条件边
  'quality_issue_fix', 'quality_check',         // testing 条件边
  'security_issue_fix', 'security_check',       // quality_check 条件边
  'final_review',                               // security_check 条件边
])

// ─── 动态条件边路由元数据（spec §6.2） ──────────────────────────────────────────
export interface RouteMeta {
  source: string
  edges: Array<{
    target: string
    condition?: import('./types.mjs').EdgeCondition
    loop_back?: boolean
    is_default?: boolean
    loop_max?: number
  }>
}

// ─── 动态条件边路由函数（V4 修正 + Task 3）─────────────────────────────────────
/**
 * 根据状态和路由元数据决定下一个节点
 * 优先级：非回环条件边 → 回环条件边（未超限）→ 默认边 → __end__
 *
 * V4 修正：
 * - 回环边界判定：visits <= limit（而非 done < limit）
 * - visits = loop_counters[source]（已完成的执行次数）
 * - 第 1 次完成 visits=1，若 loop_max=2，1 <= 2 → 回环
 * - 第 2 次完成 visits=2，若 loop_max=2，2 <= 2 → 回环
 * - 第 3 次完成 visits=3，若 loop_max=2，3 > 2 → 耗尽
 *
 * Task 3 修正：
 * - 条件函数签名改为 (sourceText: string | null) => boolean
 * - 从 YAML 的 source 字段读取节点 ID
 * - 使用 sourceText(state, sourceId) 获取文本并注入
 */
export function routeFromSource(state: any, meta: RouteMeta, DEFAULT_MAX: number = 3): string {
  const nonDefault = meta.edges.filter((e) => !e.is_default && !e.loop_back)
  const loopBack = meta.edges.find((e) => e.loop_back)

  // 评估非回环条件边
  for (const e of nonDefault) {
    if (!e.condition) continue
    if (e.condition.type === 'keyword') {
      if (evaluateKeywordCondition(sourceText(state, meta.source), e.condition.config)) return e.target
    } else if (e.condition.type === 'function') {
      const fn = getCondition(e.condition.config.name!)
      // Task 3: 从 YAML 的 source 字段读取节点 ID，注入文本
      const sourceId = e.condition.config.source
      const text = sourceId ? sourceText(state, sourceId) : null
      if (fn(text)) return e.target
    }
  }

  // 回环边（修复循环）
  if (loopBack) {
    const visits = state.loop_counters?.[meta.source] ?? 0
    const limit = loopBack.loop_max ?? DEFAULT_MAX
    // V4 修正：visits <= limit（spec §5.2）
    // loop_max: 2 时，允许 visits=1,2 回环，visits=3 耗尽
    // 第 1 次完成（visits=1），1 <= 2 → 回环
    // 第 2 次完成（visits=2），2 <= 2 → 回环
    // 第 3 次完成（visits=3），3 > 2 → 耗尽
    if (visits <= limit) {
      if (loopBack.condition) {
        if (loopBack.condition.type === 'keyword') {
          if (evaluateKeywordCondition(sourceText(state, meta.source), loopBack.condition.config)) return loopBack.target
        } else if (loopBack.condition.type === 'function') {
          const fn = getCondition(loopBack.condition.config.name!)
          // Task 3: 从 YAML 的 source 字段读取节点 ID，注入文本
          const sourceId = loopBack.condition.config.source
          const text = sourceId ? sourceText(state, sourceId) : null
          if (fn(text)) return loopBack.target
        }
      } else {
        return loopBack.target
      }
    }
  }

  const d = meta.edges.find((e) => e.is_default)
  return d ? d.target : '__end__'
}

// ─── 节点包装：自动递增 loop_counters（V4 统一）──────────────────────────
/**
 * 包装 action：执行后自增指定 nodeId 的 loop_counter，并在回环重入时注入 reentry 标记
 *
 * V4 修复：
 * - 所有节点统一使用此包装（删除 FIX_LOOP_KEY）
 * - 合并 state.loop_counters 和 result.loop_counters，保留既有计数
 * - 确保 loop_counters[nodeId] 是唯一真相来源
 *
 * Task 7 修复（4d2d1401 回归）：
 * - 条件边 path 函数在 langgraph 0.2.x 无法通过返回 Command 写入 state
 *   （`new Command({goto, update})` 会被静默忽略，回环边因此永远不生效）
 * - 因此 reentry 标记改由本包装器注入：源节点执行完、路由判定前，
 *   算出本次是否会走回环边，若会则写入 `reentry[回环目标] = true`
 * - 条件边 path 函数随后返回普通字符串目标，标签即可被目标节点消费
 *
 * @param action 节点 action
 * @param nodeId 节点 ID（计数器键）
 * @param routeMeta 该节点为条件边源时的路由元数据（可选；无则不做回环判定）
 */
export function withLoopCounter(
  action: (s: any, c?: any) => any,
  nodeId: string,
  routeMeta?: RouteMeta,
) {
  return async (state: any, config: any) => {
    const r = await action(state, config)

    // 合并 state 和 result 的 loop_counters
    const existingCounters = {
      ...(state.loop_counters || {}),
      ...(r?.loop_counters || {}),
    }

    const update: Record<string, any> = {
      ...r,
      loop_counters: {
        ...existingCounters,
        [nodeId]: (existingCounters[nodeId] || 0) + 1,
      },
    }

    // Task 7：回环重入标记注入。
    // 用「已应用本次更新」的 state 做路由判定，结果必须与条件边 path 函数的判定一致。
    if (routeMeta) {
      const routeState = {
        ...state,
        ...update,
        node_outputs: { ...(state.node_outputs || {}), ...(update.node_outputs || {}) },
      }
      const target = routeFromSource(routeState, routeMeta)
      const loopBack = routeMeta.edges.find((e) => e.loop_back && e.target === target)
      if (loopBack) {
        update.reentry = { ...(state.reentry || {}), [target]: true }
      }
    }

    return update
  }
}

// ─── 收集动态条件边路由（spec §6.2） ────────────────────────────────────────────
/**
 * 将 WorkflowDef 的边按 source 分组，生成 RouteMeta 数组
 * 用于 buildGraphFromDef 的 addConditionalEdges
 */
export function collectRoutes(def: WorkflowDef, _graph: GraphDef): RouteMeta[] {
  const routes: RouteMeta[] = []
  const sourceEdges = new Map<string, import('./types.mjs').WorkflowEdge[]>()

  // 按源节点分组边
  for (const edge of def.edges) {
    const group = sourceEdges.get(edge.from) || []
    group.push(edge)
    sourceEdges.set(edge.from, group)
  }

  // 为每个源节点创建 RouteMeta
  for (const [source, edges] of sourceEdges) {
    const routeMeta: RouteMeta = {
      source,
      edges: edges.map((e) => {
        // 构建时验证条件函数是否存在
        if (e.condition?.type === 'function') {
          const fnName = e.condition.config.name!
          getCondition(fnName) // 不存在会抛出错误
        }

        return {
          target: e.to === '__end__' ? '__end__' : e.to,
          condition: e.condition,
          loop_back: e.loop_max !== undefined && e.to !== '__end__',
          is_default: !e.condition && e.loop_max === undefined,
          loop_max: e.loop_max,
        }
      }),
    }
    routes.push(routeMeta)
  }

  return routes
}

// ─── 数据流 inputs 可用性过滤（Task 7）───────────────────────────────────────
const BUILTIN_INPUT_SOURCES = ['task', 'input', 'spec']

/**
 * 过滤掉「运行期尚无产出」的上游节点输入。
 *
 * 为什么需要：回环节点的 inputs 天然包含「回环方向的上游」，例如
 * `develop: inputs: [task, test]`——develop 第一次执行时 test 根本还没跑过。
 * buildAgentContext 对缺失上游是 hard throw（Task 5 契约），首次进入就会炸。
 *
 * 节点存在性由加载期校验兜底（引用了不存在的节点 id 会在 buildGraphFromDef 抛错），
 * 因此这里只处理「已声明但尚未产出」的合法情况，并打日志留痕。
 */
export function availableInputs(state: any, inputs: string[]): string[] {
  const available: string[] = []
  for (const src of inputs) {
    if (BUILTIN_INPUT_SOURCES.includes(src) || state?.node_outputs?.[src] !== undefined) {
      available.push(src)
    } else {
      console.warn(`[builder] inputs 源 '${src}' 尚无产出，本次跳过（回环首次进入属正常）`)
    }
  }
  return available
}

// ─── 节点 type → action 工厂 ────────────────────────────────────────────────────
/**
 * 根据节点类型创建对应的 LangGraph action
 *
 * - agent:   通过 AgentOS Runner 执行（makeAgentNode）
 * - gate:    人审 interrupt 节点（makeGateNode）
 * - command: shell 命令节点（makeCommandNode）
 *
 * @param node 图节点定义
 * @param isSubgraph 是否子图节点（影响交互模式和 worktree）
 */
function nodeAction(node: GraphNode, isSubgraph = false) {
  const interactionMode = node.interaction_mode ?? (isSubgraph ? 'autonomous' : 'interactive')

  switch (node.type) {
    case 'agent': {
      const bindingIds = node.agent_binding_ids ?? []
      if (bindingIds.length === 0) {
        throw new Error(`agent 节点 ${node.id} 缺少 agent_binding_ids`)
      }

      // Task 5/Task 7: 优先使用 inputs 数组，回退到 context 字段
      // inputs 中尚未产出的上游会被过滤（回环首次进入时该上游还没跑过）
      const buildPrompt = node.inputs
        ? (s: any) => buildAgentContext(s, availableInputs(s, node.inputs!))
        : (s: any) => buildAgentContext(s, [node.context || 'input'])

      return makeAgentNode({
        bindingIds,
        selector: node.selector,
        writeKey: node.write_key ?? 'results',
        nodeId: node.id,
        isSubgraph,
        isArchive: node.id === 'archive',
        interactionMode,
        exitContract: node.exit_contract,   // Task 4/Task 7: 准出契约接入运行时
        buildPrompt,
      })
    }
    case 'gate':
      return makeGateNode({ gateId: node.id })
    case 'command':
      return makeCommandNode({ command: node.command!, nodeId: node.id })
    default:
      throw new Error(`未知节点类型 ${node.type}`)
  }
}

// ─── gate 条件边 path ───────────────────────────────────────────────────────────
/**
 * gate 条件边路由：reject→入边 source，approve→出边 target 或 fan-out（spec §4.J）
 *
 * - reject：回到入边的源节点（重做）
 * - approve + 目标是子图：Send fan-out 并行分发 tasks
 * - approve + 目标是普通节点：直接跳转
 */
export function gatePath(
  state: any, rejectTarget: string, approveTarget: string, approveIsSubgraph: boolean,
): string | Send[] {
  const last = state.review_decisions?.[state.review_decisions.length - 1]
  if (last?.decision === 'reject') return rejectTarget
  if (approveIsSubgraph) return (state.tasks || []).map((t: any) => new Send(approveTarget, { task: t }))
  return approveTarget
}

// ─── 入口节点识别（spec §4.2） ──────────────────────────────────────────────────
/**
 * 入口节点 = 出现在 source 但不在 target 的节点（且非条件边专属目的地）
 * LangGraph 需要 __start__ 连到所有入口节点，否则 compile 报 UNREACHABLE_NODE
 *
 * @param def 图定义
 * @param conditionalTargets 条件边专属目的地（只经条件边到达、不算入口）
 */
export function findEntryNodes(def: GraphDef, conditionalTargets?: Set<string>): string[] {
  const targets = new Set(def.edges.map(e => e.target))
  const sources = new Set(def.edges.map(e => e.source))
  const ex = conditionalTargets ?? new Set<string>()
  const entries = [...sources].filter(s => !targets.has(s) && !ex.has(s))
  // 无边的孤立节点也算入口（如单节点图）
  for (const n of def.nodes) {
    if (!sources.has(n.id) && !targets.has(n.id) && !ex.has(n.id)) entries.push(n.id)
  }
  return entries
}

// ─── buildTopGraph：顶层图 compile（spec §4.2） ─────────────────────────────────
/**
 * 构建顶层图
 *
 * 顶层图负责：
 * 1. 需求拆解（spec 节点：agent 生成 spec）
 * 2. 任务规划（tasks 节点：agent 拆分 task）
 * 3. 任务分发（subgraph 节点：Send fan-out 并行执行子图）
 * 4. 人审门控（gate 节点：approve/reject 决策）
 * 5. 归档（archive 节点：git push + PR）
 *
 * @param def 顶层图定义
 * @param subDef 子图定义（研发流程），缺省使用空图占位
 * @returns 编译后的 LangGraph
 */
export function buildTopGraph(def: GraphDef, subDef?: GraphDef): any {
  const g = new StateGraph(TopState)
  const sd = subDef ?? defaultSubGraph

  // 添加节点
  for (const n of def.nodes) {
    if (n.type === 'subgraph') {
      g.addNode(n.id, buildSubGraph(sd))
    } else {
      g.addNode(n.id, nodeAction(n, false))
    }
  }

  // 普通边（跳过 gate 节点，gate 用 addConditionalEdges）
  const gateNodeIds = new Set(def.nodes.filter(n => n.type === 'gate').map(n => n.id))
  for (const e of def.edges) {
    if (gateNodeIds.has(e.source)) continue
    g.addEdge(e.source as any, e.target as any)
  }

  // gate 条件边
  const subgraphNodeIds = new Set(def.nodes.filter(n => n.type === 'subgraph').map(n => n.id))
  for (const gn of def.nodes.filter(n => n.type === 'gate')) {
    const inEdge = def.edges.find(e => e.target === gn.id)
    const outEdge = def.edges.find(e => e.source === gn.id)
    if (!inEdge || !outEdge) continue
    const rejectTarget = inEdge.source
    const approveTarget = outEdge.target
    const approveIsSubgraph = subgraphNodeIds.has(approveTarget)
    g.addConditionalEdges(
      gn.id as any,
      (state: any) => gatePath(state, rejectTarget, approveTarget, approveIsSubgraph),
    )
  }

  // __start__ 连到所有入口节点
  for (const entry of findEntryNodes(def)) g.addEdge('__start__' as any, entry as any)

  return g.compile({ checkpointer: getCheckpointerInstance() })
}

// ─── buildSubGraph：研发流程子图 compile（spec §4.5） ───────────────────────────
/**
 * 构建研发流程子图
 *
 * 子图每个 task 并行进入一份实例（通过 Send fan-out）。
 * 典型流程：develop → compile_check → testing → quality_check → security_check → archive
 * 失败时回环到 bug_fix/quality_issue_fix/security_issue_fix（最多 N 次）
 *
 * 注：V4 推荐用 buildGraphFromDef + YAML 驱动（动态条件边更灵活）。
 * 此函数保留用于 V3 兼容和简单场景。
 *
 * 注：testingPath/qualityPath/securityPath 原在 loop-paths.mts 中，暂未迁移。
 * 当前仅内联 compile_check 条件边（V3 results 通道），其他条件边需通过 YAML 驱动方式实现。
 *
 * @param def 子图定义
 * @returns 编译后的 LangGraph
 */
export function buildSubGraph(def: GraphDef): any {
  const g = new StateGraph(SubState)

  // 添加节点（V4：所有节点统一包装 loop_counter）
  for (const n of def.nodes) {
    const action = nodeAction(n, true)
    // V4 修复：所有节点统一计数，删除 FIX_LOOP_KEY
    const wrappedAction = withLoopCounter(action, n.id)
    g.addNode(n.id, wrappedAction)
  }

  const nodeIds = new Set(def.nodes.map(n => n.id))

  // 普通边（跳过条件边源节点）
  for (const e of def.edges) {
    if (CONDITIONAL_SOURCES.has(e.source)) continue
    g.addEdge(e.source as any, e.target as any)
  }

  // compile_check 内联条件边（V3 results 通道）
  // compile_result.ok === false → bug_fix，否则 → testing
  if (nodeIds.has('compile_check')) {
    g.addConditionalEdges('compile_check' as any, (s: any) => {
      const last = s.results?.filter((r: any) => r.compile_result).pop()?.compile_result
      return last?.ok === false ? 'bug_fix' : 'testing'
    })
  }

  // TODO: testingPath/qualityPath/securityPath 待 loop-paths.mts 迁移后启用
  // 当前这些节点若需条件边，请改用 buildGraphFromDef + YAML 驱动（推荐方式）
  if (nodeIds.has('testing') && !CONDITIONAL_SOURCES.has('testing')) {
    // 占位：若 testing 不作为条件源，上面的普通边循环已处理
  }

  // __start__ 连到入口节点（排除条件边专属目的地，避免误触发 fix 节点）
  for (const entry of findEntryNodes(def, CONDITIONAL_TARGETS)) {
    g.addEdge('__start__' as any, entry as any)
  }

  return g.compile({ checkpointer: getCheckpointerInstance() })
}

// ─── buildGraphFromDef：从 YAML 字符串构建可执行图（spec §6.2） ─────────────────
/**
 * 从 YAML 字符串加载并构建可执行图
 *
 * V4 主推的图构建方式：
 * 1. 解析 YAML → WorkflowDef（校验结构合法性）
 * 2. 映射为运行时 GraphDef（source/target 边）
 * 3. 构建 StateGraph，节点通过 nodeAction 工厂创建
 * 4. 动态条件边通过 collectRoutes + routeFromSource 实现
 * 5. gate 节点通过 gatePath 实现 approve/reject 路由
 *
 * @param yamlContent YAML 字符串（符合 WorkflowDef 格式）
 * @returns 编译后的 LangGraph
 */
export function buildGraphFromDef(yamlContent: string): any {
  // 1. 解析 YAML（含结构校验）
  const def = loadWorkflowFromYaml(yamlContent)
  const graph = mapYamlToGraphDef(def)

  // 1.5. 校验 inputs 引用（Task 5）
  const nodeIds = new Set(graph.nodes.map(n => n.id))
  for (const node of graph.nodes) {
    for (const src of node.inputs ?? []) {
      if (!['task', 'input', 'spec'].includes(src) && !nodeIds.has(src)) {
        throw new WorkflowValidationError(`节点 '${node.id}' 的 inputs 引用了不存在的源 '${src}'`)
      }
    }
  }

  // 2. 构建 StateGraph
  const g = new StateGraph(TopState)

  // 3. 收集动态条件边路由（必须先于节点包装：包装器需要路由元数据来注入 reentry）
  const routes = collectRoutes(def, graph)
  const routeBySource = new Map(routes.map((r) => [r.source, r]))
  const gateNodeIds = new Set(graph.nodes.filter(n => n.type === 'gate').map(n => n.id))
  const conditionalNodeIds = new Set(routes.map(r => r.source))

  // 4. 添加节点（V4：所有节点统一包装 loop_counter；Task 7：条件边源节点同时注入 reentry）
  for (const n of graph.nodes) {
    const action = nodeAction(n, false)
    // V4 修复：所有节点统一计数，删除 FIX_LOOP_KEY
    const wrappedAction = withLoopCounter(action, n.id, routeBySource.get(n.id))
    g.addNode(n.id, wrappedAction)
  }

  // 5. 普通边（跳过 gate 和条件边源节点）
  for (const e of graph.edges) {
    if (gateNodeIds.has(e.source)) continue
    if (conditionalNodeIds.has(e.source)) continue
    g.addEdge(e.source as any, e.target as any)
  }

  // 6. gate 条件边
  const subgraphNodeIds = new Set(graph.nodes.filter(n => n.type === 'subgraph').map(n => n.id))
  for (const gn of graph.nodes.filter(n => n.type === 'gate')) {
    const inEdge = graph.edges.find(e => e.target === gn.id)
    const outEdge = graph.edges.find(e => e.source === gn.id)
    if (!inEdge || !outEdge) continue
    const rejectTarget = inEdge.source
    const approveTarget = outEdge.target
    const approveIsSubgraph = subgraphNodeIds.has(approveTarget)
    g.addConditionalEdges(
      gn.id as any,
      (state: any) => gatePath(state, rejectTarget, approveTarget, approveIsSubgraph),
    )
  }

  // 7. 动态条件边（YAML 中 from 相同的多条边）
  // Task 7 修复：path 函数只返回目标节点名（字符串）。
  // 回环重入的 reentry 标记由步骤 4 的 withLoopCounter 包装器注入 ——
  // langgraph 0.2.x 会静默忽略条件边 path 函数返回的 Command（goto/update 都不生效），
  // 若在这里返回 Command，回环边永远走不通（4d2d1401 空转的物理成因之一）。
  for (const route of routes) {
    if (route.edges.length === 0) continue
    // 单条无条件边 → 优化为普通边
    if (route.edges.length === 1 && !route.edges[0].condition && !route.edges[0].loop_back) {
      g.addEdge(route.source as any, route.edges[0].target as any)
      continue
    }
    g.addConditionalEdges(
      route.source as any,
      ((state: any) => routeFromSource(state, route)) as any,
    )
  }

  // 8. 计算条件边专属目的地（loop_back 边的 target），入口节点须排除
  const conditionalTargets = new Set<string>()
  for (const route of routes) {
    for (const e of route.edges) {
      if (e.loop_back) conditionalTargets.add(e.target)
    }
  }

  // 9. __start__ 连到入口节点
  const entries = findEntryNodes(graph, conditionalTargets)
  for (const entry of entries) {
    g.addEdge('__start__' as any, entry as any)
  }

  return g.compile({ checkpointer: getCheckpointerInstance() })
}
