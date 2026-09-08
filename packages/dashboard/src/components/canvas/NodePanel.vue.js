/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
const types = [
    { type: 'agent', label: 'Agent', icon: '◆' },
    { type: 'gate', label: 'Gate', icon: '▣' },
    { type: 'command', label: 'Command', icon: '▸' },
    { type: 'subgraph', label: 'Subgraph', icon: '◈' },
];
const __VLS_emit = defineEmits();
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "canvas-aside node-panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "aside-title" },
});
for (const [t] of __VLS_getVForSourceType((__VLS_ctx.types))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.$emit('add', t.type);
            } },
        key: (t.type),
        ...{ class: "aside-item" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "ic" },
    });
    (t.icon);
    (t.label);
}
/** @type {__VLS_StyleScopedClasses['canvas-aside']} */ ;
/** @type {__VLS_StyleScopedClasses['node-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['aside-title']} */ ;
/** @type {__VLS_StyleScopedClasses['aside-item']} */ ;
/** @type {__VLS_StyleScopedClasses['ic']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            types: types,
        };
    },
    __typeEmits: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeEmits: {},
});
; /* PartiallyEnd: #4569/main.vue */
