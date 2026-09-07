<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <!-- 头部 -->
          <div class="modal-header">
            <div class="modal-title">
              <span class="type-badge" :class="editType">
                {{ typeIcon }} {{ typeLabel }}
              </span>
            </div>
            <button class="close-btn" @click="close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6L18 18"/>
              </svg>
            </button>
          </div>

          <!-- 内容 -->
          <div class="modal-body">
            <!-- 节点编辑 -->
            <template v-if="editType === 'node' && nodeData">
              <FormGenerator
                :fields="nodeFields"
                v-model="localData"
              />
            </template>

            <!-- 边编辑 -->
            <template v-if="editType === 'edge' && edgeData">
              <div class="edge-connection">
                <span class="edge-node">{{ edgeData.sourceLabel || edgeData.source }}</span>
                <span class="edge-arrow">→</span>
                <span class="edge-node">{{ edgeData.targetLabel || edgeData.target }}</span>
              </div>
              <EdgeConditionConfig
                v-model="localCondition"
                :loop-max="localLoopMax"
                @update:loopMax="localLoopMax = $event"
              />
            </template>
          </div>

          <!-- 底部 -->
          <div class="modal-footer">
            <button class="btn-cancel" @click="close">取消</button>
            <button class="btn-save" @click="save">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import FormGenerator from '../workflow/FormGenerator.vue'
import EdgeConditionConfig from '../workflow/EdgeConditionConfig.vue'
import type { Field } from '../workflow/FormGenerator.vue'
import { api as agentBindingApi } from '../../api/agent-bindings'

const props = defineProps<{
  visible: boolean
  editType: 'node' | 'edge' | null
  nodeData: any | null
  edgeData: any | null
}>()

const emit = defineEmits<{
  close: []
  save: [type: 'node' | 'edge', data: any]
}>()

// 本地编辑数据
const localData = ref<any>({})
const localCondition = ref<any>(null)
const localLoopMax = ref(3)

// 预加载的 Agent Binding 列表（避免重复 API 调用）
const agentBindingOptions = ref<string[]>([])

// 监听 props 变化
watch(() => props.nodeData, (n) => {
  if (n) localData.value = { ...n }
}, { immediate: true })

watch(() => props.edgeData, (e) => {
  if (e) {
    localCondition.value = e.condition || null
    localLoopMax.value = e.loop_max ?? 3
  }
}, { immediate: true })

// 弹窗打开时预加载 Agent Bindings
watch(() => props.visible, async (v) => {
  if (v && props.editType === 'node' && props.nodeData?.type === 'agent') {
    if (agentBindingOptions.value.length === 0) {
      try {
        const list = await agentBindingApi.list()
        agentBindingOptions.value = list.map(b => b.id)
      } catch {
        agentBindingOptions.value = []
      }
    }
  }
})

// 类型信息
const typeIcon = computed(() => {
  const icons: Record<string, string> = {
    agent: '◆', gate: '▣', command: '▸', subgraph: '◈'
  }
  return icons[props.nodeData?.type] || '●'
})

const typeLabel = computed(() => {
  const labels: Record<string, string> = {
    agent: 'Agent 节点', gate: '审批关卡', command: '命令节点', subgraph: '子工作流'
  }
  return labels[props.nodeData?.type] || '节点'
})

// 节点字段配置（使用预加载的选项，避免每次创建新函数）
const nodeFields = computed<Field[]>(() => {
  if (!props.nodeData) return []
  const type = props.nodeData.type
  const base: Field[] = [
    { name: 'label', type: 'string', label: '节点名称', description: '节点的显示名称', required: true }
  ]

  switch (type) {
    case 'agent':
      return [
        ...base,
        { name: 'agent_binding_ids', type: 'multiselect', label: 'Agent 绑定', description: '选择执行此节点的 Agent', options: agentBindingOptions.value },
        { name: 'write_key', type: 'enum', label: '输出键', description: '节点输出写入的状态字段', options: ['spec', 'tasks', 'results'] }
      ]
    case 'command':
      return [...base, { name: 'command', type: 'text', label: 'Shell 命令', description: '要执行的命令', required: true }]
    case 'gate':
      return [...base, { name: 'exit_condition', type: 'text', label: '退出条件（可选）', description: '自动通过的条件表达式' }]
    case 'subgraph':
      return [...base, { name: 'subgraph_id', type: 'string', label: '子工作流', description: '引用的工作流 ID', required: true }]
    default:
      return base
  }
})

function close() {
  emit('close')
}

function save() {
  if (props.editType === 'node') {
    emit('save', 'node', { ...localData.value })
  } else if (props.editType === 'edge') {
    emit('save', 'edge', {
      condition: localCondition.value,
      loop_max: localLoopMax.value
    })
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  width: 90%;
  max-width: 520px;
  max-height: 85vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
}

.type-badge.agent {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(96, 165, 250, 0.2));
  color: var(--st-running);
}

.type-badge.gate {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(251, 191, 36, 0.2));
  color: var(--st-paused);
}

.type-badge.command {
  background: linear-gradient(135deg, rgba(148, 163, 184, 0.2), rgba(203, 213, 225, 0.2));
  color: var(--muted);
}

.type-badge.subgraph {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(167, 139, 250, 0.2));
  color: var(--ai);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--surface);
  color: var(--text);
  border-color: var(--accent);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.edge-connection {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  background: var(--surface);
  border-radius: 12px;
  margin-bottom: 20px;
}

.edge-node {
  font-weight: 600;
  color: var(--text);
  font-size: 14px;
}

.edge-arrow {
  color: var(--accent);
  font-size: 20px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.btn-cancel, .btn-save {
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}

.btn-cancel:hover {
  background: var(--surface);
  color: var(--text);
}

.btn-save {
  background: linear-gradient(135deg, var(--accent), #60a5fa);
  border: none;
  color: var(--bg);
  font-weight: 600;
}

.btn-save:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 211, 238, 0.3);
}

/* 过渡动画 */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.2s ease;
}

.modal-enter-from, .modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95) translateY(20px);
}
</style>