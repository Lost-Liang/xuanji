/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/components/drawers/ChatDrawer.vue —— 对话抽屉（照 framework ChatDrawer.vue，适配 V2）
// SSE 接 /api/sessions/:refId/stream；POST /api/sessions/:refId/chat 乐观更新
import { ref, watch, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { showChatDrawer, closeChatDrawer, currentExecId, currentSessionRefId, } from '../../stores/tasks';
import { api } from '../../api/tasks';
const messages = ref([]);
const newMsg = ref('');
const sending = ref(false);
let es = null;
function openStream() {
    closeStream();
    const refId = currentSessionRefId.value;
    if (!refId)
        return;
    try {
        es = new EventSource(`/api/sessions/${encodeURIComponent(refId)}/stream`);
        es.onmessage = (m) => {
            try {
                const d = JSON.parse(m.data);
                if (d.type === 'token' && d.text) {
                    // 追加到最后一条 assistant 消息（或新建）
                    const last = messages.value[messages.value.length - 1];
                    if (last && last.role === 'assistant') {
                        last.content += d.text;
                    }
                    else {
                        messages.value.push({ role: 'assistant', content: d.text });
                    }
                }
                else if (d.type === 'done') {
                    // 流结束，不做额外操作
                }
            }
            catch { /* 忽略坏帧 */ }
        };
        es.onerror = () => {
            // EventSource 自动重连，仅在 closed 时提示
            if (es && es.readyState === EventSource.CLOSED) {
                ElMessage.warning('SSE 连接断开');
            }
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
    messages.value = [];
}
// 抽屉打开/关闭时管理 SSE
watch(showChatDrawer, (open) => {
    if (open) {
        openStream();
    }
    else {
        closeStream();
    }
});
onUnmounted(closeStream);
async function sendMsg() {
    const text = newMsg.value.trim();
    if (!text || sending.value || !currentSessionRefId.value)
        return;
    // 乐观更新：先显示用户消息
    const idx = messages.value.push({ role: 'user', content: text }) - 1;
    newMsg.value = '';
    sending.value = true;
    try {
        await api.chat(currentSessionRefId.value, text);
    }
    catch (e) {
        ElMessage.error('发送失败');
        // 回滚乐观更新：精准删除刚 push 的消息
        messages.value.splice(idx, 1);
    }
    finally {
        sending.value = false;
    }
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['chat-item']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-item']} */ ;
/** @type {__VLS_StyleScopedClasses['user']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-bubble']} */ ;
// CSS variable injection 
// CSS variable injection end 
const __VLS_0 = {}.ElDrawer;
/** @type {[typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onClose': {} },
    modelValue: (__VLS_ctx.showChatDrawer),
    title: "对话",
    size: "560px",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onClose': {} },
    modelValue: (__VLS_ctx.showChatDrawer),
    title: "对话",
    size: "560px",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onClose: (__VLS_ctx.closeChatDrawer)
};
var __VLS_8 = {};
__VLS_3.slots.default;
if (__VLS_ctx.currentExecId) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "subtitle" },
    });
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
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "chat-list" },
});
if (__VLS_ctx.messages.length === 0 && !__VLS_ctx.currentSessionRefId) {
    const __VLS_13 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
        description: "无可用 session，无法对话",
        imageSize: (80),
    }));
    const __VLS_15 = __VLS_14({
        description: "无可用 session，无法对话",
        imageSize: (80),
    }, ...__VLS_functionalComponentArgsRest(__VLS_14));
}
else if (__VLS_ctx.messages.length === 0) {
    const __VLS_17 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({
        description: "还没有对话，输入一条指令开始吧",
        imageSize: (80),
    }));
    const __VLS_19 = __VLS_18({
        description: "还没有对话，输入一条指令开始吧",
        imageSize: (80),
    }, ...__VLS_functionalComponentArgsRest(__VLS_18));
}
else {
    for (const [msg, i] of __VLS_getVForSourceType((__VLS_ctx.messages))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (i),
            ...{ class: (['chat-item', msg.role]) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "chat-bubble" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "chat-role" },
        });
        (msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '系统');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "chat-text" },
        });
        (msg.content);
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "chat-input" },
});
const __VLS_21 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
    ...{ 'onKeyup': {} },
    modelValue: (__VLS_ctx.newMsg),
    placeholder: "输入消息，回车发送",
    disabled: (__VLS_ctx.sending || !__VLS_ctx.currentSessionRefId),
}));
const __VLS_23 = __VLS_22({
    ...{ 'onKeyup': {} },
    modelValue: (__VLS_ctx.newMsg),
    placeholder: "输入消息，回车发送",
    disabled: (__VLS_ctx.sending || !__VLS_ctx.currentSessionRefId),
}, ...__VLS_functionalComponentArgsRest(__VLS_22));
let __VLS_25;
let __VLS_26;
let __VLS_27;
const __VLS_28 = {
    onKeyup: (__VLS_ctx.sendMsg)
};
var __VLS_24;
const __VLS_29 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.sending),
    disabled: (!__VLS_ctx.currentSessionRefId),
}));
const __VLS_31 = __VLS_30({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.sending),
    disabled: (!__VLS_ctx.currentSessionRefId),
}, ...__VLS_functionalComponentArgsRest(__VLS_30));
let __VLS_33;
let __VLS_34;
let __VLS_35;
const __VLS_36 = {
    onClick: (__VLS_ctx.sendMsg)
};
__VLS_32.slots.default;
var __VLS_32;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['subtitle']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-list']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-bubble']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-role']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-text']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-input']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            showChatDrawer: showChatDrawer,
            closeChatDrawer: closeChatDrawer,
            currentExecId: currentExecId,
            currentSessionRefId: currentSessionRefId,
            messages: messages,
            newMsg: newMsg,
            sending: sending,
            sendMsg: sendMsg,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
