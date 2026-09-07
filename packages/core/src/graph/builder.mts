// packages/core/src/graph/builder.mts —— 画布 JSON → LangGraph StateGraph（spec §4.2）
// TODO: Task 7 迁移 — 从 V3 直接迁移，部分功能暂注释（依赖 agent-node / checkpointer / loop-paths 等未迁移模块）
// TODO: Task 9 修复 — StateGraph 在 buildTopGraph/buildSubGraph/buildGraphFromDef 恢复后启用
import { Send } from '@langchain/langgraph'
// import { StateGraph, Send } from '@langchain/langgraph'
import type { GraphDef, WorkflowDef, WorkflowEdge, EdgeCondition } from './types.mjs'
// import type { GraphNode } from './types.mjs'  // TODO: Task 9 修复 — nodeAction 恢复后启用
// TODO: Task 9 修复 — TopState/SubState 在 buildTopGraph/buildSubGraph 恢复后启用
// import { TopState, SubState } from './state-schema.mjs'
// TODO: Task 8 修复 — agent-node.mts 需改造为 AgentOS Runner 适配器
// import { makeAgentNode } from './agent-node.mjs'
// TODO: Task 9 修复 — makeGateNode/makeCommandNode 在 nodeAction 恢复后启用
// import { makeGateNode } from './nodes/gate-node.mjs'
// import { makeCommandNode } from './nodes/command-node.mjs'
// TODO: Task 10 修复 — checkpointer 需改用 V4 Prisma checkpoint 方案
// import { checkpointer } from '../checkpointer.mjs'
// TODO: Task 10 修复 — db.mts (V3 SQLite pgClient) 需改用 V4 Prisma
// import { pgClient } from '../db.mjs'
// TODO: Task 9 修复 — seed-graph.mts 需改造
// import { defaultSubGraph } from './seed-graph.mjs'
// TODO: Task 9 修复 — loop-paths.mts 需迁移
// import { testingPath, qualityPath, securityPath } from './loop-paths.mjs'
import { getCondition } from './conditions/index.mjs'
import { evaluateKeywordCondition } from './conditions/keyword-evaluator.mjs'
// TODO: Task 9 修复 — mapYamlToGraphDef 在 buildGraphFromDef 恢复后启用
// import { mapYamlToGraphDef } from './yaml-loader.mjs'
import { sourceText } from './conditions/source-text.mjs'

// TODO: Task 9 修复 — FIX_LOOP_KEY 在 buildSubGraph/buildGraphFromDef 恢复后启用
// const FIX_LOOP_KEY: Record<string, string> = {
//   bug_fix: 'testing',
//   quality_issue_fix: 'quality_check',
//   security_issue_fix: 'security_check',
// }

// TODO: Task 9 修复 — CONDITIONAL_SOURCES 在 buildSubGraph 恢复后启用
// const CONDITIONAL_SOURCES = new Set(['compile_check', 'testing', 'quality_check', 'security_check'])

// 条件边目的地（spec §4.5）：compile_check/testing/quality_check/security_check 条件边可能路由到的节点。
// 其中 bug_fix/quality_issue_fix/security_issue_fix 只经条件边到达、从不出现在普通 edge 的 target ——
// findEntryNodes 须排除，否则误判为入口、__start__ 连入导致 step 0 并行触发 fix 节点，
// 跳过 compile_check/testing/quality_check/security_check（子图 current_node_id 直接跳到 fix 节点）。
const CONDITIONAL_TARGETS = new Set([
  'bug_fix', 'testing',                         // compile_check 条件边
  'bug_fix', 'quality_check',                   // testing 条件边
  'quality_issue_fix', 'security_check',        // quality_check 条件边
  'security_issue_fix', 'final_review',         // security_check 条件边
])

// 动态条件边路由元数据（spec §6.2）
export interface RouteMeta {
  source: string
  edges: Array<{
    target: string
    condition?: EdgeCondition
    loop_back?: boolean
    is_default?: boolean
    loop_max?: number
  }>
}

