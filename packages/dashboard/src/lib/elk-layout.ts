// packages/dashboard/src/lib/elk-layout.ts
// ELK (Eclipse Layout Kernel) 正交布局引擎

import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@vue-flow/core'

const elk = new ELK()

// ELK 配置（所有值必须是字符串）
const DEFAULT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.layering.strategy': 'LONGEST_PATH',
  'elk.layered.mergeEdges': 'true',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.portConstraints': 'FIXED_ORDER',
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
 * 使用 ELK 对节点和边进行正交布局
 * @returns 节点位置和边的路由点（含 bendPoints）
 */
export async function layoutWithElk(
  nodes: Node[],
  edges: Edge[]
): Promise<ElkLayoutResult> {
  const graph = {
    id: 'root',
    layoutOptions: DEFAULT_OPTIONS,
    children: nodes.map(n => ({
      id: n.id,
      width: NODE_W,
      height: NODE_H,
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
