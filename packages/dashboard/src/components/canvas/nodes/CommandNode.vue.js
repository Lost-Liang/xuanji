/// <reference types="../../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { Handle, Position } from '@vue-flow/core';
const __VLS_props = defineProps();
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "vf-node t-command" },
    ...{ class: (['st-' + (__VLS_ctx.data.status || 'pending'), { sel: __VLS_ctx.selected }]) },
});
const __VLS_0 = {}.Handle;
/** @type {[typeof __VLS_components.Handle, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    type: "target",
    position: (__VLS_ctx.Position.Left),
}));
const __VLS_2 = __VLS_1({
    type: "target",
    position: (__VLS_ctx.Position.Left),
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "vn-kind" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "vn-ic" },
});
(__VLS_ctx.data.status || 'pending');
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "vn-lbl" },
});
(__VLS_ctx.data.label || 'command');
if (__VLS_ctx.data.command) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "vn-sub" },
    });
    (__VLS_ctx.data.command);
}
if (__VLS_ctx.data.badge) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "vn-badge" },
    });
    (__VLS_ctx.data.badge);
}
const __VLS_4 = {}.Handle;
/** @type {[typeof __VLS_components.Handle, ]} */ ;
// @ts-ignore
const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
    type: "source",
    position: (__VLS_ctx.Position.Right),
}));
const __VLS_6 = __VLS_5({
    type: "source",
    position: (__VLS_ctx.Position.Right),
}, ...__VLS_functionalComponentArgsRest(__VLS_5));
/** @type {__VLS_StyleScopedClasses['vf-node']} */ ;
/** @type {__VLS_StyleScopedClasses['t-command']} */ ;
/** @type {__VLS_StyleScopedClasses['vn-kind']} */ ;
/** @type {__VLS_StyleScopedClasses['vn-ic']} */ ;
/** @type {__VLS_StyleScopedClasses['vn-lbl']} */ ;
/** @type {__VLS_StyleScopedClasses['vn-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['vn-badge']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            Handle: Handle,
            Position: Position,
        };
    },
    __typeProps: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeProps: {},
});
; /* PartiallyEnd: #4569/main.vue */
