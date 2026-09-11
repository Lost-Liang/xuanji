// core/server/src/graph/types.mts —— 薄图模型（框架无关，spec §4.1）
export type NodeType = 'agent' | 'gate' | 'command' | 'subgraph' | 'python'

// 辅助类型定义
export interface ToolConfig {
  name: string
  type?: 'function' | 'mcp'
  config?: Record<string, any>
}

export interface MCPServerConfig {
  name: string
  transport: 'stdio' | 'sse' | 'ws'
  command?: string      // stdio 模式
  url?: string          // sse/ws 模式
  args?: string[]
  env?: Record<string, string>
}

export interface RetryConfig {
  max_retries: number
  backoff_base_s: number
  backoff_max_s: number
}

export interface EdgeCondition {
  type: 'keyword' | 'function'
  config: {
    any?: string[]
    none?: string[]
    regex?: string[]
    case_sensitive?: boolean
    name?: string          // function 类型：注册表函数名（spec §6.2）
    source?: string        // function 类型：条件读哪个节点的产出（必填，spec §6.2 Task 3）
  }
}

export interface DynamicEdgeConfig {
  type: 'map' | 'tree'
  split_key: string
  max_parallel: number
}

export interface SelectorRule { by: 'task_type' | 'stack_type'; mapping: Record<string, string> }  // task[by] 值 → binding_id，从 agent_binding_ids 选其一（spec §4.1）

export interface GraphNode {
  id: string
  type: NodeType
  name?: string             // 节点显示名称（中文标签）

  // Agent 节点配置（对齐 Omnigent AgentSpec）
  config?: {
    name: string
    provider: string
    instructions: string
    params?: Record<string, any>
    skills?: string[]
    tools?: ToolConfig[]
    mcp_servers?: MCPServerConfig[]
    retry?: RetryConfig
  }

  // Agent 绑定引用（与 config 二选一或组合）
  agent_binding_id?: string
  agent_binding_ids?: string[]        // 多数 1 个；development 等多 binding + selector

  // 多绑定选择器
  selector?: SelectorRule

  // Gate 节点配置
  exit_condition?: string

  // Command 节点配置
  command?: string                    // command 节点的 shell

  // Python 节点配置（未来扩展）
  python_config?: {
    timeout_seconds: number
    encoding: string
  }

  // Subgraph 节点配置
  subgraph_id?: string               // subgraph 节点引用

  // 循环节点配置（仅画布层 LoopContainer 可视化）
  loop?: { exit_condition: string }

  // 输出配置
  write_key?: 'spec' | 'tasks' | 'results'   // agent 节点输出写入的 state channel，默认 'results'（spec §4.A）

  // 条件节点输出键
  condition_config?: {
    write_key: string
  }

  // 交互模式：autonomous 跳过权限确认，interactive 支持 elicitation（spec §5）
  interaction_mode?: 'interactive' | 'autonomous'

  // 循环节点计数器键
  loop_counter_key?: string

  // 控制 agent 读取的 state 通道，默认 'input'（spec §4.A）
  context?: string

  // 数据流 inputs 声明（Task 5）：prompt 组装的数据来源
  inputs?: string[]  // 内置源（task/input/spec）或上游节点 id
}
export interface GraphEdge {
  id: string
  source: string
  target: string
  condition?: EdgeCondition    // 条件边配置
  loop_max?: number            // 循环上限（用于修复循环）
}
export interface LoopContainer { id: string; childGraph: GraphDef; exitCondition: string }
export interface GraphDef {
  id?: string
  name: string
  description?: string
  plugin_id: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  loops: LoopContainer[]
  subgraphs: GraphDef[]
  version: number                    // 固定，作为执行 input 不可变
}

// YAML 作者模型（与运行时 source/target 分开，spec §1.4/§3）

// 作者节点：自带 agent_binding_id 注入、config 合并、selector 等。运行时聚合在映射阶段完成
// 准出契约（Task 4）
export interface ExitContract {
  schema?: Record<string, 'string' | 'number' | 'boolean' | 'string[]'>;
  requires?: RequireAssertion[];
}

export interface RequireAssertion {
  type: 'file_exists' | 'file_not_exists' | 'command' | 'grep';
  path?: string;
  run?: string;
  expect_exit?: number;
  timeout_seconds?: number;
  pattern?: string;
  expect?: 'present' | 'absent';
}

export interface ContractFailure {
  type: 'schema' | 'assertion';
  field?: string;
  assertion?: RequireAssertion;
  detail: string;
}

export interface WorkflowNode {
  id: string
  type: NodeType                       // 'agent' | 'gate' | 'command' | 'subgraph' | 'python'
  name?: string                        // 节点显示名称（中文标签）
  agent_binding_id?: string            // 单绑定：作者可写，映射后并入运行时 agent_binding_ids
  agent_binding_ids?: string[]
  selector?: SelectorRule
  config?: {
    name: string
    provider: string
    instructions: string
    params?: Record<string, any>
    skills?: string[]
    tools?: ToolConfig[]
    mcp_servers?: MCPServerConfig[]
    retry?: RetryConfig
  }
  command?: string
  subgraph_id?: string
  write_key?: 'spec' | 'tasks' | 'results'
  exit_condition?: string
  condition_config?: { write_key: string }
  loop_counter_key?: string
  python_config?: { timeout_seconds: number; encoding: string }   // 未来扩展占位，保留类型不实现
  context?: string                    // 控制 agent 读取的 state 通道，默认 'input'
  exit_contract?: ExitContract        // 准出契约（Task 4）
  inputs?: string[]                   // prompt 组装的数据来源（Task 5）：内置源（task/input/spec）或上游节点 id
}

// 作者边：字段用 from/to（映射前绝不读 source/target），loop_max 只落在条件回环边上
export interface WorkflowEdge {
  from: string
  to: string                          // 可为保留字 __end__（终态短路）
  condition?: EdgeCondition
  trigger?: boolean                   // 预留（见 spec §3.2）
  keep_message?: boolean              // 预留
  dynamic?: DynamicEdgeConfig         // 预留
  loop_max?: number                   // 可选，覆盖循环上限（默认 vars.MAX_ROUNDS ?? 3）
}

export interface WorkflowDef {
  version: string
  id: string
  name: string
  description?: string
  vars?: Record<string, any>
  input_schema?: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
  output_schema?: {
    type: string
    properties: Record<string, any>
  }
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  start: string[]
  end?: string[]                        // 可选：非空时 loader 校验均落节点集合且为拓扑汇点
}
