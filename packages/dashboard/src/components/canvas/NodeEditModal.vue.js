/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, computed, watch } from 'vue';
import FormGenerator from '../workflow/FormGenerator.vue';
import EdgeConditionConfig from '../workflow/EdgeConditionConfig.vue';
import { api as agentBindingApi } from '../../api/agent-bindings';
const props = defineProps();
const emit = defineEmits();
// 本地编辑数据
const localData = ref({});
const localCondition = ref(null);
const localLoopMax = ref(3);
// 预加载的 Agent Binding 列表（避免重复 API 调用）
const agentBindingOptions = ref([]);
// 监听 props 变化
watch(() => props.nodeData, (n) => {
    if (n)
        localData.value = { ...n };
}, { immediate: true });
watch(() => props.edgeData, (e) => {
    if (e) {
        localCondition.value = e.condition || null;
        localLoopMax.value = e.loop_max ?? 3;
    }
}, { immediate: true });
// 弹窗打开时预加载 Agent Bindings
watch(() => props.visible, async (v) => {
    if (v && props.editType === 'node' && props.nodeData?.type === 'agent') {
        if (agentBindingOptions.value.length === 0) {
            try {
                const list = await agentBindingApi.list();
                agentBindingOptions.value = list.map(b => b.id);
            }
            catch {
                agentBindingOptions.value = [];
            }
        }
    }
});
// 类型信息
const typeIcon = computed(() => {
    const icons = {
        agent: '◆', gate: '▣', command: '▸', subgraph: '◈'
    };
    return icons[props.nodeData?.type] || '●';
});
const typeLabel = computed(() => {
    const labels = {
        agent: 'Agent 节点', gate: '审批关卡', command: '命令节点', subgraph: '子工作流'
    };
    return labels[props.nodeData?.type] || '节点';
});
// 节点字段配置（使用预加载的选项，避免每次创建新函数）
const nodeFields = computed(() => {
    if (!props.nodeData)
        return [];
    const type = props.nodeData.type;
    const base = [
        { name: 'label', type: 'string', label: '节点名称', description: '节点的显示名称', required: true }
    ];
    switch (type) {
        case 'agent':
            return [
                ...base,
                { name: 'agent_binding_ids', type: 'multiselect', label: 'Agent 绑定', description: '选择执行此节点的 Agent', options: agentBindingOptions.value },
                { name: 'write_key', type: 'enum', label: '输出键', description: '节点输出写入的状态字段', options: ['spec', 'tasks', 'results'] }
            ];
        case 'command':
            return [...base, { name: 'command', type: 'text', label: 'Shell 命令', description: '要执行的命令', required: true }];
        case 'gate':
            return [...base, { name: 'exit_condition', type: 'text', label: '退出条件（可选）', description: '自动通过的条件表达式' }];
        case 'subgraph':
            return [...base, { name: 'subgraph_id', type: 'string', label: '子工作流', description: '引用的工作流 ID', required: true }];
        default:
            return base;
    }
});
function close() {
    emit('close');
}
function save() {
    if (props.editType === 'node') {
        emit('save', 'node', { ...localData.value });
    }
    else if (props.editType === 'edge') {
        emit('save', 'edge', {
            condition: localCondition.value,
            loop_max: localLoopMax.value
        });
    }
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-cancel']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-cancel']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-save']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-save']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-enter-active']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-container']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-leave-active']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-container']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-enter-from']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-container']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-leave-to']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-container']} */ ;
// CSS variable injection 
// CSS variable injection end 
const __VLS_0 = {}.Teleport;
/** @type {[typeof __VLS_components.Teleport, typeof __VLS_components.Teleport, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    to: "body",
}));
const __VLS_2 = __VLS_1({
    to: "body",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
const __VLS_4 = {}.Transition;
/** @type {[typeof __VLS_components.Transition, typeof __VLS_components.Transition, ]} */ ;
// @ts-ignore
const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
    name: "modal",
}));
const __VLS_6 = __VLS_5({
    name: "modal",
}, ...__VLS_functionalComponentArgsRest(__VLS_5));
__VLS_7.slots.default;
if (__VLS_ctx.visible) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ onClick: (__VLS_ctx.close) },
        ...{ class: "modal-overlay" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "modal-container" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "modal-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "modal-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "type-badge" },
        ...{ class: (__VLS_ctx.editType) },
    });
    (__VLS_ctx.typeIcon);
    (__VLS_ctx.typeLabel);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.close) },
        ...{ class: "close-btn" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
        width: "18",
        height: "18",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        'stroke-width': "2",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
        d: "M18 6L6 18M6 6L18 18",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "modal-body" },
    });
    if (__VLS_ctx.editType === 'node' && __VLS_ctx.nodeData) {
        /** @type {[typeof FormGenerator, ]} */ ;
        // @ts-ignore
        const __VLS_8 = __VLS_asFunctionalComponent(FormGenerator, new FormGenerator({
            fields: (__VLS_ctx.nodeFields),
            modelValue: (__VLS_ctx.localData),
        }));
        const __VLS_9 = __VLS_8({
            fields: (__VLS_ctx.nodeFields),
            modelValue: (__VLS_ctx.localData),
        }, ...__VLS_functionalComponentArgsRest(__VLS_8));
    }
    if (__VLS_ctx.editType === 'edge' && __VLS_ctx.edgeData) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "edge-connection" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "edge-node" },
        });
        (__VLS_ctx.edgeData.sourceLabel || __VLS_ctx.edgeData.source);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "edge-arrow" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "edge-node" },
        });
        (__VLS_ctx.edgeData.targetLabel || __VLS_ctx.edgeData.target);
        /** @type {[typeof EdgeConditionConfig, ]} */ ;
        // @ts-ignore
        const __VLS_11 = __VLS_asFunctionalComponent(EdgeConditionConfig, new EdgeConditionConfig({
            ...{ 'onUpdate:loopMax': {} },
            modelValue: (__VLS_ctx.localCondition),
            loopMax: (__VLS_ctx.localLoopMax),
        }));
        const __VLS_12 = __VLS_11({
            ...{ 'onUpdate:loopMax': {} },
            modelValue: (__VLS_ctx.localCondition),
            loopMax: (__VLS_ctx.localLoopMax),
        }, ...__VLS_functionalComponentArgsRest(__VLS_11));
        let __VLS_14;
        let __VLS_15;
        let __VLS_16;
        const __VLS_17 = {
            'onUpdate:loopMax': (...[$event]) => {
                if (!(__VLS_ctx.visible))
                    return;
                if (!(__VLS_ctx.editType === 'edge' && __VLS_ctx.edgeData))
                    return;
                __VLS_ctx.localLoopMax = $event;
            }
        };
        var __VLS_13;
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "modal-footer" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.close) },
        ...{ class: "btn-cancel" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.save) },
        ...{ class: "btn-save" },
    });
}
var __VLS_7;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['modal-overlay']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-container']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-header']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-title']} */ ;
/** @type {__VLS_StyleScopedClasses['type-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-body']} */ ;
/** @type {__VLS_StyleScopedClasses['edge-connection']} */ ;
/** @type {__VLS_StyleScopedClasses['edge-node']} */ ;
/** @type {__VLS_StyleScopedClasses['edge-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['edge-node']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-cancel']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-save']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            FormGenerator: FormGenerator,
            EdgeConditionConfig: EdgeConditionConfig,
            localData: localData,
            localCondition: localCondition,
            localLoopMax: localLoopMax,
            typeIcon: typeIcon,
            typeLabel: typeLabel,
            nodeFields: nodeFields,
            close: close,
            save: save,
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
