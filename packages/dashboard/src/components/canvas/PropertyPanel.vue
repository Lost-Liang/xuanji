<template>
  <div class="canvas-aside right prop-panel">
    <div class="aside-title">属性</div>
    <template v-if="node">
      <!-- 节点类型标识 -->
      <div class="node-type-badge" :class="nodeType">
        <span class="type-icon">{{ typeIcon }}</span>
        <span class="type-label">{{ typeLabel }}</span>
      </div>
      <FormGenerator
        :fields="currentFields"
        v-model="local"
        @update:modelValue="emitUpdate"
      />
    </template>
    <div v-else class="aside-empty">选中节点或边查看属性</div>
  </div>
</template>

<script setup lang="ts">
import { watch, ref, computed } from 'vue'
import FormGenerator from '../workflow/FormGenerator.vue'
import type { Field } from '../workflow/FormGenerator.vue'
import { api as agentBindingApi } from '../../api/agent-bindings'

const props = defineProps<{ node: any }>()
const emit = defineEmits<{ update: [id: string, data: any] }>()
const local = ref<any>({})

// 节点类型信息
const nodeType = computed(() => props.node?.data?.type || 'unknown')

const typeIcon = computed(() => {
  const icons: Record<string, string> = {
    agent: '◆',
    gate: '▣',
    command: '▸',
    subgraph: '◈'
  }
  return icons[nodeType.value] || '●'
})

const typeLabel = computed(() => {
  const labels: Record<string, string> = {
    agent: 'Agent 节点',
    gate: '审批关卡',
    command: '命令节点',
    subgraph: '子工作流'
  }
  return labels[nodeType.value] || '未知节点'
})

// 动态加载 Agent Binding 列表
async function loadAgentBindings(): Promise<string[]> {
  try {
    const list = await agentBindingApi.list()
    return list.map(b => b.id)
  } catch (e) {
    console.error('加载 Agent Bindings 失败:', e)
    return []
  }
}

// 根据节点类型定义字段配置
const currentFields = computed<Field[]>(() => {
  if (!props.node) return []

  const type = props.node.data?.type
  const baseFields: Field[] = [
    { name: 'label', type: 'string', label: '节点名称', description: '节点的显示名称', required: true }
  ]

  switch (type) {
    case 'agent':
      return [
        ...baseFields,
        {
          name: 'agent_binding_ids',
          type: 'multiselect',
          label: 'Agent 绑定',
          description: '选择执行此节点的 Agent 配置',
          options: loadAgentBindings
        },
        {
          name: 'write_key',
          type: 'enum',
          label: '输出键',
          description: '节点输出写入的状态字段',
          options: ['spec', 'tasks', 'results']
        }
      ]

    case 'command':
      return [
        ...baseFields,
        {
          name: 'command',
          type: 'text',
          label: 'Shell 命令',
          description: '要执行的命令，如 mvn compile',
          required: true
        }
      ]

    case 'gate':
      return [
        ...baseFields,
        {
          name: 'exit_condition',
          type: 'text',
          label: '退出条件（可选）',
          description: '自动通过的条件表达式，留空则等待人工审批'
        }
      ]

    case 'subgraph':
      return [
        ...baseFields,
        {
          name: 'subgraph_id',
          type: 'string',
          label: '子工作流',
          description: '引用的工作流 ID',
          required: true
        }
      ]

    default:
      return baseFields
  }
})

watch(() => props.node, (n) => {
  local.value = { ...(n?.data || {}) }
}, { immediate: true })

function emitUpdate() {
  if (props.node) emit('update', props.node.id, { ...local.value })
}
</script>

<style scoped>
.prop-panel {
  width: 280px;
  flex-shrink: 0;
  padding: 16px;
}

.aside-title {
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.node-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 16px;
}

.node-type-badge.agent {
  background: rgba(34, 211, 238, 0.15);
  color: var(--st-running);
}

.node-type-badge.gate {
  background: rgba(245, 158, 11, 0.15);
  color: var(--st-paused);
}

.node-type-badge.command {
  background: rgba(148, 163, 184, 0.15);
  color: var(--muted);
}

.node-type-badge.subgraph {
  background: rgba(124, 58, 237, 0.15);
  color: var(--ai);
}

.type-icon {
  font-size: 14px;
}

.aside-empty {
  color: var(--faint);
  font-size: 14px;
  text-align: center;
  margin-top: 20px;
}
</style>
