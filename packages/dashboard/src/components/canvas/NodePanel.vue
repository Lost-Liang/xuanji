<template>
  <div class="canvas-aside node-panel">
    <div class="aside-title">节点</div>
    <button v-for="t in types" :key="t.type" class="aside-item" @click="$emit('add', t.type)">
      <span class="ic">{{ t.icon }}</span>{{ t.label }}
    </button>
  </div>
</template>
<script setup lang="ts">
const types = [
  { type: 'agent', label: 'Agent', icon: '◆' },
  { type: 'gate', label: 'Gate', icon: '▣' },
  { type: 'command', label: 'Command', icon: '▸' },
  { type: 'subgraph', label: 'Subgraph', icon: '◈' },
]
defineEmits<{ add: [type: string] }>()
</script>
<style scoped>
.node-panel { width: 150px; flex-shrink: 0; }
</style>
