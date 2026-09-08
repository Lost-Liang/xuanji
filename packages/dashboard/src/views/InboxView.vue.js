/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// packages/dashboard/src/views/InboxView.vue —— 人机交互：待回答问题列表
//
// 轮询 GET /api/inbox/pending 获取 Agent 通过 inbox_ask 提出的待回答问题。
// 用户在表格行展开的回答表单中提交答案，Core 通过 notifyHumanAnswered() 解除
// agent-node 中 waitForHumanAnswer 的阻塞，Agent 在同一 CLI 会话中继续执行。
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { inboxApi } from '../api/inbox';
const router = useRouter();
// ─── 状态 ─────────────────────────────────────────────────────────────────────
const questions = ref([]);
const loading = ref(false);
const answeringIds = ref(new Set()); // 正在提交回答的问题 ID
const answerDrafts = ref({}); // 每个问题的回答草稿
const polling = ref(true);
let pollTimer = null;
const POLL_INTERVAL_MS = 5_000; // 轮询间隔 5 秒
// ─── 计算属性 ──────────────────────────────────────────────────────────────────
const pendingCount = computed(() => questions.value.length);
const oldestAge = computed(() => {
    if (!questions.value.length)
        return null;
    const oldest = new Date(questions.value[0].createdAt).getTime();
    const seconds = Math.floor((Date.now() - oldest) / 1000);
    if (seconds < 60)
        return `${seconds} 秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} 分钟前`;
    return `${Math.floor(minutes / 60)} 小时前`;
});
// ─── 数据加载 ──────────────────────────────────────────────────────────────────
async function loadPending() {
    try {
        const list = await inboxApi.getPending();
        // 保留用户正在编辑的回答草稿（避免轮询覆盖输入框）
        questions.value = list;
    }
    catch (err) {
        // 静默失败，避免轮询错误频繁弹出 Message
        console.warn('[inbox] 加载失败:', err.message);
    }
    finally {
        loading.value = false;
    }
}
function startPolling() {
    stopPolling();
    polling.value = true;
    pollTimer = setInterval(loadPending, POLL_INTERVAL_MS);
}
function stopPolling() {
    polling.value = false;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
// ─── 回答提交 ──────────────────────────────────────────────────────────────────
async function submitAnswer(q) {
    const answer = (answerDrafts.value[q.id] ?? '').trim();
    if (!answer) {
        ElMessage.warning('请输入回答内容');
        return;
    }
    answeringIds.value.add(q.id);
    try {
        const res = await inboxApi.answer(q.id, answer);
        // 从列表中移除已回答的问题
        questions.value = questions.value.filter(item => item.id !== q.id);
        delete answerDrafts.value[q.id];
        if (res._notified === false) {
            // Agent 已不在等待（可能超时），但 DB 已更新
            ElMessage.warning({
                message: '回答已保存，但 Agent 已不再等待（可能已超时）',
                duration: 5000,
            });
        }
        else {
            ElMessage.success('回答已发送，Agent 将继续执行');
        }
    }
    catch (err) {
        ElMessage.error(`提交失败: ${err.message}`);
    }
    finally {
        answeringIds.value.delete(q.id);
    }
}
function isAnswering(id) {
    return answeringIds.value.has(id);
}
function getDraft(id) {
    return answerDrafts.value[id] ?? '';
}
function setDraft(id, value) {
    answerDrafts.value[id] = value;
}
// ─── 导航 ──────────────────────────────────────────────────────────────────────
function openConversation(q) {
    if (q.sessionId) {
        router.push(`/conversations/${encodeURIComponent(q.sessionId)}`);
    }
    else {
        ElMessage.info('该问题尚未关联会话');
    }
}
// ─── 生命周期 ──────────────────────────────────────────────────────────────────
onMounted(async () => {
    loading.value = true;
    await loadPending();
    startPolling();
});
onUnmounted(() => {
    stopPolling();
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['question-card']} */ ;
/** @type {__VLS_StyleScopedClasses['form-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['inbox-view']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['question-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-header']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "inbox-view" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-left" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "title" },
});
if (__VLS_ctx.pendingCount > 0) {
    const __VLS_0 = {}.ElTag;
    /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
        type: "danger",
        effect: "dark",
        round: true,
    }));
    const __VLS_2 = __VLS_1({
        type: "danger",
        effect: "dark",
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    __VLS_3.slots.default;
    (__VLS_ctx.pendingCount);
    var __VLS_3;
}
else {
    const __VLS_4 = {}.ElTag;
    /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
        type: "success",
        effect: "plain",
        round: true,
    }));
    const __VLS_6 = __VLS_5({
        type: "success",
        effect: "plain",
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_5));
    __VLS_7.slots.default;
    var __VLS_7;
}
if (__VLS_ctx.oldestAge && __VLS_ctx.pendingCount > 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "oldest-hint" },
    });
    (__VLS_ctx.oldestAge);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-right" },
});
const __VLS_8 = {}.ElSwitch;
/** @type {[typeof __VLS_components.ElSwitch, typeof __VLS_components.elSwitch, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    ...{ 'onChange': {} },
    modelValue: (__VLS_ctx.polling),
    activeText: "轮询",
    inactiveText: "暂停",
}));
const __VLS_10 = __VLS_9({
    ...{ 'onChange': {} },
    modelValue: (__VLS_ctx.polling),
    activeText: "轮询",
    inactiveText: "暂停",
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
let __VLS_12;
let __VLS_13;
let __VLS_14;
const __VLS_15 = {
    onChange: ((v) => (v ? __VLS_ctx.startPolling() : __VLS_ctx.stopPolling()))
};
var __VLS_11;
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
    onClick: (__VLS_ctx.loadPending)
};
__VLS_19.slots.default;
var __VLS_19;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "list-wrap" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading && !__VLS_ctx.questions.length) }, null, null);
if (!__VLS_ctx.questions.length && !__VLS_ctx.loading) {
    const __VLS_24 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
        description: "暂无待回答问题",
    }));
    const __VLS_26 = __VLS_25({
        description: "暂无待回答问题",
    }, ...__VLS_functionalComponentArgsRest(__VLS_25));
    __VLS_27.slots.default;
    {
        const { image: __VLS_thisSlot } = __VLS_27.slots;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-icon" },
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "empty-tip" },
    });
    var __VLS_27;
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "question-list" },
    });
    for (const [q] of __VLS_getVForSourceType((__VLS_ctx.questions))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (q.id),
            ...{ class: "question-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "card-header" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "meta" },
        });
        const __VLS_28 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            size: "small",
            type: "warning",
            effect: "light",
        }));
        const __VLS_30 = __VLS_29({
            size: "small",
            type: "warning",
            effect: "light",
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
        __VLS_31.slots.default;
        var __VLS_31;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "mono-id" },
            title: (q.id),
        });
        (q.id.slice(-8));
        if (q.executionId) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "mono-id" },
                title: (q.executionId),
            });
            (q.executionId.slice(-8));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "time" },
        });
        (new Date(q.createdAt).toLocaleString('zh-CN'));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "actions" },
        });
        if (q.sessionId) {
            const __VLS_32 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
                ...{ 'onClick': {} },
                size: "small",
                text: true,
            }));
            const __VLS_34 = __VLS_33({
                ...{ 'onClick': {} },
                size: "small",
                text: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_33));
            let __VLS_36;
            let __VLS_37;
            let __VLS_38;
            const __VLS_39 = {
                onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.questions.length && !__VLS_ctx.loading))
                        return;
                    if (!(q.sessionId))
                        return;
                    __VLS_ctx.openConversation(q);
                }
            };
            __VLS_35.slots.default;
            var __VLS_35;
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "card-body" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "question-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "question-text" },
        });
        (q.body);
        if (q.choices && q.choices.length) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "choices" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "question-label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "choice-list" },
            });
            for (const [choice, idx] of __VLS_getVForSourceType((q.choices))) {
                const __VLS_40 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
                    ...{ 'onClick': {} },
                    key: (idx),
                    size: "small",
                }));
                const __VLS_42 = __VLS_41({
                    ...{ 'onClick': {} },
                    key: (idx),
                    size: "small",
                }, ...__VLS_functionalComponentArgsRest(__VLS_41));
                let __VLS_44;
                let __VLS_45;
                let __VLS_46;
                const __VLS_47 = {
                    onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.questions.length && !__VLS_ctx.loading))
                            return;
                        if (!(q.choices && q.choices.length))
                            return;
                        __VLS_ctx.setDraft(q.id, choice);
                    }
                };
                __VLS_43.slots.default;
                (choice);
                var __VLS_43;
            }
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "card-footer" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "answer-form" },
        });
        const __VLS_48 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
            ...{ 'onUpdate:modelValue': {} },
            ...{ 'onKeydown': {} },
            ...{ 'onKeydown': {} },
            type: "textarea",
            modelValue: (__VLS_ctx.getDraft(q.id)),
            rows: (3),
            placeholder: "输入你的回答，Agent 将基于此继续执行…",
            disabled: (__VLS_ctx.isAnswering(q.id)),
        }));
        const __VLS_50 = __VLS_49({
            ...{ 'onUpdate:modelValue': {} },
            ...{ 'onKeydown': {} },
            ...{ 'onKeydown': {} },
            type: "textarea",
            modelValue: (__VLS_ctx.getDraft(q.id)),
            rows: (3),
            placeholder: "输入你的回答，Agent 将基于此继续执行…",
            disabled: (__VLS_ctx.isAnswering(q.id)),
        }, ...__VLS_functionalComponentArgsRest(__VLS_49));
        let __VLS_52;
        let __VLS_53;
        let __VLS_54;
        const __VLS_55 = {
            'onUpdate:modelValue': ((v) => __VLS_ctx.setDraft(q.id, String(v)))
        };
        const __VLS_56 = {
            onKeydown: (...[$event]) => {
                if (!!(!__VLS_ctx.questions.length && !__VLS_ctx.loading))
                    return;
                __VLS_ctx.submitAnswer(q);
            }
        };
        const __VLS_57 = {
            onKeydown: (...[$event]) => {
                if (!!(!__VLS_ctx.questions.length && !__VLS_ctx.loading))
                    return;
                __VLS_ctx.submitAnswer(q);
            }
        };
        var __VLS_51;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "form-actions" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "hint" },
        });
        const __VLS_58 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_59 = __VLS_asFunctionalComponent(__VLS_58, new __VLS_58({
            ...{ 'onClick': {} },
            type: "primary",
            loading: (__VLS_ctx.isAnswering(q.id)),
            disabled: (!__VLS_ctx.getDraft(q.id).trim()),
        }));
        const __VLS_60 = __VLS_59({
            ...{ 'onClick': {} },
            type: "primary",
            loading: (__VLS_ctx.isAnswering(q.id)),
            disabled: (!__VLS_ctx.getDraft(q.id).trim()),
        }, ...__VLS_functionalComponentArgsRest(__VLS_59));
        let __VLS_62;
        let __VLS_63;
        let __VLS_64;
        const __VLS_65 = {
            onClick: (...[$event]) => {
                if (!!(!__VLS_ctx.questions.length && !__VLS_ctx.loading))
                    return;
                __VLS_ctx.submitAnswer(q);
            }
        };
        __VLS_61.slots.default;
        var __VLS_61;
    }
}
/** @type {__VLS_StyleScopedClasses['inbox-view']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-left']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['oldest-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-right']} */ ;
/** @type {__VLS_StyleScopedClasses['list-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-tip']} */ ;
/** @type {__VLS_StyleScopedClasses['question-list']} */ ;
/** @type {__VLS_StyleScopedClasses['question-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-header']} */ ;
/** @type {__VLS_StyleScopedClasses['meta']} */ ;
/** @type {__VLS_StyleScopedClasses['mono-id']} */ ;
/** @type {__VLS_StyleScopedClasses['mono-id']} */ ;
/** @type {__VLS_StyleScopedClasses['time']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
/** @type {__VLS_StyleScopedClasses['card-body']} */ ;
/** @type {__VLS_StyleScopedClasses['question-label']} */ ;
/** @type {__VLS_StyleScopedClasses['question-text']} */ ;
/** @type {__VLS_StyleScopedClasses['choices']} */ ;
/** @type {__VLS_StyleScopedClasses['question-label']} */ ;
/** @type {__VLS_StyleScopedClasses['choice-list']} */ ;
/** @type {__VLS_StyleScopedClasses['card-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['answer-form']} */ ;
/** @type {__VLS_StyleScopedClasses['form-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['hint']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            questions: questions,
            loading: loading,
            polling: polling,
            pendingCount: pendingCount,
            oldestAge: oldestAge,
            loadPending: loadPending,
            startPolling: startPolling,
            stopPolling: stopPolling,
            submitAnswer: submitAnswer,
            isAnswering: isAnswering,
            getDraft: getDraft,
            setDraft: setDraft,
            openConversation: openConversation,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
