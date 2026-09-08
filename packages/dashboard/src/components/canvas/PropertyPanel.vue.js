/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { watch, ref, computed } from 'vue';
import FormGenerator from '../workflow/FormGenerator.vue';
import { api as agentBindingApi } from '../../api/agent-bindings';
const props = defineProps();
const emit = defineEmits();
const local = ref({});
// 节点类型信息
const nodeType = computed(() => props.node?.data?.type || 'unknown');
const typeIcon = computed(() => {
    const icons = {
        agent: '◆',
        gate: '▣',
        command: '▸',
        subgraph: '◈'
    };
    return icons[nodeType.value] || '●';
});
const typeLabel = computed(() => {
    const labels = {
        agent: 'Agent 节点',
        gate: '审批关卡',
        command: '命令节点',
        subgraph: '子工作流'
    };
    return labels[nodeType.value] || '未知节点';
});
// 动态加载 Agent Binding 列表
async function loadAgentBindings() {
    try {
        const list = await agentBindingApi.list();
        return list.map(b => b.id);
    }
    catch (e) {
        console.error('加载 Agent Bindings 失败:', e);
        return [];
    }
}
// 根据节点类型定义字段配置
const currentFields = computed(() => {
    if (!props.node)
        return [];
    const type = props.node.data?.type;
    const baseFields = [
        { name: 'label', type: 'string', label: '节点名称', description: '节点的显示名称', required: true }
    ];
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
            ];
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
            ];
        case 'gate':
            return [
                ...baseFields,
                {
                    name: 'exit_condition',
                    type: 'text',
                    label: '退出条件（可选）',
                    description: '自动通过的条件表达式，留空则等待人工审批'
                }
            ];
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
            ];
        default:
            return baseFields;
    }
});
watch(() => props.node, (n) => {
    local.value = { ...(n?.data || {}) };
}, { immediate: true });
function emitUpdate() {
    if (props.node)
        emit('update', props.node.id, { ...local.value });
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['node-type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['node-type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['node-type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['node-type-badge']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "canvas-aside right prop-panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "aside-title" },
});
if (__VLS_ctx.node) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "node-type-badge" },
        ...{ class: (__VLS_ctx.nodeType) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "type-icon" },
    });
    (__VLS_ctx.typeIcon);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "type-label" },
    });
    (__VLS_ctx.typeLabel);
    /** @type {[typeof FormGenerator, ]} */ ;
    // @ts-ignore
    const __VLS_0 = __VLS_asFunctionalComponent(FormGenerator, new FormGenerator({
        ...{ 'onUpdate:modelValue': {} },
        fields: (__VLS_ctx.currentFields),
        modelValue: (__VLS_ctx.local),
    }));
    const __VLS_1 = __VLS_0({
        ...{ 'onUpdate:modelValue': {} },
        fields: (__VLS_ctx.currentFields),
        modelValue: (__VLS_ctx.local),
    }, ...__VLS_functionalComponentArgsRest(__VLS_0));
    let __VLS_3;
    let __VLS_4;
    let __VLS_5;
    const __VLS_6 = {
        'onUpdate:modelValue': (__VLS_ctx.emitUpdate)
    };
    var __VLS_2;
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "aside-empty" },
    });
}
/** @type {__VLS_StyleScopedClasses['canvas-aside']} */ ;
/** @type {__VLS_StyleScopedClasses['right']} */ ;
/** @type {__VLS_StyleScopedClasses['prop-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['aside-title']} */ ;
/** @type {__VLS_StyleScopedClasses['node-type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['type-label']} */ ;
/** @type {__VLS_StyleScopedClasses['aside-empty']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            FormGenerator: FormGenerator,
            local: local,
            nodeType: nodeType,
            typeIcon: typeIcon,
            typeLabel: typeLabel,
            currentFields: currentFields,
            emitUpdate: emitUpdate,
        };
    },
    __typeEmits: {},
    __typeProps: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeEmits: {},
    __typeProps: {},
});
; /* PartiallyEnd: #4569/main.vue */
