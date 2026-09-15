# 璇玑 V4 画布布局引擎升级：ELK

> **日期**：2026-09-15
> **状态**：审核通过
> **前置**：研发工作流优化（ruoyi-dev-flow-v2）

---

## 一、背景与问题

### 1.1 当前问题

璇玑 V4 画布使用 **dagre** 作为自动布局引擎，但 dagre 是为 **DAG（有向无环图）** 设计的。研发工作流 V2 包含 5 条回环边（compile_check→develop、test→develop 等），导致：

| 问题 | 表现 |
|------|------|
| 边交叉严重 | 回环边穿过主流程节点 |
| 布局混乱 | 节点位置不规律，难以阅读 |
| 连接点不合理 | 左右连接导致水平布局过宽 |
| 调参无效 | 无论怎么调整 dagre 参数都无法解决根本问题 |

### 1.2 根本原因

**dagre 的 Sugiyama 分层算法假设图是无环的**。遇到循环边时，acyclicer 会反转部分边来打破循环，但恢复后的边路由质量很差。

---

## 二、设计目标

1. **正交路由**：边使用直角弯（90°），不穿过节点
2. **循环处理**：正确布局有环图，回环边清晰可见
3. **交叉最小化**：自动减少边与边、边与节点的交叉
4. **手动覆盖**：YAML 中仍可定义 position 手动布局
5. **性能可接受**：10 节点图布局 < 100ms

---

## 三、技术方案

### 3.1 选型：ELK (Eclipse Layout Kernel)

**ELK** 是 Eclipse 基金会的专业图布局引擎，被用于 BPMN、UML 等工业级工具。

| 特性 | ELK | dagre |
|------|-----|-------|
| 循环图支持 | ✅ 层分配算法 |  需 acyclicer hack |
| 正交路由 | ✅ 内置 | ⚠️ 仅直线/贝塞尔 |
| 交叉最小化 | ✅ 多层优化 | ⚠️ 基础 |
| 端口系统 | ✅ 上/下/左/右 | ⚠️ 固定 |
| 复合节点 | ✅ 支持子图 | ⚠️ 有限 |

