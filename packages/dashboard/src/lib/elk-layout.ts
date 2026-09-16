// packages/dashboard/src/lib/elk-layout.ts
// ELK (Eclipse Layout Kernel) 正交布局引擎

import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@vue-flow/core'

const elk = new ELK()

// ELK 配置（所有值必须是字符串）
// 使用 INTERACTIVE 分层策略 + 手动 elk.layer 约束，避免 ELK 断环方向不确定导致交叉
const DEFAULT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  // 分层：由调用方通过 elk.layer 指定，ELK 不再自行断环分层
  'elk.layered.layering.strategy': 'INTERACTIVE',
  // 交叉最小化：尊重输入顺序（已按层排序）
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  // 节点放置：BRANDES_KOEPF 适合正交路由，减少弯折
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
}

const NODE_W = 180
const NODE_H = 64

export interface ElkNodeResult {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface ElkEdgeSection {
  startPoint: { x: number; y: number }
  endPoint: { x: number; y: number }
  bendPoints?: Array<{ x: number; y: number }>
}

export interface ElkEdgeResult {
  id: string
  sections: ElkEdgeSection[]
}

export interface ElkLayoutResult {
  nodes: ElkNodeResult[]
  edges: ElkEdgeResult[]
}

/**
 * 计算节点分层：DFS 断环 + 最长路径
 *
 * 1. DFS 找出所有回边（指向当前 DFS 栈中节点的边）
 * 2. 去掉回边后，用 Bellman-Ford 式迭代求最长路径作为层号
 * 3. 层号保证：对于每条前向边 u→v，layer(u) < layer(v)
 */
function computeNodeLayers(
  nodeIds: string[],
  edges: { source: string; target: string }[]
): Map<string, number> {
  // 构建邻接表
  const adj = new Map<string, string[]>()
  for (const id of nodeIds) adj.set(id, [])
  for (const e of edges) {
    if (e.target === '__end__') continue
    adj.get(e.source)?.push(e.target)
  }

  // DFS 找回边
  const backEdgeKeys = new Set<string>()
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(u: string) {
    visited.add(u)
    inStack.add(u)
    for (const v of adj.get(u) || []) {
      if (inStack.has(v)) {
        // 回边：v 在当前 DFS 路径上
        backEdgeKeys.add(`${u}->${v}`)
      } else if (!visited.has(v)) {
        dfs(v)
      }
    }
    inStack.delete(u)
  }

  // 按输入顺序启动 DFS（输入顺序通常反映主流程方向）
  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id)
  }

  // 最长路径（忽略回边）
  const layers = new Map<string, number>()
  for (const id of nodeIds) layers.set(id, 0)

  for (let i = 0; i < nodeIds.length; i++) {
    let changed = false
    for (const e of edges) {
      if (e.target === '__end__') continue
      if (backEdgeKeys.has(`${e.source}->${e.target}`)) continue
      const srcLayer = layers.get(e.source) ?? 0
      const tgtLayer = layers.get(e.target) ?? 0
      if (srcLayer + 1 > tgtLayer) {
        layers.set(e.target, srcLayer + 1)
        changed = true
      }
    }
    if (!changed) break
  }

  return layers
}

/**
 * 使用 ELK 对节点和边进行正交布局
 * @returns 节点位置和边的路由点（含 bendPoints）
 */
export async function layoutWithElk(
  nodes: Node[],
  edges: Edge[]
): Promise<ElkLayoutResult> {
  const nodeIds = nodes.map(n => n.id)
  const edgeList = edges.map(e => ({ source: e.source, target: e.target }))
  const layers = computeNodeLayers(nodeIds, edgeList)

  // 按层排序节点（同层内保持输入顺序）
  // 这样 forceNodeModelOrder 能让交叉最小化尊重主流程顺序
  const sortedNodes = [...nodes].sort((a, b) => {
    const la = layers.get(a.id) ?? 0
    const lb = layers.get(b.id) ?? 0
    return la - lb
  })

  const graph = {
    id: 'root',
    layoutOptions: DEFAULT_OPTIONS,
    children: sortedNodes.map(n => ({
      id: n.id,
      width: NODE_W,
      height: NODE_H,
      // INTERACTIVE 分层策略会读取 elk.layer 约束
      layoutOptions: {
        'elk.layer': String(layers.get(n.id) ?? 0),
      },
    })),
    edges: edges
      .filter(e => e.target !== '__end__')
      .map(e => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
  }

  const layouted = await elk.layout(graph)

  const resultNodes: ElkNodeResult[] = (layouted.children || []).map(c => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? NODE_W,
    height: c.height ?? NODE_H,
  }))

  const resultEdges: ElkEdgeResult[] = ((layouted.edges || []) as any[]).map((e: any) => ({
    id: e.id,
    sections: (e.sections || []).map((s: any) => ({
      startPoint: s.startPoint,
      endPoint: s.endPoint,
      bendPoints: s.bendPoints,
    })),
  }))

  return { nodes: resultNodes, edges: resultEdges }
}