// 动态条件边路由函数（spec §6.2）
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
      if (fn(state)) return e.target
    }
  }

  // 回环边
  if (loopBack) {
    const done = state.loop_counters?.[meta.source] ?? 0
    const limit = loopBack.loop_max ?? DEFAULT_MAX
    if (done < limit) {
      if (loopBack.condition) {
        if (loopBack.condition.type === 'keyword') {
          if (evaluateKeywordCondition(sourceText(state, meta.source), loopBack.condition.config)) return loopBack.target
        } else if (loopBack.condition.type === 'function') {
          const fn = getCondition(loopBack.condition.config.name!)
          if (fn(state)) return loopBack.target
        }
      } else {
        return loopBack.target
      }
    }
  }

  const d = meta.edges.find((e) => e.is_default)
  return d ? d.target : '__end__'
}

// fix 节点包装：自动递增 loop_counters（spec §4.5）
export function withLoopCounter(action: (s: any, c?: any) => any, checkId: string) {
  return async (state: any, config: any) => {
    const r = await action(state, config)
    return { ...r, loop_counters: { ...(r?.loop_counters || {}), [checkId]: (state.loop_counters?.[checkId] || 0) + 1 } }
  }
}

// 收集动态条件边路由（spec §6.2）
export function collectRoutes(def: WorkflowDef, graph: GraphDef): RouteMeta[] {
  const routes: RouteMeta[] = []
  const sourceEdges = new Map<string, WorkflowEdge[]>()

  // 按源节点分组边
  for (const edge of def.edges) {
    const group = sourceEdges.get(edge.from) || []
    group.push(edge)
    sourceEdges.set(edge.from, group)
  }

  // 为每个源节点创建RouteMeta
  for (const [source, edges] of sourceEdges) {
    const routeMeta: RouteMeta = {
      source,
      edges: edges.map((e) => {
        // 构建时验证条件函数是否存在
        if (e.condition?.type === 'function') {
          const fnName = e.condition.config.name!
          // getCondition 会在函数不存在时抛出错误
          getCondition(fnName)
        }

        return {
          target: e.to === '__end__' ? '__end__' : e.to,
          condition: e.condition,
          loop_back: e.loop_max !== undefined && e.to !== '__end__',
          is_default: !e.condition && e.loop_max === undefined,
          loop_max: e.loop_max
        }
      })
    }
    routes.push(routeMeta)
  }

  return routes
}

// TODO: Task 8 修复 — nodeAction 依赖 makeAgentNode（agent-node.mts），需改造为 AgentOS Runner 适配器
// 节点 type → action 工厂
// function nodeAction(node: GraphNode, isSubgraph = false) {
//   const interactionMode = node.interaction_mode ?? (isSubgraph ? 'autonomous' : 'interactive')
//
//   switch (node.type) {
//     case 'agent':   return makeAgentNode({
//       bindingIds: node.agent_binding_ids!, selector: node.selector,
//       writeKey: node.write_key ?? 'results', nodeId: node.id, isSubgraph,
//       isArchive: node.id === 'archive',
//       interactionMode,
//       buildPrompt: (s: any) => s.input ?? s.task?.title ?? s.task?.description ?? '',
//     })
//     case 'gate':    return makeGateNode({ gateId: node.id })
//     case 'command': return makeCommandNode({ command: node.command!, db: pgClient })
//     default: throw new Error(`未知节点类型 ${node.type}`)
//   }
// }

// gate 条件边 path：reject→入边 source，approve→出边 target 或 fan-out（spec §4.J）
export function gatePath(
  state: any, rejectTarget: string, approveTarget: string, approveIsSubgraph: boolean,
): string | Send[] {
  const last = state.review_decisions?.[state.review_decisions.length - 1]
  if (last?.decision === 'reject') return rejectTarget
  if (approveIsSubgraph) return (state.tasks || []).map((t: any) => new Send(approveTarget, { task: t }))
  return approveTarget
}

