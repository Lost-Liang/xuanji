/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
const props = defineProps();
const emit = defineEmits();
// 获取字段的选项（直接返回数组或空数组）
function getOptions(field) {
    if (Array.isArray(field.options)) {
        return field.options;
    }
    return [];
}
// 更新字段值
function updateField(name, value) {
    emit('update:modelValue', { ...props.modelValue, [name]: value });
}
// 添加多选项
function addItem(name, value) {
    if (!value)
        return;
    const current = props.modelValue[name] || [];
    if (!current.includes(value)) {
        emit('update:modelValue', { ...props.modelValue, [name]: [...current, value] });
    }
}
// 移除多选项
function removeItem(name, value) {
    const current = props.modelValue[name] || [];
    emit('update:modelValue', {
        ...props.modelValue,
        [name]: current.filter((item) => item !== value)
    });
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['remove-btn']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "form-generator" },
});
for (const [field] of __VLS_getVForSourceType((__VLS_ctx.fields))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        key: (field.name),
        ...{ class: "form-field" },
    });
    if (field.label) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
            ...{ class: "field-label" },
        });
        (field.label);
        if (field.required) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "required" },
            });
        }
    }
    if (field.description) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "field-desc" },
        });
        (field.description);
    }
    if (field.type === 'string') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onInput: (...[$event]) => {
                    if (!(field.type === 'string'))
                        return;
                    __VLS_ctx.updateField(field.name, $event.target.value);
                } },
            type: "text",
            value: (__VLS_ctx.modelValue[field.name]),
            required: (field.required),
        });
    }
    else if (field.type === 'text') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.textarea)({
            ...{ onInput: (...[$event]) => {
                    if (!!(field.type === 'string'))
                        return;
                    if (!(field.type === 'text'))
                        return;
                    __VLS_ctx.updateField(field.name, $event.target.value);
                } },
            value: (__VLS_ctx.modelValue[field.name]),
            required: (field.required),
        });
    }
    else if (field.type === 'number') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onInput: (...[$event]) => {
                    if (!!(field.type === 'string'))
                        return;
                    if (!!(field.type === 'text'))
                        return;
                    if (!(field.type === 'number'))
                        return;
                    __VLS_ctx.updateField(field.name, Number($event.target.value));
                } },
            type: "number",
            value: (__VLS_ctx.modelValue[field.name]),
            min: (field.min),
            max: (field.max),
            required: (field.required),
        });
    }
    else if (field.type === 'enum') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
            ...{ onChange: (...[$event]) => {
                    if (!!(field.type === 'string'))
                        return;
                    if (!!(field.type === 'text'))
                        return;
                    if (!!(field.type === 'number'))
                        return;
                    if (!(field.type === 'enum'))
                        return;
                    __VLS_ctx.updateField(field.name, $event.target.value);
                } },
            value: (__VLS_ctx.modelValue[field.name]),
            required: (field.required),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "",
        });
        for (const [opt] of __VLS_getVForSourceType((__VLS_ctx.getOptions(field)))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
                key: (opt),
                value: (opt),
            });
            (opt);
        }
    }
    else if (field.type === 'multiselect') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "multiselect-container" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "selected-items" },
        });
        for (const [item] of __VLS_getVForSourceType(((__VLS_ctx.modelValue[field.name] || [])))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                key: (item),
                ...{ class: "selected-item" },
            });
            (item);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(field.type === 'string'))
                            return;
                        if (!!(field.type === 'text'))
                            return;
                        if (!!(field.type === 'number'))
                            return;
                        if (!!(field.type === 'enum'))
                            return;
                        if (!(field.type === 'multiselect'))
                            return;
                        __VLS_ctx.removeItem(field.name, item);
                    } },
                ...{ class: "remove-btn" },
            });
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
            ...{ onChange: (...[$event]) => {
                    if (!!(field.type === 'string'))
                        return;
                    if (!!(field.type === 'text'))
                        return;
                    if (!!(field.type === 'number'))
                        return;
                    if (!!(field.type === 'enum'))
                        return;
                    if (!(field.type === 'multiselect'))
                        return;
                    __VLS_ctx.addItem(field.name, $event.target.value);
                } },
            ...{ class: "multiselect-select" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "",
        });
        for (const [opt] of __VLS_getVForSourceType((__VLS_ctx.getOptions(field)))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
                key: (opt),
                value: (opt),
                disabled: ((__VLS_ctx.modelValue[field.name] || []).includes(opt)),
            });
            (opt);
        }
    }
}
/** @type {__VLS_StyleScopedClasses['form-generator']} */ ;
/** @type {__VLS_StyleScopedClasses['form-field']} */ ;
/** @type {__VLS_StyleScopedClasses['field-label']} */ ;
/** @type {__VLS_StyleScopedClasses['required']} */ ;
/** @type {__VLS_StyleScopedClasses['field-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['multiselect-container']} */ ;
/** @type {__VLS_StyleScopedClasses['selected-items']} */ ;
/** @type {__VLS_StyleScopedClasses['selected-item']} */ ;
/** @type {__VLS_StyleScopedClasses['remove-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['multiselect-select']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            getOptions: getOptions,
            updateField: updateField,
            addItem: addItem,
            removeItem: removeItem,
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
