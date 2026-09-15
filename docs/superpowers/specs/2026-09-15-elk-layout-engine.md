# 璇玑 V4 画布布局引擎升级：ELK

> **日期**：2026-09-15
> **状态**：设计中
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
| 循环图支持 | ✅ 层分配算法 | ❌ 需 acyclicer hack |
| 正交路由 | ✅ 内置 |  仅直线/贝塞尔 |
| 交叉最小化 | ✅ 多层优化 | ️ 基础 |
| 端口系统 | ✅ 上/下/左/右 |  固定 |
| 复合节点 | ✅ 支持子图 | ⚠️ 有限 |

**npm 包**：`elkjs` (https://github.com/kieler/elkjs)

### 3.2 架构

```
┌─────────────────────────────────────────────────┐
│                  Canvas.vue                      │
│  ┌───────────┐    ┌──────────────┐              │
│  │ YAML 位置  │───→│ 有位置？      │              │
│  └───────────┘    │  是→直接用    │              │
│                    │  否→ELK布局   │              │
│                    └──────┬───────┘              │
│                           ↓                      │
│                    ┌──────────────┐              │
│                    │  elk-layout  │              │
│                    │  .ts         │              │
│                    └──────┬───────┘              │
│                           ↓                      │
│                    ┌──────────────┐              │
│                    │  Vue Flow    │              │
│                    │  渲染        │              │
│                    └──────────────┘              │
└─────────────────────────────────────────────────┘
```

### 3.3 核心模块

#### 3.3.1 `elk-layout.ts`（新增）

```typescript
// packages/dashboard/src/lib/elk-layout.ts

import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.layered.mergeEdges': true,
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.direction': 'RIGHT',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.spacing.nodeNode': 40,
  'elk.spacing.edgeNode': 20,
  'elk.layered.spacing.nodeNodeBetweenLayers': 80,
}

export interface ElkLayoutResult {
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>
  edges: Array<{
    id: string
    sections: Array<{
      startPoint: { x: number; y: number }
      endPoint: { x: number; y: number }
      bendPoints?: Array<{ x: number; y: number }>
    }>
  }>
}

export async function layoutWithElk(
  nodes: Node[],
  edges: Edge[]
): Promise<ElkLayoutResult> {
  const graph = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: nodes.map(n => ({
      id: n.id,
      width: 180,
      height: 64,
    })),
    edges: edges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  const layouted = await elk.layout(graph)
  return extractPositions(layouted)
}
```

#### 3.3.2 `graph-serialize.ts`（修改）

```typescript
// 修改 toVueFlow 函数
// ELK 返回的 bendPoints 转为 Vue Flow 的 path

export function toVueFlow(def: GraphDef): { nodes: Node[]; edges: Edge[] } {
  // ... 现有逻辑 ...
  
  return {
    nodes: def.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position || { x: 0, y: 0 },  // 保留手动位置
      data: { ...n }
    })),
    edges: def.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',  // 正交边
      markerEnd: 'arrowclosed',
      data: {
        condition: e.condition,
        loop_max: e.loop_max,
      },
    })),
  }
}
```

#### 3.3.3 `Canvas.vue`（修改）

```typescript
// 修改 loadSelectedGraph 函数
async function loadSelectedGraph() {
  // ...
  const hasPositions = vf.nodes.some(n => n.position.x !== 0 || n.position.y !== 0)
  
  if (hasPositions) {
    nodes.value = vf.nodes  // 使用手动位置
  } else {
    // 使用 ELK 自动布局
    const layouted = await layoutWithElk(vf.nodes, vf.edges)
    nodes.value = applyElkLayout(vf.nodes, layouted)
    edges.value = applyElkEdges(vf.edges, layouted)
  }
}
```

### 3.4 边渲染

ELK 的正交路由返回 bendPoints，Vue Flow 的 `smoothstep` 类型自动处理直角弯：

```
┌────────
│  Node A │
└───┬────┘
    │
    ├──────────────┐
    │              │
    │    ┌───────────┐
    │    │  Node B    │
    │    ────────────┘
    │
    ──────────────┐
                   │
         ┌─────────┴──┐
         │  Node C     │
         ─────────────┘
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
- 处理 ELK 返回结果

### Task 3: 修改 graph-serialize.ts

- `toVueFlow` 保留 position 字段
- 边类型改为 `smoothstep`（正交）

### Task 4: 修改 Canvas.vue

- `loadSelectedGraph` 集成 ELK
- 有手动位置时跳过 ELK

### Task 5: 验证与调参

- 用 ruoyi-dev-flow-v2 测试
- 调整间距参数
- 确保 < 100ms

### Task 6: 清理 dagre

- 删除 `dagre-layout.ts`
- 移除 `@dagrejs/dagre` 依赖

---

## 五、验收标准

1. **布局质量**：ruoyi-dev-flow-v2 的 10 节点无交叉
2. **正交路由**：所有边使用直角弯
3. **循环可见**：回环边清晰，不穿过节点
4. **性能**：布局计算 < 100ms
5. **手动覆盖**：YAML position 仍可用

---

## 六、风险与缓解

| 风险 | 缓解 |
|------|------|
| elkjs 包体积大 (~500KB) | 按需加载，不影响首屏 |
| ELK 异步布局 | 显示 loading 状态 |
| 正交边渲染复杂 | Vue Flow smoothstep 内置支持 |

---

## 七、参考

- ELK 文档：https://eclipse.dev/elk/
- elkjs GitHub：https://github.com/kieler/elkjs
- ELK 配置选项：https://eclipse.dev/elk/reference/options.html