// 入口节点 = 出现在 source 但不在 target（且非条件边目的地）的节点（spec §4.2，LangGraph 需 __start__ 连入口否则 compile 报 UNREACHABLE_NODE）
// conditionalTargets：条件边专属目的地（只经条件边到达、不在普通 edge target 中），不算入口——
// 传入则排除，避免 __start__ 误连 fix 节点导致 step 0 并行误触发（spec §4.5）
export function findEntryNodes(def: GraphDef, conditionalTargets?: Set<string>): string[] {
  const targets = new Set(def.edges.map(e => e.target))
  const sources = new Set(def.edges.map(e => e.source))
  const ex = conditionalTargets ?? new Set<string>()
  const entries = [...sources].filter(s => !targets.has(s) && !ex.has(s))
  // 无边的孤立节点也算入口（如单节点图）
  for (const n of def.nodes) if (!sources.has(n.id) && !targets.has(n.id) && !ex.has(n.id)) entries.push(n.id)
  return entries
}

// TODO: Task 9 修复 — buildTopGraph 依赖 checkpointer、defaultSubGraph、nodeAction，需全部就位后恢复
// 顶层图 compile
// export function buildTopGraph(def: GraphDef, subDef?: GraphDef) {
//   const g = new StateGraph(TopState)
//   const sd = subDef ?? defaultSubGraph
//   for (const n of def.nodes) {
//     if (n.type === 'subgraph') {
//       g.addNode(n.id, buildSubGraph(sd))
//     } else {
//       g.addNode(n.id, nodeAction(n, false))
//     }
//   }
//   const gateNodeIds = new Set(def.nodes.filter(n => n.type === 'gate').map(n => n.id))
//   for (const e of def.edges) {
//     if (gateNodeIds.has(e.source)) continue
//     g.addEdge(e.source, e.target)
//   }
//   const subgraphNodeIds = new Set(def.nodes.filter(n => n.type === 'subgraph').map(n => n.id))
//   for (const gn of def.nodes.filter(n => n.type === 'gate')) {
//     const inEdge = def.edges.find(e => e.target === gn.id)
//     const outEdge = def.edges.find(e => e.source === gn.id)
//     if (!inEdge || !outEdge) continue
//     const rejectTarget = inEdge.source
//     const approveTarget = outEdge.target
//     const approveIsSubgraph = subgraphNodeIds.has(approveTarget)
//     g.addConditionalEdges(gn.id, (state: any) => gatePath(state, rejectTarget, approveTarget, approveIsSubgraph))
//   }
//   for (const entry of findEntryNodes(def)) g.addEdge('__start__', entry)
//   return g.compile({ checkpointer })
// }

// TODO: Task 9 修复 — buildSubGraph 依赖 checkpointer、loop-paths、nodeAction，需全部就位后恢复
// 研发流程子图 compile（spec §4.5，每个 task 并行进入一份）
// export function buildSubGraph(def: GraphDef) {
//   const g = new StateGraph(SubState)
//   for (const n of def.nodes) {
//     let action = nodeAction(n, true)
//     const fixKey = FIX_LOOP_KEY[n.id]
//     if (fixKey) {
//       const base = action
//       action = async (state: any, config: any) => {
//         const r = await base(state, config)
//         return { ...r, loop_counters: { ...(r?.loop_counters || {}), [fixKey]: (state.loop_counters?.[fixKey] || 0) + 1 } }
//       }
//     }
//     g.addNode(n.id, action)
//   }
//   const nodeIds = new Set(def.nodes.map(n => n.id))
//   for (const e of def.edges) {
//     if (CONDITIONAL_SOURCES.has(e.source)) continue
//     g.addEdge(e.source, e.target)
//   }
//   if (nodeIds.has('compile_check')) {
//     g.addConditionalEdges('compile_check', (s: any) => (s.results?.filter((r: any) => r.compile_result).pop()?.compile_result?.ok === false ? 'bug_fix' : 'testing'))
//   }
//   if (nodeIds.has('testing')) g.addConditionalEdges('testing', testingPath)
//   if (nodeIds.has('quality_check')) g.addConditionalEdges('quality_check', qualityPath)
//   if (nodeIds.has('security_check')) {
//     g.addConditionalEdges('security_check', securityPath)
//   }
//   for (const entry of findEntryNodes(def, CONDITIONAL_TARGETS)) g.addEdge('__start__', entry)
//   return g.compile({ checkpointer })
// }

