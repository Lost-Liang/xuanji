// core/server/src/graph/yaml-loader.mts —— YAML 加载器（spec §3）
// TODO: Task 7 迁移 — js-yaml → yaml（V4 已安装 yaml 包，API 兼容）
import { parse as yamlParse } from 'yaml'
import * as fs from 'fs/promises'
import * as path from 'path'
import type {
  WorkflowDef,
  WorkflowNode,
  WorkflowEdge,
  GraphDef,
  GraphNode,
  GraphEdge
} from './types.mjs'

/**
 * 验证工作流定义的结构合法性（spec §3.2/§3.3）
 * @param parsed 解析后的工作流定义
 * @throws Error 如果验证失败
 */
export function assertWorkflowValid(parsed: any): asserts parsed is WorkflowDef {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('工作流定义必须是非空对象')
  }

  // 必需字段检查
  if (typeof parsed.version !== 'string') {
    throw new Error('version 必须是字符串')
  }
  if (typeof parsed.id !== 'string') {
    throw new Error('id 必须是字符串')
  }
  if (typeof parsed.name !== 'string') {
    throw new Error('name 必须是字符串')
  }
  if (!Array.isArray(parsed.nodes)) {
    throw new Error('nodes 必须是数组')
  }
  if (!Array.isArray(parsed.edges)) {
    throw new Error('edges 必须是数组')
  }
  if (!Array.isArray(parsed.start)) {
    throw new Error('start 必须是数组')
  }

  const nodeIds = new Set<string>()
  const sinkNodes = new Set<string>()

  // 验证节点
  for (const node of parsed.nodes) {
    if (!node || typeof node !== 'object') {
      throw new Error('节点必须是非空对象')
    }
    if (typeof node.id !== 'string' || !node.id) {
      throw new Error('节点必须有有效的 id')
    }

    // 规则：__end__ 是保留字，不能用作节点 id
    if (node.id === '__end__') {
      throw new Error(`'__end__' 是保留字，不能用作节点 id`)
    }

    if (nodeIds.has(node.id)) {
      throw new Error(`节点 id 重复: ${node.id}`)
    }
    nodeIds.add(node.id)

    if (typeof node.type !== 'string') {
      throw new Error(`节点 ${node.id} 必须有 type 字段`)
    }
  }

  // 验证 start 节点引用
  for (const startId of parsed.start) {
    if (!nodeIds.has(startId)) {
      throw new Error(`start 引用了不存在的节点: ${startId}`)
    }
  }

  // 验证 end 节点引用（如果存在）
  if (parsed.end && Array.isArray(parsed.end)) {
    for (const endId of parsed.end) {
      if (!nodeIds.has(endId)) {
        throw new Error(`end 引用了不存在的节点: ${endId}`)
      }
      sinkNodes.add(endId)
    }
  }

  // 统计每个节点的入边和出边
  const incomingEdges = new Map<string, number>()
  const outgoingEdges = new Map<string, WorkflowEdge[]>()
  const loopMaxEdges = new Map<string, number>()

  for (const node of parsed.nodes) {
    incomingEdges.set(node.id, 0)
    outgoingEdges.set(node.id, [])
  }

  // 验证边
  const sourceEdgeGroups = new Map<string, WorkflowEdge[]>()

  for (const edge of parsed.edges) {
    if (!edge || typeof edge !== 'object') {
      throw new Error('边必须是非空对象')
    }
    if (typeof edge.from !== 'string' || !edge.from) {
      throw new Error('边必须有有效的 from 字段')
    }
    if (typeof edge.to !== 'string' || !edge.to) {
      throw new Error('边必须有有效的 to 字段')
    }

    // 规则：边的端点必须引用已存在的节点（__end__ 除外）
    if (!nodeIds.has(edge.from)) {
      throw new Error(`边的 from 引用了不存在的节点: ${edge.from}`)
    }
    if (edge.to !== '__end__' && !nodeIds.has(edge.to)) {
      throw new Error(`边的 to 引用了不存在的节点: ${edge.to}`)
    }

    // 统计入边和出边
    if (edge.to !== '__end__') {
      incomingEdges.set(edge.to, (incomingEdges.get(edge.to) || 0) + 1)
    }
    const outEdges = outgoingEdges.get(edge.from) || []
    outEdges.push(edge)
    outgoingEdges.set(edge.from, outEdges)

    // 按源节点分组边
    const group = sourceEdgeGroups.get(edge.from) || []
    group.push(edge)
    sourceEdgeGroups.set(edge.from, group)

    // 规则：每个源节点最多有一条 loop_max 边
    if (edge.loop_max !== undefined) {
      const current = loopMaxEdges.get(edge.from) || 0
      if (current > 0) {
        throw new Error(`节点 ${edge.from} 有多条 loop_max 边`)
      }
      loopMaxEdges.set(edge.from, 1)
    }
  }

  // 规则：gate 节点最多有一条入边
  for (const node of parsed.nodes) {
    if (node.type === 'gate') {
      const incoming = incomingEdges.get(node.id) || 0
      if (incoming > 1) {
        throw new Error(`gate 节点 ${node.id} 有 ${incoming} 条入边，最多允许 1 条`)
      }
    }
  }

  // 规则：无条件边必须是同源边中的最后一条
  for (const [source, edges] of sourceEdgeGroups) {
    let foundUnconditional = false
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]
      if (!edge.condition) {
        foundUnconditional = true
      } else if (foundUnconditional) {
        throw new Error(
          `节点 ${source} 的无条件边必须是有条件边之后（边的顺序错误）`
        )
      }
    }
  }

  // 规则：end 节点必须是汇点（无出边）
  for (const endId of sinkNodes) {
    const outEdges = outgoingEdges.get(endId) || []
    if (outEdges.length > 0) {
      throw new Error(`end 节点 ${endId} 不是汇点（有 ${outEdges.length} 条出边）`)
    }
  }
}

