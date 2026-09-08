/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, onMounted, watch } from 'vue';
import { api as workflowsApi } from '../../api/workflows';
const props = defineProps();
const emit = defineEmits();
// 本地状态
const localType = ref(props.modelValue?.type || 'keyword');
const localKeyword = ref({
    type: 'keyword',
    caseSensitive: false,
    any: [],
    none: [],
    ...(props.modelValue?.type === 'keyword' ? props.modelValue : {})
});
const localFunction = ref({
    type: 'function',
    functionName: '',
    ...(props.modelValue?.type === 'function' ? props.modelValue : {})
});
const localLoopMax = ref(props.loopMax ?? 3);
// 可用函数列表
const availableFunctions = ref([]);
const loading = ref(false);
const error = ref('');
// 加载可用函数
onMounted(async () => {
    await loadFunctions();
});
// 监听 modelValue 变化
watch(() => props.modelValue, (newValue) => {
    if (!newValue) {
        localType.value = 'keyword';
        localKeyword.value = {
            type: 'keyword',
            caseSensitive: false,
            any: [],
            none: []
        };
        localFunction.value = {
            type: 'function',
            functionName: ''
        };
    }
    else if (newValue.type === 'keyword') {
        localType.value = 'keyword';
        localKeyword.value = { ...newValue };
    }
    else if (newValue.type === 'function') {
        localType.value = 'function';
        localFunction.value = { ...newValue };
    }
}, { deep: true });
watch(() => props.loopMax, (v) => {
    localLoopMax.value = v ?? 3;
});
// 加载函数列表
async function loadFunctions() {
    loading.value = true;
    error.value = '';
    try {
        availableFunctions.value = await workflowsApi.getConditions();
    }
    catch (e) {
        error.value = '加载函数列表失败';
        console.error('Failed to load functions:', e);
    }
    finally {
        loading.value = false;
    }
}
// 类型切换
function onTypeChange() {
    if (localType.value === 'keyword') {
        emitUpdate();
    }
    else {
        // 切换到 function 时，如果还没加载函数列表，则加载
        if (availableFunctions.value.length === 0 && !loading.value) {
            loadFunctions();
        }
        emitUpdate();
    }
}
// 发送更新
function emitUpdate() {
    if (localType.value === 'keyword') {
        emit('update:modelValue', { ...localKeyword.value });
    }
    else {
        if (localFunction.value.functionName) {
            emit('update:modelValue', { ...localFunction.value });
        }
        else {
            emit('update:modelValue', null);
        }
    }
    emit('update:loopMax', localLoopMax.value || 3);
}
// 添加关键字
function addKeyword(list) {
    localKeyword.value[list].push('');
    emitUpdate();
}
// 移除关键字
function removeKeyword(list, index) {
    localKeyword.value[list].splice(index, 1);
    emitUpdate();
}
// 更新关键字
function updateKeyword(list, index, value) {
    localKeyword.value[list][index] = value;
    emitUpdate();
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['option-label']} */ ;
/** @type {__VLS_StyleScopedClasses['add-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['keyword-item']} */ ;
/** @type {__VLS_StyleScopedClasses['remove-btn']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "edge-condition-config" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "condition-type-selector" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "field-label" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    ...{ onChange: (__VLS_ctx.onTypeChange) },
    value: (__VLS_ctx.localType),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "keyword",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "function",
});
if (__VLS_ctx.localType === 'keyword') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "keyword-config" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "option-item" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        ...{ class: "option-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onChange: (__VLS_ctx.emitUpdate) },
        type: "checkbox",
    });
    (__VLS_ctx.localKeyword.caseSensitive);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "keyword-list" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "list-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "list-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.localType === 'keyword'))
                    return;
                __VLS_ctx.addKeyword('any');
            } },
        ...{ class: "add-btn" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "list-items" },
    });
    for (const [keyword, index] of __VLS_getVForSourceType((__VLS_ctx.localKeyword.any))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (index),
            ...{ class: "keyword-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onInput: (...[$event]) => {
                    if (!(__VLS_ctx.localType === 'keyword'))
                        return;
                    __VLS_ctx.updateKeyword('any', index, $event.target.value);
                } },
            type: "text",
            value: (keyword),
            placeholder: "输入关键字",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.localType === 'keyword'))
                        return;
                    __VLS_ctx.removeKeyword('any', index);
                } },
            ...{ class: "remove-btn" },
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "keyword-list" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "list-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "list-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.localType === 'keyword'))
                    return;
                __VLS_ctx.addKeyword('none');
            } },
        ...{ class: "add-btn" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "list-items" },
    });
    for (const [keyword, index] of __VLS_getVForSourceType((__VLS_ctx.localKeyword.none))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (index),
            ...{ class: "keyword-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onInput: (...[$event]) => {
                    if (!(__VLS_ctx.localType === 'keyword'))
                        return;
                    __VLS_ctx.updateKeyword('none', index, $event.target.value);
                } },
            type: "text",
            value: (keyword),
            placeholder: "输入关键字",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.localType === 'keyword'))
                        return;
                    __VLS_ctx.removeKeyword('none', index);
                } },
            ...{ class: "remove-btn" },
        });
    }
}
if (__VLS_ctx.localType === 'function') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "function-config" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "function-selector" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        ...{ class: "field-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
        ...{ onChange: (__VLS_ctx.emitUpdate) },
        value: (__VLS_ctx.localFunction.functionName),
        disabled: (__VLS_ctx.loading),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
        value: "",
    });
    for (const [func] of __VLS_getVForSourceType((__VLS_ctx.availableFunctions))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            key: (func),
            value: (func),
        });
        (func);
    }
    if (__VLS_ctx.loading) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "loading" },
        });
    }
    if (__VLS_ctx.error) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "error" },
        });
        (__VLS_ctx.error);
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "loop-max-config" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "field-label" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "field-hint" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    ...{ onInput: (__VLS_ctx.emitUpdate) },
    type: "number",
    min: "0",
    max: "10",
    placeholder: "默认 3",
});
(__VLS_ctx.localLoopMax);
/** @type {__VLS_StyleScopedClasses['edge-condition-config']} */ ;
/** @type {__VLS_StyleScopedClasses['condition-type-selector']} */ ;
/** @type {__VLS_StyleScopedClasses['field-label']} */ ;
/** @type {__VLS_StyleScopedClasses['keyword-config']} */ ;
/** @type {__VLS_StyleScopedClasses['option-item']} */ ;
/** @type {__VLS_StyleScopedClasses['option-label']} */ ;
/** @type {__VLS_StyleScopedClasses['keyword-list']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
/** @type {__VLS_StyleScopedClasses['list-title']} */ ;
/** @type {__VLS_StyleScopedClasses['add-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['list-items']} */ ;
/** @type {__VLS_StyleScopedClasses['keyword-item']} */ ;
/** @type {__VLS_StyleScopedClasses['remove-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['keyword-list']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
/** @type {__VLS_StyleScopedClasses['list-title']} */ ;
/** @type {__VLS_StyleScopedClasses['add-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['list-items']} */ ;
/** @type {__VLS_StyleScopedClasses['keyword-item']} */ ;
/** @type {__VLS_StyleScopedClasses['remove-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['function-config']} */ ;
/** @type {__VLS_StyleScopedClasses['function-selector']} */ ;
/** @type {__VLS_StyleScopedClasses['field-label']} */ ;
/** @type {__VLS_StyleScopedClasses['loading']} */ ;
/** @type {__VLS_StyleScopedClasses['error']} */ ;
/** @type {__VLS_StyleScopedClasses['loop-max-config']} */ ;
/** @type {__VLS_StyleScopedClasses['field-label']} */ ;
/** @type {__VLS_StyleScopedClasses['field-hint']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            localType: localType,
            localKeyword: localKeyword,
            localFunction: localFunction,
            localLoopMax: localLoopMax,
            availableFunctions: availableFunctions,
            loading: loading,
            error: error,
            onTypeChange: onTypeChange,
            emitUpdate: emitUpdate,
            addKeyword: addKeyword,
            removeKeyword: removeKeyword,
            updateKeyword: updateKeyword,
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
