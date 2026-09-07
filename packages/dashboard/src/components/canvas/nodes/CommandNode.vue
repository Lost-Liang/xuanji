<template>
  <div class="vf-node t-command" :class="['st-' + (data.status || 'pending'), { sel: selected }]">
    <Handle type="target" :position="Position.Left" />
    <div class="vn-kind"><span class="vn-ic">▸</span>command · {{ data.status || 'pending' }}</div>
    <div class="vn-lbl">{{ data.label || 'command' }}</div>
    <div class="vn-sub" v-if="data.command">{{ data.command }}</div>
    <div class="vn-badge" v-if="data.badge">{{ data.badge }}</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
defineProps<{ id: string; data: any; selected?: boolean }>()
</script>
