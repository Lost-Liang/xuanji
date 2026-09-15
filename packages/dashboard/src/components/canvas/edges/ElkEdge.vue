<template>
  <BaseEdge :path="edgePath" :marker-end="markerEnd" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

/**
 * 使用 ELK 返回的 bendPoints 构建正交 SVG 路径
 * 起点/终点使用 Vue Flow 的响应式坐标（拖拽时自动更新）
 * bendPoints 做相对偏移以跟随节点移动
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

  // 计算节点偏移量（当前节点位置 - ELK 布局时的位置）
  const dx = props.sourceX - sections[0].startPoint.x
  const dy = props.sourceY - sections[0].startPoint.y

  // 使用 ELK 的 bendPoints + 偏移量构建正交路径
  const parts: string[] = []
  for (const section of sections) {
    parts.push(`M ${section.startPoint.x + dx} ${section.startPoint.y + dy}`)
    if (section.bendPoints) {
      for (const bp of section.bendPoints) {
        parts.push(`L ${bp.x + dx} ${bp.y + dy}`)
      }
    }
    parts.push(`L ${section.endPoint.x + dx} ${section.endPoint.y + dy}`)
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
