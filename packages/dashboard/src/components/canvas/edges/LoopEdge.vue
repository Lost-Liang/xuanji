<template>
  <BaseEdge :path="edgePath" :label-x="labelX" :label-y="labelY" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

// 使用 SVG Arc 路径，让循环边从上方绕路，避开中间节点
const edgePathParams = computed(() => {
  const { sourceX, sourceY, targetX, targetY } = props

  const dx = Math.abs(targetX - sourceX)
  const dy = Math.abs(targetY - sourceY)

  // 椭圆弧半径：rx 控制水平宽度，ry 控制垂直高度（+120 让弧更高，绕过节点）
  const radiusX = dx * 0.55
  const radiusY = dy * 0.7 + 120

  // 弧的中点 x 坐标
  const midX = (sourceX + targetX) / 2
  // 弧的顶部 y 坐标（比节点顶部高 radiusY）
  const midY = Math.min(sourceY, targetY) - radiusY * 0.3

  // SVG Arc 路径：从起点到终点，逆时针画弧（从上方绕）
  // sweep-flag=0 表示逆时针（向上绕）
  const path = `M ${sourceX} ${sourceY} A ${radiusX} ${radiusY} 0 0 0 ${targetX} ${targetY}`

  return [path, midX, midY]
})

const edgePath = computed(() => edgePathParams.value[0])
const labelX = computed(() => edgePathParams.value[1])
const labelY = computed(() => edgePathParams.value[2])
</script>
