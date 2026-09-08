/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/components/execution/StateTransitionDag.vue
// checkpoint 时间线游标：拖/点 checkpoint 定格 → 展示 snap.values 摘要（spec §9.4 回溯重放，只读不改 state）
// props 仅 executionId，内部 fetch（照 LiveEventStream 模式）
import { ref, computed, watch } from 'vue';
const props = defineProps();
const checkpoints = ref([]);
const activeIdx = ref(-1);
const state = ref('idle');
const stateLabel = ref('未加载');
const activeSnap = computed(() => activeIdx.value >= 0 ? checkpoints.value[activeIdx.value] : null);
const prettyValues = computed(() => {
    const v = activeSnap.value?.values;
    try {
        return v == null ? '(空)' : JSON.stringify(v, null, 2);
    }
    catch {
        return String(v);
    }
});
function setState(s) {
    state.value = s;
    stateLabel.value = s === 'loading' ? '加载中' : s === 'error' ? '加载错误' : '未加载';
}
function fmtTime(t) {
    if (!t)
        return '';
    try {
        return new Date(t).toLocaleString('zh-CN', { hour12: false });
    }
    catch {
        return t;
    }
}
async function load(id) {
    if (!id) {
        checkpoints.value = [];
        activeIdx.value = -1;
        setState('idle');
        return;
    }
    setState('loading');
    checkpoints.value = [];
    activeIdx.value = -1;
    try {
        const r = await fetch(`/api/executions/${encodeURIComponent(id)}/checkpoints`);
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const list = await r.json();
        checkpoints.value = Array.isArray(list) ? list : [];
        setState('idle');
        if (checkpoints.value.length)
            pick(0);
    }
    catch {
        setState('error');
    }
}
function pick(i) {
    activeIdx.value = i;
}
watch(() => props.executionId, (id) => load(id || ''), { immediate: true });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['std-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['std-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['std-cp']} */ ;
/** @type {__VLS_StyleScopedClasses['std-cp']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "std-wrap" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "std-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "std-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "std-meta" },
    ...{ class: (__VLS_ctx.state) },
});
(__VLS_ctx.stateLabel);
if (__VLS_ctx.checkpoints.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "std-count" },
    });
    (__VLS_ctx.checkpoints.length);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "std-body" },
});
if (!__VLS_ctx.checkpoints.length && __VLS_ctx.state === 'idle') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-empty" },
    });
}
else if (!__VLS_ctx.checkpoints.length && __VLS_ctx.state === 'loading') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-empty" },
    });
}
else if (!__VLS_ctx.checkpoints.length && __VLS_ctx.state === 'error') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-empty" },
    });
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-timeline" },
    });
    for (const [cp, i] of __VLS_getVForSourceType((__VLS_ctx.checkpoints))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.checkpoints.length && __VLS_ctx.state === 'idle'))
                        return;
                    if (!!(!__VLS_ctx.checkpoints.length && __VLS_ctx.state === 'loading'))
                        return;
                    if (!!(!__VLS_ctx.checkpoints.length && __VLS_ctx.state === 'error'))
                        return;
                    __VLS_ctx.pick(i);
                } },
            key: (cp.checkpoint_id),
            ...{ class: "std-cp" },
            ...{ class: ({ active: i === __VLS_ctx.activeIdx }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "std-idx" },
        });
        (i);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "std-next" },
            title: (cp.next?.join(',') || 'END'),
        });
        (cp.next?.length ? cp.next.join(',') : 'END');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "std-ts" },
        });
        (__VLS_ctx.fmtTime(cp.created_at));
    }
}
if (__VLS_ctx.activeSnap) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-snap" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-snap-h" },
    });
    (__VLS_ctx.activeIdx);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "std-snap-ts" },
    });
    (__VLS_ctx.fmtTime(__VLS_ctx.activeSnap.created_at));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
        ...{ class: "std-snap-v" },
    });
    (__VLS_ctx.prettyValues);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "std-snap-next" },
    });
    (__VLS_ctx.activeSnap.next?.length ? __VLS_ctx.activeSnap.next.join(', ') : '(END)');
}
/** @type {__VLS_StyleScopedClasses['std-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['std-header']} */ ;
/** @type {__VLS_StyleScopedClasses['std-title']} */ ;
/** @type {__VLS_StyleScopedClasses['std-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['std-count']} */ ;
/** @type {__VLS_StyleScopedClasses['std-body']} */ ;
/** @type {__VLS_StyleScopedClasses['std-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['std-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['std-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['std-timeline']} */ ;
/** @type {__VLS_StyleScopedClasses['std-cp']} */ ;
/** @type {__VLS_StyleScopedClasses['std-idx']} */ ;
/** @type {__VLS_StyleScopedClasses['std-next']} */ ;
/** @type {__VLS_StyleScopedClasses['std-ts']} */ ;
/** @type {__VLS_StyleScopedClasses['std-snap']} */ ;
/** @type {__VLS_StyleScopedClasses['std-snap-h']} */ ;
/** @type {__VLS_StyleScopedClasses['std-snap-ts']} */ ;
/** @type {__VLS_StyleScopedClasses['std-snap-v']} */ ;
/** @type {__VLS_StyleScopedClasses['std-snap-next']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            checkpoints: checkpoints,
            activeIdx: activeIdx,
            state: state,
            stateLabel: stateLabel,
            activeSnap: activeSnap,
            prettyValues: prettyValues,
            fmtTime: fmtTime,
            pick: pick,
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
