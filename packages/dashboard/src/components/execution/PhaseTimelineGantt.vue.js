/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/components/execution/PhaseTimelineGantt.vue
// phase 产出物甘特（spec §9.1 自研 MVP）：列 node_id × 迭代，行级 diff/PR/测试/审查/编译结果
// token 量叠加按 spec §9.4 裁定：execution 级聚合已有（graph_executions.token_in/out），节点级无数据源——不造，省略
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
const props = defineProps();
const outputs = ref([]);
const state = ref('idle');
const stateLabel = ref('未加载');
function setState(s) {
    state.value = s;
    stateLabel.value = s === 'loading' ? '加载中' : s === 'error' ? '加载错误' : '未加载';
}
function fmtTime(t) {
    if (!t)
        return '-';
    try {
        return new Date(t).toLocaleString('zh-CN', { hour12: false });
    }
    catch {
        return t;
    }
}
function fmtFileChanges(fc) {
    if (!fc)
        return '-';
    try {
        const a = Array.isArray(fc) ? fc : [fc];
        const n = a.length;
        const paths = a.map((x) => typeof x === 'string' ? x : (x?.path || x?.file || JSON.stringify(x))).filter(Boolean);
        if (paths.length <= 2)
            return paths.join(', ');
        return `${paths.slice(0, 2).join(', ')} +${paths.length - 2}`;
    }
    catch {
        return String(fc).slice(0, 30);
    }
}
function fmtResult(r) {
    if (r == null)
        return '-';
    try {
        if (typeof r === 'boolean')
            return r ? '通过' : '失败';
        if (typeof r === 'object') {
            const status = r.status || r.pass || r.success;
            if (status != null)
                return status ? '通过' : '失败';
            return r.summary || r.message || JSON.stringify(r).slice(0, 24);
        }
        return String(r).slice(0, 24);
    }
    catch {
        return String(r);
    }
}
function cellClass(r) {
    if (r == null)
        return '';
    let ok = false;
    if (typeof r === 'boolean')
        ok = r;
    else if (typeof r === 'object')
        ok = r.status === 'pass' || r.status === 'success' || r.pass === true || r.success === true;
    return ok ? 'gnt-ok' : 'gnt-fail';
}
function showDiff(o) {
    ElMessage({ message: o.diff_content || '(空 diff)', type: 'info', duration: 5000, showClose: true });
}
async function load(id) {
    if (!id) {
        outputs.value = [];
        setState('idle');
        return;
    }
    setState('loading');
    outputs.value = [];
    try {
        const r = await fetch(`/api/executions/${encodeURIComponent(id)}/outputs`);
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const list = await r.json();
        outputs.value = Array.isArray(list) ? list : [];
        setState('idle');
    }
    catch {
        setState('error');
    }
}
watch(() => props.executionId, (id) => load(id || ''), { immediate: true });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['gnt-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-table']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-table']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-table']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-diff']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-pr']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-cell']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-cell']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "gnt-wrap" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "gnt-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "gnt-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "gnt-meta" },
    ...{ class: (__VLS_ctx.state) },
});
(__VLS_ctx.stateLabel);
if (__VLS_ctx.outputs.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "gnt-count" },
    });
    (__VLS_ctx.outputs.length);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "gnt-body" },
});
if (!__VLS_ctx.outputs.length && __VLS_ctx.state === 'idle') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "gnt-empty" },
    });
}
else if (!__VLS_ctx.outputs.length && __VLS_ctx.state === 'loading') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "gnt-empty" },
    });
}
else if (!__VLS_ctx.outputs.length && __VLS_ctx.state === 'error') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "gnt-empty" },
    });
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.table, __VLS_intrinsicElements.table)({
        ...{ class: "gnt-table" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.thead, __VLS_intrinsicElements.thead)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.tr, __VLS_intrinsicElements.tr)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.tbody, __VLS_intrinsicElements.tbody)({});
    for (const [o, i] of __VLS_getVForSourceType((__VLS_ctx.outputs))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.tr, __VLS_intrinsicElements.tr)({
            key: (i),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-node" },
            title: (o.node_id),
        });
        (o.node_id);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-iter" },
        });
        (o.iteration);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-fc" },
        });
        (__VLS_ctx.fmtFileChanges(o.file_changes));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-diff" },
        });
        if (o.diff_content) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.outputs.length && __VLS_ctx.state === 'idle'))
                            return;
                        if (!!(!__VLS_ctx.outputs.length && __VLS_ctx.state === 'loading'))
                            return;
                        if (!!(!__VLS_ctx.outputs.length && __VLS_ctx.state === 'error'))
                            return;
                        if (!(o.diff_content))
                            return;
                        __VLS_ctx.showDiff(o);
                    } },
                href: "javascript:void(0)",
            });
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-pr" },
        });
        if (o.pr_url) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
                href: (o.pr_url),
                target: "_blank",
                rel: "noopener",
            });
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-cell" },
            ...{ class: (__VLS_ctx.cellClass(o.test_result)) },
        });
        (__VLS_ctx.fmtResult(o.test_result));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-cell" },
            ...{ class: (__VLS_ctx.cellClass(o.review_result)) },
        });
        (__VLS_ctx.fmtResult(o.review_result));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-cell" },
            ...{ class: (__VLS_ctx.cellClass(o.compile_result)) },
        });
        (__VLS_ctx.fmtResult(o.compile_result));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "gnt-ts" },
        });
        (__VLS_ctx.fmtTime(o.created_at));
    }
}
/** @type {__VLS_StyleScopedClasses['gnt-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-header']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-title']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-count']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-body']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-table']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-node']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-iter']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-fc']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-diff']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-pr']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-cell']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-cell']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-cell']} */ ;
/** @type {__VLS_StyleScopedClasses['gnt-ts']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            outputs: outputs,
            state: state,
            stateLabel: stateLabel,
            fmtTime: fmtTime,
            fmtFileChanges: fmtFileChanges,
            fmtResult: fmtResult,
            cellClass: cellClass,
            showDiff: showDiff,
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