/**
 * 从 YAML 字符串加载工作流定义
 * @param yamlContent YAML 内容字符串
 * @returns 工作流定义
 */
export function loadWorkflowFromYaml(yamlContent: string): WorkflowDef {
  // TODO: Task 7 迁移 — js-yaml load() → yaml parse()
  const parsed = yamlParse(yamlContent)
  assertWorkflowValid(parsed)
  return parsed
}

/**
 * 将 WorkflowDef 映射为运行时 GraphDef
 * @param def 工作流定义
 * @returns 图定义
 */
export function mapYamlToGraphDef(def: WorkflowDef): GraphDef {
  // 映射节点：合并 agent_binding_id 到 agent_binding_ids
  const nodes: GraphNode[] = def.nodes.map((wn: WorkflowNode): GraphNode => {
    const gn: GraphNode = {
      id: wn.id,
      type: wn.type,
      name: wn.name               // 映射 name 字段
    }

    // 复制可选字段
    if (wn.config) gn.config = wn.config
    if (wn.command) gn.command = wn.command
    if (wn.subgraph_id) gn.subgraph_id = wn.subgraph_id
    if (wn.write_key) gn.write_key = wn.write_key
    if (wn.exit_condition) gn.exit_condition = wn.exit_condition
    if (wn.condition_config) gn.condition_config = wn.condition_config
    if (wn.loop_counter_key) gn.loop_counter_key = wn.loop_counter_key
    if (wn.python_config) gn.python_config = wn.python_config
    if (wn.selector) gn.selector = wn.selector
    if (wn.context) gn.context = wn.context  // 保留 context 字段（类型安全）

    // 合并 agent_binding_id 到 agent_binding_ids
    if (wn.agent_binding_id || wn.agent_binding_ids) {
      const bindingIds: string[] = []
      if (wn.agent_binding_id) {
        bindingIds.push(wn.agent_binding_id)
      }
      if (wn.agent_binding_ids) {
        bindingIds.push(...wn.agent_binding_ids)
      }
      gn.agent_binding_ids = bindingIds
    }

    return gn
  })

  // 映射边：from→source, to→target，保留 loop_max / condition / is_default
  const edges: GraphEdge[] = def.edges
    .map((we: WorkflowEdge, index: number): GraphEdge => {
      const ge: GraphEdge = {
        id: `edge-${index}`,
        source: we.from,
        target: we.to,
      }
      if (we.loop_max !== undefined) ge.loop_max = we.loop_max
      if (we.condition) ge.condition = we.condition
      return ge
    })

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    plugin_id: def.id, // 暂时使用 workflow id 作为 plugin_id
    nodes,
    edges,
    loops: [],
    subgraphs: [],
    version: 1
  }
}

/**
 * 从文件加载工作流定义
 * @param filePath 文件路径
 * @returns 工作流定义
 */
export async function loadWorkflowFromFile(filePath: string): Promise<WorkflowDef> {
  const content = await fs.readFile(filePath, 'utf-8')
  return loadWorkflowFromYaml(content)
}

/**
 * 从目录加载所有工作流定义
 * @param dirPath 目录路径
 * @returns 工作流定义映射（文件名 → 定义）
 */
export async function loadWorkflowsFromDir(
  dirPath: string
): Promise<Map<string, WorkflowDef>> {
  const workflows = new Map<string, WorkflowDef>()
  const files = await fs.readdir(dirPath)

  for (const file of files) {
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      const filePath = path.join(dirPath, file)
      try {
        const workflow = await loadWorkflowFromFile(filePath)
        workflows.set(file, workflow)
      } catch (error) {
        console.error(`加载工作流文件 ${file} 失败:`, error)
        throw error
      }
    }
  }

  return workflows
}