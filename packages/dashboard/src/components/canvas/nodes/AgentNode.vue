<template>
  <div class="vf-node t-agent" :class="['st-' + (data.status || 'pending'), { sel: selected }]">
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />
    <Handle type="target" :position="Position.Top" id="top" />
    <Handle type="source" :position="Position.Bottom" id="bottom" />
    <div class="vn-kind"><span class="vn-ic">◆</span>agent · {{ nodeStatusLabel(data.status) }}</div>
    <div class="vn-lbl">{{ data.label || 'agent' }}</div>
    <div class="vn-sub" v-if="data.agent_binding_ids?.length && data.agent_binding_ids?.[0] !== data.label">{{ data.agent_binding_ids.join(',') }}</div>
    <div class="vn-badge" v-if="data.badge">{{ data.badge }}</div>
  </div>
</template>
<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { nodeStatusLabel } from '../../../lib/status-label'
defineProps<{ id: string; data: any; selected?: boolean }>()
</script>
