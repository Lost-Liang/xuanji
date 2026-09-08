/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, watch, onUnmounted, computed } from 'vue';
import { marked } from 'marked';
const props = defineProps();
// Elicitation 状态
const pendingElicitations = ref([]);
const elicitAnswers = ref({});
const submittingIds = ref(new Set());
// 获取待回复的提问
async function fetchElicitations() {
    if (!props.executionId)
        return;
    try {
        const r = await fetch(`/api/executions/${props.executionId}/elicitations`);
        pendingElicitations.value = await r.json();
    }
    catch { /* 忽略 */ }
}
// 防双击：检查是否正在提交
function isSubmitting(id) {
    return submittingIds.value.has(id);
}
// 判断是否是对话类型
function isDialogType(elicit) {
    return elicit.id?.startsWith('dialog-') || !elicit.requested_schema;
}
// 提交回复
async function submitAnswer(elicit) {
    if (submittingIds.value.has(elicit.id))
        return;
    submittingIds.value.add(elicit.id);
    const answer = elicitAnswers.value[elicit.id];
    const message = typeof answer === 'string' ? answer.trim() : (answer?.text || '').trim();
    if (isDialogType(elicit)) {
        if (!message) {
            submittingIds.value.delete(elicit.id);
            return;
        }
        try {
            await fetch(`/api/executions/${props.executionId}/dialog`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
            delete elicitAnswers.value[elicit.id];
            await fetchElicitations();
        }
        catch { /* 忽略 */ }
        finally {
            submittingIds.value.delete(elicit.id);
        }
    }
    else {
        try {
            await fetch(`/api/executions/${props.executionId}/elicitations/${elicit.id}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer: { action: 'accept', content: answer } }),
            });
            delete elicitAnswers.value[elicit.id];
            await fetchElicitations();
        }
        catch { /* 忽略 */ }
        finally {
            submittingIds.value.delete(elicit.id);
        }
    }
}
// 跳过提问
async function skipElicitation(elicit) {
    if (submittingIds.value.has(elicit.id))
        return;
    submittingIds.value.add(elicit.id);
    if (isDialogType(elicit)) {
        try {
            await fetch(`/api/executions/${props.executionId}/dialog`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'skip' }),
            });
            await fetchElicitations();
        }
        catch { /* 忽略 */ }
        finally {
            submittingIds.value.delete(elicit.id);
        }
    }
    else {
        const idx = pendingElicitations.value.findIndex(e => e.id === elicit.id);
        if (idx !== -1)
            pendingElicitations.value.splice(idx, 1);
        submittingIds.value.delete(elicit.id);
    }
}
// 解析 requestedSchema
function parseSchema(schema) {
    if (!schema?.properties)
        return [];
    return Object.entries(schema.properties).map(([key, prop]) => ({
        key,
        label: key,
        type: prop.enum ? 'enum' : 'string',
        options: prop.enum,
    }));
}
const events = ref([]);
const state = ref('idle');
const bodyRef = ref(null);
let es = null;
const stateLabel = ref('未连接');
function setState(s) {
    state.value = s;
    stateLabel.value = s === 'open' ? '已连接' : s === 'error' ? '连接错误' : '未连接';
}
function nowStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
function timeFromISO(iso) {
    try {
        return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
    }
    catch {
        return nowStr();
    }
}
// 渲染 markdown
function renderMarkdown(text) {
    if (!text)
        return '';
    return marked.parse(text);
}
const messages = computed(() => {
    const result = [];
    // 如果有 pendingElicitations，不显示 inbox_ask 消息（避免重复）
    const hasPendingElicitations = pendingElicitations.value.length > 0;
    // 倒序遍历（events 本身是倒序的，最新的在前面）
    for (const e of events.value) {
        if (e.type === 'inbox_ask') {
            // 如果有 elicitations 显示区域，跳过消息列表中的显示
            if (!hasPendingElicitations) {
                result.push({
                    role: 'system',
                    roleLabel: '🤔 AI 提问',
                    ts: e.ts,
                    text: e.text || '',
                });
            }
        }
        else if (e.type === 'inbox_answer') {
            result.push({
                role: 'human',
                roleLabel: '👤 你的回答',
                ts: e.ts,
                text: e.text || '',
            });
        }
        else if (e.type === 'token' && e.text && e.text.length > 0) {
            result.push({
                role: 'assistant',
                roleLabel: '🤖 AI',
                ts: e.ts,
                text: e.text,
            });
        }
    }
    return result;
});
// SSE 处理
function open(id) {
    close();
    if (!id) {
        setState('idle');
        return;
    }
    // 先拉历史事件
    fetch(`/api/executions/${encodeURIComponent(id)}/events`)
        .then(r => r.json())
        .then((list) => {
        const agg = [];
        for (const e of list) {
            if (e.type === 'token') {
                const last = agg[agg.length - 1];
                if (last && last.type === 'token' && last.node_id === e.node_id) {
                    last.text = (last.text || '') + (e.text || '');
                    last.ts = timeFromISO(e.created_at);
                }
                else {
                    agg.push({ ts: timeFromISO(e.created_at), node_id: e.node_id, type: 'token', text: e.text || '' });
                }
            }
            else if (e.type === 'done') {
                agg.push({ ts: timeFromISO(e.created_at), node_id: e.node_id, type: 'done', text: e.text || '' });
            }
            else if (e.type === 'inbox_ask' || e.type === 'inbox_answer') {
                agg.push({ ts: timeFromISO(e.created_at), node_id: e.type, type: e.type, text: e.text || '' });
            }
        }
        events.value = agg.reverse();
        // 历史事件加载完成后，如果有数据，设置状态为 open
        if (agg.length > 0) {
            setState('open');
        }
    })
        .catch(() => { });
    try {
        es = new EventSource(`/api/executions/${encodeURIComponent(id)}/stream`);
        es.onopen = () => setState('open');
        es.onerror = () => {
            // SSE 关闭时不再设置 error，让 fetch('/events') 的结果决定状态
            // 如果执行已完成，SSE 会返回 execution_done 后关闭
            // 历史事件应该在 fetch 完成后正确显示
            if (es && es.readyState === EventSource.CLOSED) {
                // SSE 已关闭，但不要覆盖状态
                // 如果 fetch 还没完成，它会在完成后设置正确的状态
                // 如果 fetch 已经完成，events.value 已经有数据
            }
        };
        es.onmessage = (m) => {
            try {
                const d = JSON.parse(m.data);
                if (d.type === 'execution_done') {
                    setState('open');
                    if (d.status === 'waiting' || d.status === 'paused') {
                        fetchElicitations();
                    }
                    return;
                }
                if (d.type === 'done') {
                    events.value = [{ ts: nowStr(), node_id: d.node_id, type: 'done', text: d.text || '' }, ...events.value.slice(0, 199)];
                }
                else if (d.type === 'inbox_ask') {
                    // 去重：检查是否已存在相同文本的 inbox_ask
                    const exists = events.value.some(e => e.type === 'inbox_ask' && e.text === d.text);
                    if (!exists) {
                        events.value = [{ ts: nowStr(), node_id: d.type, type: d.type, text: d.text || '' }, ...events.value.slice(0, 199)];
                    }
                    // 收到提问时，获取问题详情（包含 choices）
                    fetchElicitations();
                }
                else if (d.type === 'inbox_answer') {
                    // 去重：检查是否已存在相同文本的 inbox_answer
                    const exists = events.value.some(e => e.type === 'inbox_answer' && e.text === d.text);
                    if (!exists) {
                        events.value = [{ ts: nowStr(), node_id: d.type, type: d.type, text: d.text || '' }, ...events.value.slice(0, 199)];
                    }
                }
                else if (d.type === 'token') {
                    const top = events.value[0];
                    if (top && top.type === 'token' && top.node_id === d.node_id) {
                        // 替换整个数组元素以触发响应式更新
                        events.value = [
                            { ...top, text: (top.text || '') + (d.text || ''), ts: nowStr() },
                            ...events.value.slice(1, 199)
                        ];
                    }
                    else {
                        events.value = [{ ts: nowStr(), node_id: d.node_id, type: 'token', text: d.text || '' }, ...events.value.slice(0, 199)];
                    }
                }
            }
            catch { /* 忽略坏帧 */ }
        };
    }
    catch {
        setState('error');
    }
}
function close() {
    if (es) {
        es.close();
        es = null;
    }
}
watch(() => props.executionId, (id) => {
    events.value = [];
    open(id || '');
    fetchElicitations();
}, { immediate: true });
onUnmounted(() => {
    close();
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['ls-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['open']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['message']} */ ;
/** @type {__VLS_StyleScopedClasses['message']} */ ;
/** @type {__VLS_StyleScopedClasses['message']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
/** @type {__VLS_StyleScopedClasses['choice-buttons']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "live-stream" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "ls-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "ls-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "ls-meta" },
    ...{ class: (__VLS_ctx.state) },
});
(__VLS_ctx.stateLabel);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "ls-body" },
    ref: "bodyRef",
});
/** @type {typeof __VLS_ctx.bodyRef} */ ;
for (const [elicit] of __VLS_getVForSourceType((__VLS_ctx.pendingElicitations))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        key: (elicit.id),
        ...{ class: "elicit-card" },
    });
    if (elicit.choices && elicit.choices.length > 0) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "elicit-choices" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "elicit-question" },
        });
        (elicit.body);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "choice-buttons" },
        });
        for (const [choice, idx] of __VLS_getVForSourceType((elicit.choices))) {
            const __VLS_0 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
                ...{ 'onClick': {} },
                key: (idx),
                type: (__VLS_ctx.elicitAnswers[elicit.id] === choice ? 'primary' : 'default'),
                size: "small",
            }));
            const __VLS_2 = __VLS_1({
                ...{ 'onClick': {} },
                key: (idx),
                type: (__VLS_ctx.elicitAnswers[elicit.id] === choice ? 'primary' : 'default'),
                size: "small",
            }, ...__VLS_functionalComponentArgsRest(__VLS_1));
            let __VLS_4;
            let __VLS_5;
            let __VLS_6;
            const __VLS_7 = {
                onClick: (...[$event]) => {
                    if (!(elicit.choices && elicit.choices.length > 0))
                        return;
                    __VLS_ctx.elicitAnswers[elicit.id] = choice;
                }
            };
            __VLS_3.slots.default;
            (choice);
            var __VLS_3;
        }
    }
    else if (elicit.requested_schema) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "elicit-form" },
        });
        const __VLS_8 = {}.ElForm;
        /** @type {[typeof __VLS_components.ElForm, typeof __VLS_components.elForm, typeof __VLS_components.ElForm, typeof __VLS_components.elForm, ]} */ ;
        // @ts-ignore
        const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
            model: (__VLS_ctx.elicitAnswers[elicit.id]),
            labelPosition: "top",
        }));
        const __VLS_10 = __VLS_9({
            model: (__VLS_ctx.elicitAnswers[elicit.id]),
            labelPosition: "top",
        }, ...__VLS_functionalComponentArgsRest(__VLS_9));
        __VLS_11.slots.default;
        for (const [field] of __VLS_getVForSourceType((__VLS_ctx.parseSchema(elicit.requested_schema)))) {
            const __VLS_12 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
                key: (field.key),
                label: (field.label),
            }));
            const __VLS_14 = __VLS_13({
                key: (field.key),
                label: (field.label),
            }, ...__VLS_functionalComponentArgsRest(__VLS_13));
            __VLS_15.slots.default;
            if (field.type === 'string') {
                const __VLS_16 = {}.ElInput;
                /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
                // @ts-ignore
                const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
                    modelValue: (__VLS_ctx.elicitAnswers[elicit.id][field.key]),
                }));
                const __VLS_18 = __VLS_17({
                    modelValue: (__VLS_ctx.elicitAnswers[elicit.id][field.key]),
                }, ...__VLS_functionalComponentArgsRest(__VLS_17));
            }
            else if (field.type === 'enum') {
                const __VLS_20 = {}.ElSelect;
                /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
                // @ts-ignore
                const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
                    modelValue: (__VLS_ctx.elicitAnswers[elicit.id][field.key]),
                }));
                const __VLS_22 = __VLS_21({
                    modelValue: (__VLS_ctx.elicitAnswers[elicit.id][field.key]),
                }, ...__VLS_functionalComponentArgsRest(__VLS_21));
                __VLS_23.slots.default;
                for (const [opt] of __VLS_getVForSourceType((field.options))) {
                    const __VLS_24 = {}.ElOption;
                    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                    // @ts-ignore
                    const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
                        key: (opt),
                        label: (opt),
                        value: (opt),
                    }));
                    const __VLS_26 = __VLS_25({
                        key: (opt),
                        label: (opt),
                        value: (opt),
                    }, ...__VLS_functionalComponentArgsRest(__VLS_25));
                }
                var __VLS_23;
            }
            var __VLS_15;
        }
        var __VLS_11;
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "elicit-input" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "elicit-question" },
        });
        (elicit.body);
        const __VLS_28 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            modelValue: (__VLS_ctx.elicitAnswers[elicit.id]),
            type: "textarea",
            rows: (3),
            placeholder: "输入回复...",
        }));
        const __VLS_30 = __VLS_29({
            modelValue: (__VLS_ctx.elicitAnswers[elicit.id]),
            type: "textarea",
            rows: (3),
            placeholder: "输入回复...",
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "elicit-actions" },
    });
    const __VLS_32 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
        ...{ 'onClick': {} },
        type: "primary",
        size: "small",
        loading: (__VLS_ctx.isSubmitting(elicit.id)),
        disabled: (__VLS_ctx.isSubmitting(elicit.id) || !__VLS_ctx.elicitAnswers[elicit.id]),
    }));
    const __VLS_34 = __VLS_33({
        ...{ 'onClick': {} },
        type: "primary",
        size: "small",
        loading: (__VLS_ctx.isSubmitting(elicit.id)),
        disabled: (__VLS_ctx.isSubmitting(elicit.id) || !__VLS_ctx.elicitAnswers[elicit.id]),
    }, ...__VLS_functionalComponentArgsRest(__VLS_33));
    let __VLS_36;
    let __VLS_37;
    let __VLS_38;
    const __VLS_39 = {
        onClick: (...[$event]) => {
            __VLS_ctx.submitAnswer(elicit);
        }
    };
    __VLS_35.slots.default;
    var __VLS_35;
    if (__VLS_ctx.isDialogType(elicit)) {
        const __VLS_40 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
            ...{ 'onClick': {} },
            size: "small",
            type: "warning",
            plain: true,
            loading: (__VLS_ctx.isSubmitting(elicit.id)),
            disabled: (__VLS_ctx.isSubmitting(elicit.id)),
        }));
        const __VLS_42 = __VLS_41({
            ...{ 'onClick': {} },
            size: "small",
            type: "warning",
            plain: true,
            loading: (__VLS_ctx.isSubmitting(elicit.id)),
            disabled: (__VLS_ctx.isSubmitting(elicit.id)),
        }, ...__VLS_functionalComponentArgsRest(__VLS_41));
        let __VLS_44;
        let __VLS_45;
        let __VLS_46;
        const __VLS_47 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.isDialogType(elicit)))
                    return;
                __VLS_ctx.skipElicitation(elicit);
            }
        };
        __VLS_43.slots.default;
        var __VLS_43;
    }
    else {
        const __VLS_48 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
            ...{ 'onClick': {} },
            size: "small",
            loading: (__VLS_ctx.isSubmitting(elicit.id)),
            disabled: (__VLS_ctx.isSubmitting(elicit.id)),
        }));
        const __VLS_50 = __VLS_49({
            ...{ 'onClick': {} },
            size: "small",
            loading: (__VLS_ctx.isSubmitting(elicit.id)),
            disabled: (__VLS_ctx.isSubmitting(elicit.id)),
        }, ...__VLS_functionalComponentArgsRest(__VLS_49));
        let __VLS_52;
        let __VLS_53;
        let __VLS_54;
        const __VLS_55 = {
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.isDialogType(elicit)))
                    return;
                __VLS_ctx.skipElicitation(elicit);
            }
        };
        __VLS_51.slots.default;
        var __VLS_51;
    }
}
if (!__VLS_ctx.messages.length && __VLS_ctx.state === 'idle') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "ls-empty" },
    });
}
else if (!__VLS_ctx.messages.length && __VLS_ctx.state === 'open') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "ls-empty" },
    });
}
else if (!__VLS_ctx.messages.length && __VLS_ctx.state === 'error') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "ls-empty" },
    });
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "message-list" },
});
for (const [msg, idx] of __VLS_getVForSourceType((__VLS_ctx.messages))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        key: (idx),
        ...{ class: "message" },
        ...{ class: (msg.role) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "msg-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "msg-role" },
    });
    (msg.roleLabel);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "msg-time" },
    });
    (msg.ts);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "msg-content" },
    });
    __VLS_asFunctionalDirective(__VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.renderMarkdown(msg.text)) }, null, null);
}
/** @type {__VLS_StyleScopedClasses['live-stream']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-header']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-title']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-body']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-card']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-choices']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-question']} */ ;
/** @type {__VLS_StyleScopedClasses['choice-buttons']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-form']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-input']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-question']} */ ;
/** @type {__VLS_StyleScopedClasses['elicit-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['ls-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['message-list']} */ ;
/** @type {__VLS_StyleScopedClasses['message']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-header']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-role']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-time']} */ ;
/** @type {__VLS_StyleScopedClasses['msg-content']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            pendingElicitations: pendingElicitations,
            elicitAnswers: elicitAnswers,
            isSubmitting: isSubmitting,
            isDialogType: isDialogType,
            submitAnswer: submitAnswer,
            skipElicitation: skipElicitation,
            parseSchema: parseSchema,
            state: state,
            bodyRef: bodyRef,
            stateLabel: stateLabel,
            renderMarkdown: renderMarkdown,
            messages: messages,
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
