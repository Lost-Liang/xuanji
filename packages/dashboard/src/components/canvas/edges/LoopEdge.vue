<template>
  <BaseEdge :path="edgePath" :label-x="labelX" :label-y="labelY" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeProps, Position } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

// 手动计算贝塞尔曲线路径，强制控制点向上偏移
const edgePathParams = computed(() => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props

  // 控制点向上偏移 100px，确保循环边从上方绕路
  const controlOffset = -100

  // 计算控制点
  const sourceControlX = sourceX
  const sourceControlY = sourceY + controlOffset
  const targetControlX = targetX
  const targetControlY = targetY + controlOffset

  // 计算标签位置（曲线中点）
  const midX = (sourceX + targetX) / 2
  const midY = Math.min(sourceY, targetY) + controlOffset

  // 构建贝塞尔曲线路径
  const path = `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`

  return [path, midX, midY]
})

const edgePath = computed(() => edgePathParams.value[0])
const labelX = computed(() => edgePathParams.value[1])
const labelY = computed(() => edgePathParams.value[2])
</script>
