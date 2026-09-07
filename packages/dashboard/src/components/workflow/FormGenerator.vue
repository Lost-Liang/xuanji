<template>
  <div class="form-generator">
    <div v-for="field in fields" :key="field.name" class="form-field">
      <label v-if="field.label" class="field-label">
        {{ field.label }}
        <span v-if="field.required" class="required">*</span>
      </label>
      <p v-if="field.description" class="field-desc">{{ field.description }}</p>

      <!-- string 类型：单行文本 -->
      <input
        v-if="field.type === 'string'"
        type="text"
        :value="modelValue[field.name]"
        @input="updateField(field.name, ($event.target as HTMLInputElement).value)"
        :required="field.required"
      />

      <!-- text 类型：多行文本 -->
      <textarea
        v-else-if="field.type === 'text'"
        :value="modelValue[field.name]"
        @input="updateField(field.name, ($event.target as HTMLTextAreaElement).value)"
        :required="field.required"
      />

      <!-- number 类型：数字输入 -->
      <input
        v-else-if="field.type === 'number'"
        type="number"
        :value="modelValue[field.name]"
        @input="updateField(field.name, Number(($event.target as HTMLInputElement).value))"
        :min="field.min"
        :max="field.max"
        :required="field.required"
      />

      <!-- enum 类型：单选下拉 -->
      <select
        v-else-if="field.type === 'enum'"
        :value="modelValue[field.name]"
        @change="updateField(field.name, ($event.target as HTMLSelectElement).value)"
        :required="field.required"
      >
        <option value="">请选择</option>
        <option v-for="opt in getOptions(field)" :key="opt" :value="opt">
          {{ opt }}
        </option>
      </select>

      <!-- multiselect 类型：多选 -->
      <div v-else-if="field.type === 'multiselect'" class="multiselect-container">
        <div class="selected-items">
          <span
            v-for="item in (modelValue[field.name] || [])"
            :key="item"
            class="selected-item"
          >
            {{ item }}
            <button @click="removeItem(field.name, item)" class="remove-btn">×</button>
          </span>
        </div>
        <select
          @change="addItem(field.name, ($event.target as HTMLSelectElement).value)"
          class="multiselect-select"
        >
          <option value="">添加选项</option>
          <option
            v-for="opt in getOptions(field)"
            :key="opt"
            :value="opt"
            :disabled="(modelValue[field.name] || []).includes(opt)"
          >
            {{ opt }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 字段配置接口
 */
export interface Field {
  name: string
  type: 'string' | 'text' | 'number' | 'enum' | 'multiselect'
  label?: string
  description?: string  // 帮助说明
  required?: boolean
  options?: string[] | (() => Promise<string[]>)
  min?: number
  max?: number
}

const props = defineProps<{
  fields: Field[]
  modelValue: Record<string, any>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, any>]
}>()

// 获取字段的选项（直接返回数组或空数组）
function getOptions(field: Field): string[] {
  if (Array.isArray(field.options)) {
    return field.options
  }
  return []
}

// 更新字段值
function updateField(name: string, value: any) {
  emit('update:modelValue', { ...props.modelValue, [name]: value })
}

// 添加多选项
function addItem(name: string, value: string) {
  if (!value) return
  const current = props.modelValue[name] || []
  if (!current.includes(value)) {
    emit('update:modelValue', { ...props.modelValue, [name]: [...current, value] })
  }
}

// 移除多选项
function removeItem(name: string, value: string) {
  const current = props.modelValue[name] || []
  emit('update:modelValue', {
    ...props.modelValue,
    [name]: current.filter((item: string) => item !== value)
  })
}
</script>

<style scoped>
.form-generator {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-weight: 500;
  font-size: 14px;
  color: var(--text);
}

.field-desc {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px 0;
  line-height: 1.4;
}

.required {
  color: var(--st-failed);
  margin-left: 4px;
}

input[type="text"],
input[type="number"],
textarea,
select {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  transition: border-color 0.2s;
}

input[type="text"]:focus,
input[type="number"]:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--accent);
}

textarea {
  min-height: 80px;
  resize: vertical;
}

.multiselect-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selected-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.selected-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--surface-2);
  color: var(--text);
  border-radius: 4px;
  font-size: 14px;
}

.remove-btn {
  border: none;
  background: none;
  color: var(--st-failed);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.remove-btn:hover {
  color: var(--el-color-danger-dark-2);
}

.multiselect-select {
  width: 100%;
}
</style>