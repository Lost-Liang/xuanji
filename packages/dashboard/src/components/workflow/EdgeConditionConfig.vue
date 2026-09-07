<template>
  <div class="edge-condition-config">
    <!-- 条件类型选择 -->
    <div class="condition-type-selector">
      <label class="field-label">条件类型</label>
      <select v-model="localType" @change="onTypeChange">
        <option value="keyword">关键字匹配</option>
        <option value="function">函数判断</option>
      </select>
    </div>

    <!-- Keyword 类型配置 -->
    <div v-if="localType === 'keyword'" class="keyword-config">
      <!-- 大小写敏感开关 -->
      <div class="option-item">
        <label class="option-label">
          <input
            type="checkbox"
            v-model="localKeyword.caseSensitive"
            @change="emitUpdate"
          />
          区分大小写
        </label>
      </div>

      <!-- any 列表 -->
      <div class="keyword-list">
        <div class="list-header">
          <span class="list-title">任一匹配</span>
          <button @click="addKeyword('any')" class="add-btn">+ 添加关键字</button>
        </div>
        <div class="list-items">
          <div
            v-for="(keyword, index) in localKeyword.any"
            :key="index"
            class="keyword-item"
          >
            <input
              type="text"
              :value="keyword"
              @input="updateKeyword('any', index, ($event.target as HTMLInputElement).value)"
              placeholder="输入关键字"
            />
            <button @click="removeKeyword('any', index)" class="remove-btn">×</button>
          </div>
        </div>
      </div>

      <!-- none 列表 -->
      <div class="keyword-list">
        <div class="list-header">
          <span class="list-title">排除匹配</span>
          <button @click="addKeyword('none')" class="add-btn">+ 添加关键字</button>
        </div>
        <div class="list-items">
          <div
            v-for="(keyword, index) in localKeyword.none"
            :key="index"
            class="keyword-item"
          >
            <input
              type="text"
              :value="keyword"
              @input="updateKeyword('none', index, ($event.target as HTMLInputElement).value)"
              placeholder="输入关键字"
            />
            <button @click="removeKeyword('none', index)" class="remove-btn">×</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Function 类型配置 -->
    <div v-if="localType === 'function'" class="function-config">
      <div class="function-selector">
        <label class="field-label">选择函数</label>
        <select
          v-model="localFunction.functionName"
          @change="emitUpdate"
          :disabled="loading"
        >
          <option value="">请选择函数</option>
          <option v-for="func in availableFunctions" :key="func" :value="func">
            {{ func }}
          </option>
        </select>
        <div v-if="loading" class="loading">加载中...</div>
        <div v-if="error" class="error">{{ error }}</div>
      </div>
    </div>

    <!-- 循环上限配置（仅当是回环边时显示） -->
    <div class="loop-max-config">
      <label class="field-label">
        循环上限
        <span class="field-hint">（用于修复循环，0 表示无限制）</span>
      </label>
      <input
        type="number"
        v-model.number="localLoopMax"
        @input="emitUpdate"
        min="0"
        max="10"
        placeholder="默认 3"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { api as workflowsApi } from '../../api/workflows'

/**
 * 关键字条件配置
 */
export interface KeywordCondition {
  type: 'keyword'
  caseSensitive: boolean
  any: string[]
  none: string[]
}

/**
 * 函数条件配置
 */
export interface FunctionCondition {
  type: 'function'
  functionName: string
}

/**
 * 边条件配置类型
 */
export type EdgeCondition = KeywordCondition | FunctionCondition

const props = defineProps<{
  modelValue?: EdgeCondition | null
  loopMax?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EdgeCondition | null]
  'update:loopMax': [value: number]
}>()

// 本地状态
const localType = ref<'keyword' | 'function'>(
  props.modelValue?.type || 'keyword'
)

const localKeyword = ref<KeywordCondition>({
  type: 'keyword',
  caseSensitive: false,
  any: [],
  none: [],
  ...(props.modelValue?.type === 'keyword' ? props.modelValue : {})
})