**npm 包**：`elkjs` (https://github.com/kieler/elkjs)
**包体积**：~500KB（bundled），按需加载不影响首屏

### 3.2 架构

```
┌─────────────────────────────────────────────────────────┐
│                      Canvas.vue                          │
│                                                          │
│  ┌───────────┐     ┌──────────────────┐                │
│  │ YAML 位置  │────→│ 有位置？           │                │
│  └───────────┘     │  是 → 直接用       │                │
│                    │  否 → ELK 布局     │                │
│                    └────────┬─────────┘                │
│                             ↓                          │
│                    ┌──────────────────┐                │
│                    │   elk-layout.ts  │                │
│                    │  (async)         │                │
│                    ────────┬─────────┘                │
│                             ↓                          │
│              ┌──────────────────────────┐              │
│              │  Vue Flow 渲染            │              │
│              │  (自定义 ElkEdge 组件)    │              │
│              └──────────────────────────┘              │
│                                                          │
│  模式控制：                                               │
│  - static 模式：切换工作流时运行布局                       │
│  - runtime 模式：不重新布局，只更新染色/动画               │
└─────────────────────────────────────────────────────────┘
```

### 3.3 核心模块

#### 3.3.1 `elk-layout.ts`（新增）

```typescript
// packages/dashboard/src/lib/elk-layout.ts

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
  'elk.layered.mergeEdges': 'true',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '20',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
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
 * @returns 节点位置和边的路由点
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
    edges: edges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  const layouted = await elk.layout(graph)

  // 提取节点位置
  const resultNodes: ElkNodeResult[] = (layouted.children || []).map(c => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? NODE_W,
    height: c.height ?? NODE_H,
  }))

  // 提取边路由（含 bendPoints）
  const resultEdges: ElkEdgeResult[] = (layouted.edges || []).map(e => ({
    id: e.id,
    sections: (e.sections || []).map(s => ({
      startPoint: s.startPoint,
      endPoint: s.endPoint,
      bendPoints: s.bendPoints,
    })),
  }))

  return { nodes: resultNodes, edges: resultEdges }
}
```

#### 3.3.2 `elk-edge.ts`（新增 — 自定义边组件）

> **关键修正**：Vue Flow 的 `smoothstep` 类型**不会**使用 ELK 返回的 bendPoints，它自己计算路径。必须创建自定义边组件来渲染 ELK 的正交路径。

```vue
<!-- packages/dashboard/src/components/canvas/edges/ElkEdge.vue -->
<template>
  <g>
    <path
      :d="pathData"
      fill="none"
      :stroke="style.stroke || '#555'"
      :stroke-width="style.strokeWidth || 1.5"
      :class="['elk-edge', { 'loop-edge': data?.isLoopEdge }]"
    />
    <MarkerEnd />
  </g>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

const pathData = computed(() => {
  const sections = props.data?.sections as ElkEdgeSection[] | undefined
  if (!sections || sections.length === 0) {
    // fallback: 直线
    const [d] = getBezierPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
    })
    return d
  }

  // 使用 ELK 的 bendPoints 构建正交路径
  const pts: string[] = []
  for (const section of sections) {
    pts.push(`M ${section.startPoint.x} ${section.startPoint.y}`)
    if (section.bendPoints) {
      for (const bp of section.bendPoints) {
        pts.push(`L ${bp.x} ${bp.y}`)
      }
    }
    pts.push(`L ${section.endPoint.x} ${section.endPoint.y}`)
  }
  return pts.join(' ')
})
</script>
```

#### 3.3.3 `graph-serialize.ts`（修改）

```typescript
// 修改 toVueFlow 函数
// 边类型改为 elk-edge，数据携带 ELK 路由信息

export function toVueFlow(def: GraphDef): { nodes: Node[]; edges: Edge[] } {
  // ... 循环检测逻辑保持不变 ...

  return {
    nodes: def.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position || { x: 0, y: 0 },
      data: { ...n }
    })),
    edges: def.edges.map(e => {
      const isReverse = reverseEdgeIds.has(e.id)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'elk-edge',          // ← 自定义边类型
        markerEnd: 'arrowclosed',
        data: {
          condition: e.condition,
          loop_max: e.loop_max,
          isLoopEdge: isReverse,
          sections: [],             // ← ELK 布局后填充
        },
      }
    }),
  }
}
```

#### 3.3.4 `Canvas.vue`（修改）

```typescript
import { layoutWithElk } from '../lib/elk-layout'
import ElkEdge from '../components/canvas/edges/ElkEdge.vue'

// 注册自定义边类型
const edgeTypes = { 'elk-edge': ElkEdge }

const layouting = ref(false)

async function loadSelectedGraph() {
  if (!selectedGraphId.value) return
  const def = await api.get(selectedGraphId.value)
  if (!def?.definition_json) return

  const vf = toVueFlow(def.definition_json)

  // 填充节点 label（现有逻辑）
  const labelMap = await agentApi.getLabelMap()
  for (const n of vf.nodes) {
    if (!n.data.label) {
      const bindingId = n.data.agent_binding_ids?.[0]
      if (bindingId && labelMap.has(bindingId)) {
        n.data.label = labelMap.get(bindingId)
      }
    }
  }

  // 判断是否使用手动位置
  const hasPositions = vf.nodes.some(n => n.position.x !== 0 || n.position.y !== 0)

  if (hasPositions) {
    nodes.value = vf.nodes
    edges.value = vf.edges
  } else {
    // ELK 自动布局（仅 static 模式）
    if (mode.value !== 'static') {
      nodes.value = vf.nodes
      edges.value = vf.edges
      return
    }

    layouting.value = true
    try {
      const layouted = await layoutWithElk(vf.nodes, vf.edges)

      // 应用节点位置
      const posMap = new Map(layouted.nodes.map(n => [n.id, n]))
      nodes.value = vf.nodes.map(n => {
        const pos = posMap.get(n.id)
        return pos
          ? { ...n, position: { x: pos.x, y: pos.y } }
          : n
      })

      // 应用边路由
      const edgeMap = new Map(layouted.edges.map(e => [e.id, e]))
      edges.value = vf.edges.map(e => {
        const layoutedEdge = edgeMap.get(e.id)
        return layoutedEdge
          ? { ...e, data: { ...e.data, sections: layoutedEdge.sections } }
          : e
      })
    } catch (err) {
      console.warn('[canvas] ELK 布局失败，回退到 dagre:', err)
      // dagre 回退
      nodes.value = layoutDagre(vf.nodes, vf.edges)
      edges.value = vf.edges
    } finally {
      layouting.value = false
    }
  }

  setTimeout(() => fitView({ padding: 0.08, minZoom: 0.4 }), 60)
}
```

### 3.4 正交路由效果

```
┌──────────┐
│  Node A   │
└────┬─────┘
     │
     │  (ELK bendPoints)
     ├──────────────┐
     │              │
     │    ┌─────────┴──┐
     │    │  Node B     │
     │    └─────────────┘
     │
     └──────────────┐
                    │
          ┌─────────┴──┐
          │  Node C     │
          └─────────────┘
```

---

## 四、实施步骤

### Task 1: 安装 elkjs

```bash
cd packages/dashboard
pnpm add elkjs
```

### Task 2: 创建 elk-layout.ts

- 实现 `layoutWithElk()` 函数
- 配置 layered 算法 + 正交路由
- 提取节点位置和边的 bendPoints
- 文件：`packages/dashboard/src/lib/elk-layout.ts`

### Task 3: 创建 ElkEdge.vue 自定义边组件

- 读取 `data.sections` 中的 bendPoints
- 渲染正交 SVG path
- fallback 到直线（无 sections 时）
- 文件：`packages/dashboard/src/components/canvas/edges/ElkEdge.vue`

### Task 4: 修改 graph-serialize.ts

- `toVueFlow` 边类型改为 `elk-edge`
- `data.sections` 初始化为空数组（ELK 布局后填充）

### Task 5: 修改 Canvas.vue

- 注册 `elk-edge` 边类型
- `loadSelectedGraph` 集成 ELK（static 模式）
- 添加 `layouting` loading 状态
- dagre 回退机制
- runtime 模式不重新布局

### Task 6: 验证与调参

- 用 ruoyi-dev-flow-v2 测试（10 节点，5 回环边）
- 验证无交叉、回环边清晰
- 调整间距参数
- 性能测试 < 100ms

### Task 7: 清理 dagre

- 删除 `dagre-layout.ts`
- `pnpm remove @dagrejs/dagre`
- 移除相关 import

---

## 五、验收标准

1. **布局质量**：ruoyi-dev-flow-v2 的 10 节点无交叉
2. **正交路由**：所有边使用 ELK bendPoints 渲染直角弯
3. **循环可见**：回环边清晰，不穿过节点
4. **性能**：布局计算 < 100ms
5. **手动覆盖**：YAML position 仍可用
6. **回退机制**：ELK 失败时自动回退 dagre
7. **运行时兼容**：runtime 模式不触发重新布局

---

## 六、风险与缓解

| 风险 | 缓解 |
|------|------|
| elkjs 包体积 ~500KB | 动态 import，仅 Canvas 页面加载 |
| ELK 异步布局 | `layouting` loading 遮罩 |
| ELK 布局失败 | dagre 回退 |
| bendPoints 坐标与 Vue Flow 不匹配 | ElkEdge 组件中做坐标转换 |
| 端口选择导致边绕远路 | 不配置 ports，让 ELK 自动选择 |

---

## 七、参考

- ELK 文档：https://eclipse.dev/elk/
- elkjs GitHub：https://github.com/kieler/elkjs
- ELK 配置选项：https://eclipse.dev/elk/reference/options.html
- Vue Flow 自定义边：https://vueflow.dev/guide/edges.html#custom-edges
