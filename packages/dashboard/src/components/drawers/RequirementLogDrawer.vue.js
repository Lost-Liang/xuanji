/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/components/drawers/RequirementLogDrawer.vue —— 需求日志抽屉
// 参考 framework RequirementLogDrawer.vue，适配本项目栈（展示 spec_content + session refs）
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api/requirements';
const props = defineProps();
const emit = defineEmits();
const detail = ref(null);
const loading = ref(false);
async function loadDetail() {
    if (!props.requirementId)
        return;
    loading.value = true;
    try {
        detail.value = await api.get(props.requirementId);
    }
    catch (e) {
        ElMessage.error(e?.message || '加载日志失败');
    }
    finally {
        loading.value = false;
    }
}
// 抽屉打开时加载
watch(() => props.modelValue, (open) => {
    if (open && props.requirementId)
        loadDetail();
});
function copySession(sessionId) {
    navigator.clipboard.writeText(sessionId).then(() => {
        ElMessage.success('session_id 已复制');
    });
}
function formatTime(ts) {
    if (!ts)
        return '-';
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
function statusText(status) {
    const map = {
        pending: '待执行', running: '执行中', completed: '已完成',
        failed: '失败', stopped: '已停止', cancelled: '已取消', paused: '已暂停',
    };
    return map[status || ''] || '未知';
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
// CSS variable injection 
// CSS variable injection end 
const __VLS_0 = {}.ElDrawer;
/** @type {[typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onUpdate:modelValue': {} },
    modelValue: (__VLS_ctx.modelValue),
    title: "需求日志",
    size: "720px",
    direction: "rtl",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onUpdate:modelValue': {} },
    modelValue: (__VLS_ctx.modelValue),
    title: "需求日志",
    size: "720px",
    direction: "rtl",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    'onUpdate:modelValue': (...[$event]) => {
        __VLS_ctx.emit('update:modelValue', $event);
    }
};
var __VLS_8 = {};
__VLS_3.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
if (__VLS_ctx.detail?.spec_content) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "log-block" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "section-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
        ...{ class: "spec-output" },
    });
    (__VLS_ctx.detail.spec_content);
}
if (__VLS_ctx.detail && __VLS_ctx.detail.session_refs.length > 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "log-block" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "section-label" },
    });
    for (const [s] of __VLS_getVForSourceType((__VLS_ctx.detail.session_refs))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (s.id),
            ...{ class: "session-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "session-meta" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "phase-name" },
        });
        (s.node_id);
        const __VLS_9 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({
            size: "small",
            type: (s.omnigent_status === 'running' ? 'warning' : 'info'),
        }));
        const __VLS_11 = __VLS_10({
            size: "small",
            type: (s.omnigent_status === 'running' ? 'warning' : 'info'),
        }, ...__VLS_functionalComponentArgsRest(__VLS_10));
        __VLS_12.slots.default;
        (__VLS_ctx.statusText(s.omnigent_status));
        var __VLS_12;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "muted" },
        });
        (s.iteration);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "session-id-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.code, __VLS_intrinsicElements.code)({
            ...{ class: "session-id" },
        });
        (s.omnigent_session_id || '（未匹配到 session）');
        if (s.omnigent_session_id) {
            const __VLS_13 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
                ...{ 'onClick': {} },
                size: "small",
                link: true,
                type: "primary",
            }));
            const __VLS_15 = __VLS_14({
                ...{ 'onClick': {} },
                size: "small",
                link: true,
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_14));
            let __VLS_17;
            let __VLS_18;
            let __VLS_19;
            const __VLS_20 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.detail && __VLS_ctx.detail.session_refs.length > 0))
                        return;
                    if (!(s.omnigent_session_id))
                        return;
                    __VLS_ctx.copySession(s.omnigent_session_id);
                }
            };
            __VLS_16.slots.default;
            var __VLS_16;
        }
    }
}
if (!__VLS_ctx.detail || (!__VLS_ctx.detail.spec_content && __VLS_ctx.detail.session_refs.length === 0)) {
    const __VLS_21 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
        description: "暂无日志",
    }));
    const __VLS_23 = __VLS_22({
        description: "暂无日志",
    }, ...__VLS_functionalComponentArgsRest(__VLS_22));
}
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['log-block']} */ ;
/** @type {__VLS_StyleScopedClasses['section-label']} */ ;
/** @type {__VLS_StyleScopedClasses['spec-output']} */ ;
/** @type {__VLS_StyleScopedClasses['log-block']} */ ;
/** @type {__VLS_StyleScopedClasses['section-label']} */ ;
/** @type {__VLS_StyleScopedClasses['session-item']} */ ;
/** @type {__VLS_StyleScopedClasses['session-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-name']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['session-id-row']} */ ;
/** @type {__VLS_StyleScopedClasses['session-id']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            emit: emit,
            detail: detail,
            loading: loading,
            copySession: copySession,
            statusText: statusText,
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