// TODO: Task 9 修复 — buildGraphFromDef 依赖 checkpointer、defaultSubGraph、nodeAction，需全部就位后恢复
// 动态条件边构建器（spec §6.2）
// export function buildGraphFromDef(def: WorkflowDef, subDef?: WorkflowDef, subResolve?: Function): any {
//   const graph = mapYamlToGraphDef(def)
//   const isTop = subDef !== undefined || subResolve !== undefined
//   const StateClass = isTop ? TopState : SubState
//   const g = new StateGraph(StateClass)
//   for (const n of graph.nodes) {
//     if (n.type === 'subgraph' && isTop) {
//       if (subDef) {
//         g.addNode(n.id, buildSubGraph(mapYamlToGraphDef(subDef)))
//       } else if (subResolve) {
//         const sd = subResolve(n.subgraph_id)
//         g.addNode(n.id, buildSubGraph(sd))
//       } else {
//         g.addNode(n.id, buildSubGraph(defaultSubGraph))
//       }
//       continue
//     }
//     let action = nodeAction(n, !isTop)
//     const fixKey = FIX_LOOP_KEY[n.id]
//     if (fixKey) {
//       action = withLoopCounter(action, fixKey)
//     }
//     g.addNode(n.id, action)
//   }
//   const routes = collectRoutes(def, graph)
//   const gateNodeIds = new Set(graph.nodes.filter(n => n.type === 'gate').map(n => n.id))
//   const conditionalNodeIds = new Set(routes.map(r => r.source))
//   for (const e of graph.edges) {
//     if (gateNodeIds.has(e.source)) continue
//     if (conditionalNodeIds.has(e.source)) continue
//     g.addEdge(e.source, e.target)
//   }
//   const subgraphNodeIds = new Set(graph.nodes.filter(n => n.type === 'subgraph').map(n => n.id))
//   for (const gn of graph.nodes.filter(n => n.type === 'gate')) {
//     const inEdge = graph.edges.find(e => e.target === gn.id)
//     const outEdge = graph.edges.find(e => e.source === gn.id)
//     if (!inEdge || !outEdge) continue
//     const rejectTarget = inEdge.source
//     const approveTarget = outEdge.target
//     const approveIsSubgraph = subgraphNodeIds.has(approveTarget)
//     g.addConditionalEdges(gn.id, (state: any) => gatePath(state, rejectTarget, approveTarget, approveIsSubgraph))
//   }
//   for (const route of routes) {
//     if (route.edges.length === 0) continue
//     if (route.edges.length === 1 && !route.edges[0].condition) {
//       g.addEdge(route.source, route.edges[0].target)
//       continue
//     }
//     g.addConditionalEdges(route.source, (state: any) => routeFromSource(state, route))
//   }
//   const conditionalTargets = new Set<string>()
//   for (const route of routes) {
//     for (const e of route.edges) {
//       if (e.loop_back) {
//         conditionalTargets.add(e.target)
//       }
//     }
//   }
//   const entries = findEntryNodes(graph, conditionalTargets)
//   for (const entry of entries) {
//     g.addEdge('__start__', entry)
//   }
//   return g.compile({ checkpointer })
// }