const localFunction = ref<FunctionCondition>({
  type: 'function',
  functionName: '',
  ...(props.modelValue?.type === 'function' ? props.modelValue : {})
})

const localLoopMax = ref<number>(props.loopMax ?? 3)

// 可用函数列表
const availableFunctions = ref<string[]>([])
const loading = ref(false)
const error = ref('')

// 加载可用函数
onMounted(async () => {
  await loadFunctions()
})

// 监听 modelValue 变化
watch(() => props.modelValue, (newValue) => {
  if (!newValue) {
    localType.value = 'keyword'
    localKeyword.value = {
      type: 'keyword',
      caseSensitive: false,
      any: [],
      none: []
    }
    localFunction.value = {
      type: 'function',
      functionName: ''
    }
  } else if (newValue.type === 'keyword') {
    localType.value = 'keyword'
    localKeyword.value = { ...newValue }
  } else if (newValue.type === 'function') {
    localType.value = 'function'
    localFunction.value = { ...newValue }
  }
}, { deep: true })

watch(() => props.loopMax, (v) => {
  localLoopMax.value = v ?? 3
})

// 加载函数列表
async function loadFunctions() {
  loading.value = true
  error.value = ''
  try {
    availableFunctions.value = await workflowsApi.getConditions()
  } catch (e) {
    error.value = '加载函数列表失败'
    console.error('Failed to load functions:', e)
  } finally {
    loading.value = false
  }
}

// 类型切换
function onTypeChange() {
  if (localType.value === 'keyword') {
    emitUpdate()
  } else {
    // 切换到 function 时，如果还没加载函数列表，则加载
    if (availableFunctions.value.length === 0 && !loading.value) {
      loadFunctions()
    }
    emitUpdate()
  }
}

// 发送更新
function emitUpdate() {
  if (localType.value === 'keyword') {
    emit('update:modelValue', { ...localKeyword.value })
  } else {
    if (localFunction.value.functionName) {
      emit('update:modelValue', { ...localFunction.value })
    } else {
      emit('update:modelValue', null)
    }
  }
  emit('update:loopMax', localLoopMax.value || 3)
}

// 添加关键字
function addKeyword(list: 'any' | 'none') {
  localKeyword.value[list].push('')
  emitUpdate()
}

// 移除关键字
function removeKeyword(list: 'any' | 'none', index: number) {
  localKeyword.value[list].splice(index, 1)
  emitUpdate()
}

// 更新关键字
function updateKeyword(list: 'any' | 'none', index: number, value: string) {
  localKeyword.value[list][index] = value
  emitUpdate()
}
</script>

<style scoped>
.edge-condition-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-label {
  font-weight: 500;
  font-size: 14px;
  color: var(--text);
  display: block;
  margin-bottom: 8px;
}

.field-hint {
  font-weight: 400;
  font-size: 12px;
  color: var(--muted);
}

select,
input[type="text"],
input[type="number"] {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  transition: border-color 0.2s;
}

select:focus,
input[type="text"]:focus,
input[type="number"]:focus {
  outline: none;
  border-color: var(--accent);
}

.condition-type-selector {
  display: flex;
  flex-direction: column;
}

.keyword-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.option-item {
  display: flex;
  align-items: center;
}

.option-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
}

.option-label input[type="checkbox"] {
  width: auto;
  cursor: pointer;
}

.keyword-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--surface-2);
  border-radius: 4px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-title {
  font-weight: 500;
  font-size: 14px;
  color: var(--muted);
}

.add-btn {
  padding: 4px 12px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.add-btn:hover {
  background: var(--accent-dim);
}

.list-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.keyword-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.keyword-item input {
  flex: 1;
}

.remove-btn {
  padding: 4px 12px;
  background: var(--st-failed);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.remove-btn:hover {
  background: var(--el-color-danger-dark-2);
}

.function-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.function-selector {
  display: flex;
  flex-direction: column;
}

.loop-max-config {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.loading {
  padding: 8px;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
}

.error {
  padding: 8px;
  color: var(--st-failed);
  font-size: 14px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 4px;
}
</style>