// Vue Flow 节点/边 ↔ GraphDef（spec §4.1）
import type { Node, Edge } from '@vue-flow/core'

// V4: 本地定义类型（移除对 V3 server 路径的引用）
export interface GraphNode {
  id: string
  type?: string
  agent_binding_ids?: string[]
  selector?: string
  command?: string
  [key: string]: any
}
export interface GraphEdge {
  id: string
  source: string
  target: string
  condition?: EdgeCondition
  loop_max?: number
}
export interface EdgeCondition {
  type: string
  value?: string
  [key: string]: any
}
export interface GraphDef {
  name: string
  plugin_id?: string
  version?: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  loops?: any[]
  subgraphs?: any[]
  [key: string]: any
}

// Vue Flow node.data 承载 GraphNode 业务字段（id/type/agent_binding_ids/selector/command/...）
export function toGraphDef(nodes: Node[], edges: Edge[], name: string, pluginId: string): GraphDef {
  return {
    name, plugin_id: pluginId, version: 1,
    nodes: nodes.map(n => ({ id: n.id, ...(n.data as Omit<GraphNode, 'id'>) })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      condition: e.data?.condition as EdgeCondition | undefined,
      loop_max: e.data?.loop_max as number | undefined,
    })),
    loops: [], subgraphs: [],
  }
}

export function toVueFlow(def: GraphDef): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: def.nodes.map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: { ...n } })),
    edges: def.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'particle',
      markerEnd: 'arrowclosed',
      data: {
        condition: e.condition,
        loop_max: e.loop_max,
      },
    })),
  }
}
