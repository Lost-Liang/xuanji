/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// packages/dashboard/src/views/ConversationView.vue —— 对话历史查看
//
// 根据 sessionId 查询 conversation_events 表，按时间线展示：
// - model_delta:   Assistant 输出的 token（合并为连续文本块）
// - tool_started:  工具调用开始（展示工具名 + 输入）
// - tool_completed: 工具调用完成（展示输出摘要）
// - inbox_ask:     Agent 向人类提问
// - inbox_answer:  人类回答
// - error:         错误事件
//
// 底部提供 followup 输入框，调用 POST /api/conversations/session/:sessionId/followup
// 通过 --resume 恢复已有会话，让 Agent 继续处理人类的新消息。
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { conversationsApi } from '../api/conversations';
const route = useRoute();
const router = useRouter();
// ─── 路由参数 ──────────────────────────────────────────────────────────────────
const sessionId = computed(() => String(route.params.sessionId ?? ''));
// ─── 状态 ──────────────────────────────────────────────────────────────────────
const events = ref([]);
const loading = ref(false);
const followupText = ref('');
const followupBusy = ref(false);
const executionId = ref(null);
const autoRefresh = ref(true);
let refreshTimer = null;
// ─── 数据加载 ──────────────────────────────────────────────────────────────────
async function loadEvents() {
    if (!sessionId.value)
        return;
    loading.value = true;
    try {
        const list = await conversationsApi.getEvents(sessionId.value);
        events.value = list;
        // 从第一条有 executionId 的事件中提取，供 followup 使用
        if (!executionId.value) {
            const withExec = list.find(e => e.executionId);
            if (withExec)
                executionId.value = withExec.executionId;
        }
    }
    catch (err) {
        ElMessage.error(`加载对话历史失败: ${err.message}`);
    }
    finally {
        loading.value = false;
    }
}
const timeline = computed(() => {
    const items = [];
    let i = 0;
    const evs = events.value;
    while (i < evs.length) {
        const e = evs[i];
        if (e.eventType === 'model_delta') {
            // 合并相邻的 model_delta 事件
            const group = [e];
            let j = i + 1;
            while (j < evs.length && evs[j].eventType === 'model_delta') {
                group.push(evs[j]);
                j++;
            }
            const text = group
                .map(ev => {
                const p = ev.payload;
                return p?.text ?? p?.content ?? p?.delta ?? '';
            })
                .join('');
            items.push({
                key: `text-${e.id}`,
                type: 'text',
                timestamp: e.createdAt,
                events: group,
                text,
                role: e.role ?? 'assistant',
                nodeClass: 'node-text',
                nodeType: 'primary',
            });
            i = j;
            continue;
        }
        if (e.eventType === 'model_started') {
            items.push({
                key: `start-${e.id}`,
                type: 'system',
                timestamp: e.createdAt,
                events: [e],
                message: '模型开始生成',
                nodeClass: 'node-system',
                nodeType: 'info',
            });
            i++;
            continue;
        }
        if (e.eventType === 'tool_started' || e.eventType === 'tool_completed') {
            // 尝试配对 tool_started + tool_completed
            if (e.eventType === 'tool_started') {
                const pair = [e];
                const next = evs[i + 1];
                if (next && next.eventType === 'tool_completed') {
                    pair.push(next);
                    i += 2;
                }
                else {
                    i++;
                }
                const p0 = e.payload;
                const p1 = pair[1]?.payload;
                items.push({
                    key: `tool-${e.id}`,
                    type: 'tool',
                    timestamp: e.createdAt,
                    events: pair,
                    toolName: p0?.name ?? p0?.toolName ?? 'unknown_tool',
                    toolInput: truncate(JSON.stringify(p0?.input ?? p0?.parameters ?? {}), 400),
                    toolOutput: p1 ? truncate(JSON.stringify(p1?.output ?? p1?.result ?? {}), 400) : undefined,
                    nodeClass: 'node-tool',
                    nodeType: 'warning',
                });
                continue;
            }
            // 单独的 tool_completed
            const p = e.payload;
            items.push({
                key: `tool-${e.id}`,
                type: 'tool',
                timestamp: e.createdAt,
                events: [e],
                toolName: p?.name ?? p?.toolName ?? 'unknown_tool',
                toolOutput: truncate(JSON.stringify(p?.output ?? p?.result ?? {}), 400),
                nodeClass: 'node-tool',
                nodeType: 'warning',
            });
            i++;
            continue;
        }
        if (e.eventType === 'inbox_ask') {
            const p = e.payload;
            items.push({
                key: `ask-${e.id}`,
                type: 'inbox_ask',
                timestamp: e.createdAt,
                events: [e],
                message: p?.question ?? p?.body ?? p?.text ?? '(Agent 提问)',
                nodeClass: 'node-inbox',
                nodeType: 'warning',
            });
            i++;
            continue;
        }
        if (e.eventType === 'inbox_answer') {
            const p = e.payload;
            items.push({
                key: `ans-${e.id}`,
                type: 'inbox_answer',
                timestamp: e.createdAt,
                events: [e],
                message: p?.answer ?? p?.text ?? '(人类回答)',
                role: 'user',
                nodeClass: 'node-user',
                nodeType: 'success',
            });
            i++;
            continue;
        }
        if (e.eventType === 'error') {
            const p = e.payload;
            items.push({
                key: `err-${e.id}`,
                type: 'error',
                timestamp: e.createdAt,
                events: [e],
                message: p?.message ?? p?.error ?? '(错误)',
                nodeClass: 'node-error',
                nodeType: 'danger',
            });
            i++;
            continue;
        }
        if (e.eventType === 'final_output') {
            const p = e.payload;
            items.push({
                key: `final-${e.id}`,
                type: 'final',
                timestamp: e.createdAt,
                events: [e],
                text: p?.output ?? p?.text ?? '',
                nodeClass: 'node-final',
                nodeType: 'success',
            });
            i++;
            continue;
        }
        // 兜底：其他类型作为系统事件
        items.push({
            key: `sys-${e.id}`,
            type: 'system',
            timestamp: e.createdAt,
            events: [e],
            message: `${e.eventType}`,
            nodeClass: 'node-system',
            nodeType: 'info',
        });
        i++;
    }
    return items;
});
function truncate(s, max) {
    if (!s)
        return '';
    return s.length > max ? s.slice(0, max) + '…' : s;
}
function formatTime(ts) {
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString('zh-CN', { hour12: false });
    }
    catch {
        return ts;
    }
}
// ─── 人类追问 ──────────────────────────────────────────────────────────────────
async function submitFollowup() {
    const message = followupText.value.trim();
    if (!message) {
        ElMessage.warning('请输入追问内容');
        return;
    }
    if (!executionId.value) {
        ElMessage.error('无法确定关联的执行实例，无法追问');
        return;
    }
    followupBusy.value = true;
    try {
        const res = await conversationsApi.followup(sessionId.value, executionId.value, message);
        followupText.value = '';
        if (res.success) {
            ElMessage.success('追问已发送');
            // 立即刷新对话历史
            await loadEvents();
        }
        else {
            ElMessage.warning(`追问已处理，但 Agent 未返回输出`);
        }
    }
    catch (err) {
        ElMessage.error(`追问失败: ${err.message}`);
    }
    finally {
        followupBusy.value = false;
    }
}
// ─── 导航 ──────────────────────────────────────────────────────────────────────
function goBack() {
    router.back();
}
// ─── 生命周期 ──────────────────────────────────────────────────────────────────
watch(sessionId, () => {
    executionId.value = null;
    events.value = [];
    loadEvents();
});
onMounted(() => {
    loadEvents();
    // 每 3 秒自动刷新（对话进行中体验更好）
    refreshTimer = setInterval(() => {
        if (autoRefresh.value && !loading.value) {
            loadEvents();
        }
    }, 3000);
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['conversation-view']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['timeline-wrap']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "conversation-view" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-left" },
});
const __VLS_0 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onClick': {} },
    text: true,
}));
const __VLS_2 = __VLS_1({
    ...{ 'onClick': {} },
    text: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onClick: (__VLS_ctx.goBack)
};
__VLS_3.slots.default;
var __VLS_3;
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "mono-id" },
    title: (__VLS_ctx.sessionId),
});
(__VLS_ctx.sessionId.slice(-12));
if (__VLS_ctx.events.length) {
    const __VLS_8 = {}.ElTag;
    /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
    // @ts-ignore
    const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
        size: "small",
        type: "info",
        effect: "plain",
    }));
    const __VLS_10 = __VLS_9({
        size: "small",
        type: "info",
        effect: "plain",
    }, ...__VLS_functionalComponentArgsRest(__VLS_9));
    __VLS_11.slots.default;
    (__VLS_ctx.events.length);
    var __VLS_11;
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-right" },
});
const __VLS_12 = {}.ElSwitch;
/** @type {[typeof __VLS_components.ElSwitch, typeof __VLS_components.elSwitch, ]} */ ;
// @ts-ignore
const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
    modelValue: (__VLS_ctx.autoRefresh),
    activeText: "自动刷新",
    size: "small",
}));
const __VLS_14 = __VLS_13({
    modelValue: (__VLS_ctx.autoRefresh),
    activeText: "自动刷新",
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_13));
const __VLS_16 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}));
const __VLS_18 = __VLS_17({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_17));
let __VLS_20;
let __VLS_21;
let __VLS_22;
const __VLS_23 = {
    onClick: (__VLS_ctx.loadEvents)
};
__VLS_19.slots.default;
var __VLS_19;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "timeline-wrap" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading && !__VLS_ctx.events.length) }, null, null);
if (!__VLS_ctx.events.length && !__VLS_ctx.loading) {
    const __VLS_24 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
        description: "暂无对话记录",
    }));
    const __VLS_26 = __VLS_25({
        description: "暂无对话记录",
    }, ...__VLS_functionalComponentArgsRest(__VLS_25));
}
else {
    const __VLS_28 = {}.ElTimeline;
    /** @type {[typeof __VLS_components.ElTimeline, typeof __VLS_components.elTimeline, typeof __VLS_components.ElTimeline, typeof __VLS_components.elTimeline, ]} */ ;
    // @ts-ignore
    const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({}));
    const __VLS_30 = __VLS_29({}, ...__VLS_functionalComponentArgsRest(__VLS_29));
    __VLS_31.slots.default;
    for (const [item] of __VLS_getVForSourceType((__VLS_ctx.timeline))) {
        const __VLS_32 = {}.ElTimelineItem;
        /** @type {[typeof __VLS_components.ElTimelineItem, typeof __VLS_components.elTimelineItem, typeof __VLS_components.ElTimelineItem, typeof __VLS_components.elTimelineItem, ]} */ ;
        // @ts-ignore
        const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
            key: (item.key),
            timestamp: (__VLS_ctx.formatTime(item.timestamp)),
            type: (item.nodeType),
            placement: "top",
        }));
        const __VLS_34 = __VLS_33({
            key: (item.key),
            timestamp: (__VLS_ctx.formatTime(item.timestamp)),
            type: (item.nodeType),
            placement: "top",
        }, ...__VLS_functionalComponentArgsRest(__VLS_33));
        __VLS_35.slots.default;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "tl-card" },
            ...{ class: (item.nodeClass) },
        });
        if (item.type === 'text') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-text" },
            });
            (item.text);
        }
        else if (item.type === 'tool') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.code, __VLS_intrinsicElements.code)({});
            (item.toolName);
            if (item.toolInput) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "tl-block" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "tl-block-label" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                    ...{ class: "tl-pre" },
                });
                (item.toolInput);
            }
            if (item.toolOutput !== undefined) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "tl-block" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "tl-block-label" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                    ...{ class: "tl-pre" },
                });
                (item.toolOutput);
            }
        }
        else if (item.type === 'inbox_ask') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-text" },
            });
            (item.message);
        }
        else if (item.type === 'inbox_answer') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-text" },
            });
            (item.message);
        }
        else if (item.type === 'final') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-text tl-final" },
            });
            (item.text);
        }
        else if (item.type === 'error') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role tl-error" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-text tl-error-text" },
            });
            (item.message);
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "tl-role tl-muted" },
            });
            (item.message);
        }
        var __VLS_35;
    }
    var __VLS_31;
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "followup-bar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "followup-label" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
if (!__VLS_ctx.executionId) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "hint" },
    });
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "hint" },
    });
}
const __VLS_36 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
    ...{ 'onKeydown': {} },
    ...{ 'onKeydown': {} },
    modelValue: (__VLS_ctx.followupText),
    type: "textarea",
    rows: (3),
    placeholder: "输入你想让 Agent 继续处理的内容…",
    disabled: (__VLS_ctx.followupBusy || !__VLS_ctx.executionId),
}));
const __VLS_38 = __VLS_37({
    ...{ 'onKeydown': {} },
    ...{ 'onKeydown': {} },
    modelValue: (__VLS_ctx.followupText),
    type: "textarea",
    rows: (3),
    placeholder: "输入你想让 Agent 继续处理的内容…",
    disabled: (__VLS_ctx.followupBusy || !__VLS_ctx.executionId),
}, ...__VLS_functionalComponentArgsRest(__VLS_37));
let __VLS_40;
let __VLS_41;
let __VLS_42;
const __VLS_43 = {
    onKeydown: (__VLS_ctx.submitFollowup)
};
const __VLS_44 = {
    onKeydown: (__VLS_ctx.submitFollowup)
};
var __VLS_39;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "followup-actions" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "hint" },
});
const __VLS_45 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.followupBusy),
    disabled: (!__VLS_ctx.followupText.trim() || !__VLS_ctx.executionId),
}));
const __VLS_47 = __VLS_46({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.followupBusy),
    disabled: (!__VLS_ctx.followupText.trim() || !__VLS_ctx.executionId),
}, ...__VLS_functionalComponentArgsRest(__VLS_46));
let __VLS_49;
let __VLS_50;
let __VLS_51;
const __VLS_52 = {
    onClick: (__VLS_ctx.submitFollowup)
};
__VLS_48.slots.default;
var __VLS_48;
/** @type {__VLS_StyleScopedClasses['conversation-view']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-left']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['mono-id']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-right']} */ ;
/** @type {__VLS_StyleScopedClasses['timeline-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-block']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-pre']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-block']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-pre']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-final']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-error']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-error-text']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-role']} */ ;
/** @type {__VLS_StyleScopedClasses['tl-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['followup-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['followup-label']} */ ;
/** @type {__VLS_StyleScopedClasses['hint']} */ ;
/** @type {__VLS_StyleScopedClasses['hint']} */ ;
/** @type {__VLS_StyleScopedClasses['followup-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['hint']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            sessionId: sessionId,
            events: events,
            loading: loading,
            followupText: followupText,
            followupBusy: followupBusy,
            executionId: executionId,
            autoRefresh: autoRefresh,
            loadEvents: loadEvents,
            timeline: timeline,
            formatTime: formatTime,
            submitFollowup: submitFollowup,
            goBack: goBack,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
