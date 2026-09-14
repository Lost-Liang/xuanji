<template>
  <BaseEdge :path="edgePath" :label-x="labelX" :label-y="labelY" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, getBezierPath, EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

// 强制循环边向上绕路，控制点 y 坐标比节点顶部高 80px
const edgePathParams = computed(() => {
  const sourceY = props.sourceY
  const targetY = props.targetY
  // 控制点向上偏移 80px
  const controlOffset = -80
  return getBezierPath({
    sourceX: props.sourceX,
    sourceY: sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: targetY,
    targetPosition: props.targetPosition,
    curvature: 0.8,
  })
})

const edgePath = computed(() => edgePathParams.value[0])
const labelX = computed(() => edgePathParams.value[1])
const labelY = computed(() => edgePathParams.value[2])
</script>
