/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/components/drawers/LogDrawer.vue —— 日志抽屉（照 framework LogDrawer.vue，适配 V2）
// SSE 接 /api/executions/:id/stream 显示事件流 + rate_limited_until 退避倒计时
import { ref, computed, watch, onUnmounted } from 'vue';
import { showLogDrawer, closeLogDrawer, currentExecId, currentRateLimitedUntil, currentStatus, } from '../../stores/tasks';
const logs = ref([]);
const now = ref(Date.now());
let es = null;
let tick = null;
let keySeq = 0;
// rate_limited 退避倒计时
const countdownText = computed(() => {
    if (currentStatus.value !== 'rate_limited' || !currentRateLimitedUntil.value)
        return null;
    const ms = new Date(currentRateLimitedUntil.value).getTime() - now.value;
    if (ms <= 0)
        return '即将重试';
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m} 分 ${sec} 秒后重试` : `${sec} 秒后重试`;
});
function nowStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
function openStream() {
    closeStream();
    const execId = currentExecId.value;
    if (!execId)
        return;
    try {
        es = new EventSource(`/api/executions/${encodeURIComponent(execId)}/stream`);
        es.onmessage = (m) => {
            try {
                const d = JSON.parse(m.data);
                logs.value.push({ ts: nowStr(), node_id: d.node_id, type: d.type, text: d.text, seq: keySeq++ });
                if (logs.value.length > 200)
                    logs.value = logs.value.slice(-200);
            }
            catch { /* 忽略坏帧 */ }
        };
    }
    catch {
        // EventSource 构造失败，忽略
    }
}
function closeStream() {
    if (es) {
        es.close();
        es = null;
    }
    logs.value = [];
}
// 倒序显示（最新在上）
const logsDesc = computed(() => [...logs.value].reverse());
// 抽屉打开/关闭
watch(showLogDrawer, (open) => {
    if (open) {
        openStream();
        tick = setInterval(() => { now.value = Date.now(); }, 1000);
    }
    else {
        closeStream();
        if (tick) {
            clearInterval(tick);
            tick = null;
        }
    }
});
onUnmounted(() => {
    closeStream();
    if (tick)
        clearInterval(tick);
});
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
    ...{ 'onClose': {} },
    modelValue: (__VLS_ctx.showLogDrawer),
    title: "执行日志",
    size: "720px",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onClose': {} },
    modelValue: (__VLS_ctx.showLogDrawer),
    title: "执行日志",
    size: "720px",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onClose: (__VLS_ctx.closeLogDrawer)
};
var __VLS_8 = {};
__VLS_3.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "muted" },
});
(__VLS_ctx.logs.length);
if (__VLS_ctx.currentExecId) {
    const __VLS_9 = {}.ElTag;
    /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
    // @ts-ignore
    const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({
        size: "small",
        type: "info",
    }));
    const __VLS_11 = __VLS_10({
        size: "small",
        type: "info",
    }, ...__VLS_functionalComponentArgsRest(__VLS_10));
    __VLS_12.slots.default;
    (__VLS_ctx.currentExecId);
    var __VLS_12;
}
if (__VLS_ctx.countdownText) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "rate-limit-banner" },
    });
    (__VLS_ctx.countdownText);
}
if (__VLS_ctx.logs.length === 0) {
    const __VLS_13 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
        description: "暂无日志",
    }));
    const __VLS_15 = __VLS_14({
        description: "暂无日志",
    }, ...__VLS_functionalComponentArgsRest(__VLS_14));
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "log-list" },
    });
    for (const [l] of __VLS_getVForSourceType((__VLS_ctx.logsDesc))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (l.seq),
            ...{ class: "log-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "log-meta" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "log-time" },
        });
        (l.ts);
        const __VLS_17 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({
            size: "small",
            type: "info",
        }));
        const __VLS_19 = __VLS_18({
            size: "small",
            type: "info",
        }, ...__VLS_functionalComponentArgsRest(__VLS_18));
        __VLS_20.slots.default;
        (l.node_id);
        var __VLS_20;
        if (l.type === 'done') {
            const __VLS_21 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
                size: "small",
                type: "success",
            }));
            const __VLS_23 = __VLS_22({
                size: "small",
                type: "success",
            }, ...__VLS_functionalComponentArgsRest(__VLS_22));
            __VLS_24.slots.default;
            var __VLS_24;
        }
        if (l.text) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                ...{ class: "log-msg" },
            });
            (l.text);
        }
    }
}
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['rate-limit-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['log-list']} */ ;
/** @type {__VLS_StyleScopedClasses['log-item']} */ ;
/** @type {__VLS_StyleScopedClasses['log-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['log-time']} */ ;
/** @type {__VLS_StyleScopedClasses['log-msg']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            showLogDrawer: showLogDrawer,
            closeLogDrawer: closeLogDrawer,
            currentExecId: currentExecId,
            logs: logs,
            countdownText: countdownText,
            logsDesc: logsDesc,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
