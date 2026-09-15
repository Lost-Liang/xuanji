<template>
  <BaseEdge :path="edgePath" :marker-end="markerEnd" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

/**
 * 使用 ELK 返回的 bendPoints 构建正交 SVG 路径
 * 无 bendPoints 时 fallback 到直线
 */
const edgePath = computed(() => {
  const sections = props.data?.sections as Array<{
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
    bendPoints?: Array<{ x: number; y: number }>
  }> | undefined

  if (!sections || sections.length === 0) {
    // Fallback: 直线
    return `M ${props.sourceX} ${props.sourceY} L ${props.targetX} ${props.targetY}`
  }

  // 使用 ELK 的 bendPoints 构建正交路径
  const parts: string[] = []
  for (const section of sections) {
    parts.push(`M ${section.startPoint.x} ${section.startPoint.y}`)
    if (section.bendPoints) {
      for (const bp of section.bendPoints) {
        parts.push(`L ${bp.x} ${bp.y}`)
      }
    }
    parts.push(`L ${section.endPoint.x} ${section.endPoint.y}`)
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
