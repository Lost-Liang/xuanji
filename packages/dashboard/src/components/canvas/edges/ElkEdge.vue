<template>
  <BaseEdge :path="edgePath" :marker-end="markerEnd" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

/**
 * 使用 ELK 返回的 bendPoints 构建正交 SVG 路径
 *
 * 拖拽跟随策略：
 * - 起点 = Vue Flow 响应式 sourceX/sourceY（随源节点拖拽实时更新）
 * - 终点 = Vue Flow 响应式 targetX/targetY（随目标节点拖拽实时更新）
 * - 中间拐点 = ELK 原始坐标 + 按位置插值的偏移量
 *   （靠近源点的拐点跟随源节点，靠近终点的拐点跟随目标节点）
 */
const edgePath = computed(() => {
  const sections = props.data?.sections as Array<{
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
    bendPoints?: Array<{ x: number; y: number }>
  }> | undefined

  if (!sections || sections.length === 0) {
    // Fallback: 直线（使用响应式坐标）
    return `M ${props.sourceX} ${props.sourceY} L ${props.targetX} ${props.targetY}`
  }

  // 收集所有路径点（去重：相邻 section 的 endPoint == 下一 section 的 startPoint）
  const allPoints: { x: number; y: number }[] = []
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]
    if (si === 0) allPoints.push({ ...section.startPoint })
    if (section.bendPoints) {
      for (const bp of section.bendPoints) {
        allPoints.push({ ...bp })
      }
    }
    allPoints.push({ ...section.endPoint })
  }

  if (allPoints.length === 0) {
    return `M ${props.sourceX} ${props.sourceY} L ${props.targetX} ${props.targetY}`
  }

  // 计算源/目标节点的偏移量（当前响应式位置 - ELK 布局时的原始位置）
  const sDx = props.sourceX - allPoints[0].x
  const sDy = props.sourceY - allPoints[0].y
  const lastIdx = allPoints.length - 1
  const tDx = props.targetX - allPoints[lastIdx].x
  const tDy = props.targetY - allPoints[lastIdx].y

  // 构建路径：
  // - 起点：直接用 sourceX/Y（保证连线始终从源节点边框出发）
  // - 终点：直接用 targetX/Y（保证连线始终到达目标节点边框）
  // - 中间点：按位置线性插值偏移（t = i / total）
  const parts: string[] = []
  const total = allPoints.length - 1
  for (let i = 0; i < allPoints.length; i++) {
    let x: number, y: number
    if (i === 0) {
      x = props.sourceX
      y = props.sourceY
    } else if (i === lastIdx) {
      x = props.targetX
      y = props.targetY
    } else {
      // 线性插值：靠近源点（t≈0）跟随源节点，靠近终点（t≈1）跟随目标节点
      const t = total > 0 ? i / total : 0
      const dx = sDx * (1 - t) + tDx * t
      const dy = sDy * (1 - t) + tDy * t
      x = allPoints[i].x + dx
      y = allPoints[i].y + dy
    }
    parts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)
  }

  return parts.join(' ')
})

const markerEnd = computed(() => props.markerEnd || 'arrowclosed')
</script>

<style scoped>
.elk-edge {
  stroke: #64748b;
  stroke-width: 1.5;
  fill: none;
}

.elk-edge.loop-edge {
  stroke: #94a3b8;
  stroke-dasharray: 4 2;
}
</style>
