/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/views/ExecutionOverview.vue —— 执行总览页（spec §9.3 line 444-447）
// 顶层图实例卡片列表 + 进度条（已完成 phase 占比，非 48h 倒计时）
// 详情下钻：引用 5.5/5.3 组件（StateTransitionDag + PhaseTimelineGantt + LiveEventStream）+ 并发子图实例
// worktree 展示 deferred（omnigent_session_refs 无 git_branch 列，不造数据）
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { execApi } from '../api/agent-bindings';
import StateTransitionDag from '../components/execution/StateTransitionDag.vue';
import PhaseTimelineGantt from '../components/execution/PhaseTimelineGantt.vue';
import LiveEventStream from '../components/execution/LiveEventStream.vue';
const list = ref([]);
const loading = ref(false);
const selectedId = ref('');
const subExecs = ref([]);
// 状态文本
function statusText(status) {
    const map = {
        pending: '待执行', running: '执行中', completed: '已完成',
        failed: '失败', cancelled: '已取消', paused: '已暂停',
        rate_limited: '限流中',
    };
    return map[status] || status;
}
// 进度：phase_count 作为已完成 phase 计数（简化，无总 phase 分母时显示绝对值）
function progressPct(row) {
    // loop_counters 含 phase 推进信息；若无则用 phase_count>0 视为部分完成
    // 简化：有 finished_at 视为 100%，否则按 phase_count 占比（假设典型 ~6 phase）
    if (row.status === 'completed')
        return 100;
    if (row.status === 'failed' || row.status === 'cancelled')
        return 0;
    const total = row.task_count > 0 ? row.task_count : 6;
    return Math.min(100, Math.round((row.phase_count / total) * 100));
}
const summary = computed(() => {
    const total = list.value.length;
    const running = list.value.filter(r => r.status === 'running').length;
    const completed = list.value.filter(r => r.status === 'completed').length;
    const failed = list.value.filter(r => r.status === 'failed').length;
    return { total, running, completed, failed };
});
async function loadList() {
    loading.value = true;
    try {
        list.value = await execApi.list();
    }
    catch {
        ElMessage.error('加载执行列表失败');
    }
    finally {
        loading.value = false;
    }
}
async function openDetail(row) {
    selectedId.value = row.id;
    subExecs.value = [];
    try {
        subExecs.value = await execApi.subExecutions(row.id);
    }
    catch {
        // 子图查询失败不阻塞详情展示
    }
}
onMounted(() => loadList());
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-card']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-card']} */ ;
/** @type {__VLS_StyleScopedClasses['status-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
/** @type {__VLS_StyleScopedClasses['rate_limited']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "exec-overview" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.loadList) },
    ...{ class: "btn-secondary" },
});
if (__VLS_ctx.list.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "summary-bar" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "summary-stat total" },
    });
    (__VLS_ctx.summary.total);
    if (__VLS_ctx.summary.running) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "summary-stat is-running" },
        });
        (__VLS_ctx.summary.running);
    }
    if (__VLS_ctx.summary.completed) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "summary-stat" },
        });
        (__VLS_ctx.summary.completed);
    }
    if (__VLS_ctx.summary.failed) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "summary-stat is-failed" },
        });
        (__VLS_ctx.summary.failed);
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "card-list" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
if (!__VLS_ctx.list.length && !__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty" },
    });
}
for (const [row] of __VLS_getVForSourceType((__VLS_ctx.list))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.openDetail(row);
            } },
        key: (row.id),
        ...{ class: "exec-card" },
        ...{ class: ({ active: __VLS_ctx.selectedId === row.id }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "card-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "card-title" },
    });
    (row.requirement_text || row.subject_id || row.id);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-tag" },
        ...{ class: (row.status) },
    });
    (__VLS_ctx.statusText(row.status));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "card-meta" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-badge" },
    });
    (row.id.slice(-8));
    if (row.current_node_id) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-node" },
        });
        (row.current_node_id);
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-count" },
    });
    (row.task_count);
    (row.phase_count);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-bar" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-fill" },
        ...{ style: ({ width: __VLS_ctx.progressPct(row) + '%' }) },
        ...{ class: (row.status) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "progress-text" },
    });
    (__VLS_ctx.progressPct(row));
}
if (__VLS_ctx.selectedId) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-section" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "detail-title" },
    });
    (__VLS_ctx.selectedId.slice(-8));
    const __VLS_0 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
        ...{ 'onClick': {} },
        link: true,
        size: "small",
    }));
    const __VLS_2 = __VLS_1({
        ...{ 'onClick': {} },
        link: true,
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    let __VLS_4;
    let __VLS_5;
    let __VLS_6;
    const __VLS_7 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.selectedId))
                return;
            __VLS_ctx.selectedId = '';
        }
    };
    __VLS_3.slots.default;
    var __VLS_3;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-block" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "block-title" },
    });
    /** @type {[typeof StateTransitionDag, ]} */ ;
    // @ts-ignore
    const __VLS_8 = __VLS_asFunctionalComponent(StateTransitionDag, new StateTransitionDag({
        executionId: (__VLS_ctx.selectedId),
    }));
    const __VLS_9 = __VLS_8({
        executionId: (__VLS_ctx.selectedId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_8));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-block" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "block-title" },
    });
    /** @type {[typeof PhaseTimelineGantt, ]} */ ;
    // @ts-ignore
    const __VLS_11 = __VLS_asFunctionalComponent(PhaseTimelineGantt, new PhaseTimelineGantt({
        executionId: (__VLS_ctx.selectedId),
    }));
    const __VLS_12 = __VLS_11({
        executionId: (__VLS_ctx.selectedId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_11));
    if (__VLS_ctx.subExecs.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "block-title" },
        });
        (__VLS_ctx.subExecs.length);
        const __VLS_14 = {}.ElTable;
        /** @type {[typeof __VLS_components.ElTable, typeof __VLS_components.elTable, typeof __VLS_components.ElTable, typeof __VLS_components.elTable, ]} */ ;
        // @ts-ignore
        const __VLS_15 = __VLS_asFunctionalComponent(__VLS_14, new __VLS_14({
            data: (__VLS_ctx.subExecs),
            size: "small",
        }));
        const __VLS_16 = __VLS_15({
            data: (__VLS_ctx.subExecs),
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_15));
        __VLS_17.slots.default;
        const __VLS_18 = {}.ElTableColumn;
        /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
        // @ts-ignore
        const __VLS_19 = __VLS_asFunctionalComponent(__VLS_18, new __VLS_18({
            label: "实例",
            prop: "id",
            minWidth: "160",
        }));
        const __VLS_20 = __VLS_19({
            label: "实例",
            prop: "id",
            minWidth: "160",
        }, ...__VLS_functionalComponentArgsRest(__VLS_19));
        __VLS_21.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_21.slots;
            const [{ row }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "mono" },
            });
            (row.id.slice(-8));
        }
        var __VLS_21;
        const __VLS_22 = {}.ElTableColumn;
        /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
        // @ts-ignore
        const __VLS_23 = __VLS_asFunctionalComponent(__VLS_22, new __VLS_22({
            label: "状态",
            width: "120",
        }));
        const __VLS_24 = __VLS_23({
            label: "状态",
            width: "120",
        }, ...__VLS_functionalComponentArgsRest(__VLS_23));
        __VLS_25.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_25.slots;
            const [{ row }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "status-dot" },
                ...{ class: (row.status) },
            });
            (__VLS_ctx.statusText(row.status));
        }
        var __VLS_25;
        const __VLS_26 = {}.ElTableColumn;
        /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
        // @ts-ignore
        const __VLS_27 = __VLS_asFunctionalComponent(__VLS_26, new __VLS_26({
            label: "当前节点",
            prop: "current_node_id",
            minWidth: "140",
        }));
        const __VLS_28 = __VLS_27({
            label: "当前节点",
            prop: "current_node_id",
            minWidth: "140",
        }, ...__VLS_functionalComponentArgsRest(__VLS_27));
        const __VLS_30 = {}.ElTableColumn;
        /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
        // @ts-ignore
        const __VLS_31 = __VLS_asFunctionalComponent(__VLS_30, new __VLS_30({
            label: "开始",
            prop: "started_at",
            minWidth: "160",
        }));
        const __VLS_32 = __VLS_31({
            label: "开始",
            prop: "started_at",
            minWidth: "160",
        }, ...__VLS_functionalComponentArgsRest(__VLS_31));
        var __VLS_17;
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-block" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "block-title" },
    });
    /** @type {[typeof LiveEventStream, ]} */ ;
    // @ts-ignore
    const __VLS_34 = __VLS_asFunctionalComponent(LiveEventStream, new LiveEventStream({
        executionId: (__VLS_ctx.selectedId),
    }));
    const __VLS_35 = __VLS_34({
        executionId: (__VLS_ctx.selectedId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_34));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-block deferred" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "block-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "placeholder" },
    });
}
/** @type {__VLS_StyleScopedClasses['exec-overview']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['total']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['is-running']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-stat']} */ ;
/** @type {__VLS_StyleScopedClasses['is-failed']} */ ;
/** @type {__VLS_StyleScopedClasses['card-list']} */ ;
/** @type {__VLS_StyleScopedClasses['empty']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-header']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['status-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['card-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-node']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-count']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-text']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-header']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-title']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['block-title']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['block-title']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['block-title']} */ ;
/** @type {__VLS_StyleScopedClasses['mono']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['block-title']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['deferred']} */ ;
/** @type {__VLS_StyleScopedClasses['block-title']} */ ;
/** @type {__VLS_StyleScopedClasses['placeholder']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            StateTransitionDag: StateTransitionDag,
            PhaseTimelineGantt: PhaseTimelineGantt,
            LiveEventStream: LiveEventStream,
            list: list,
            loading: loading,
            selectedId: selectedId,
            subExecs: subExecs,
            statusText: statusText,
            progressPct: progressPct,
            summary: summary,
            loadList: loadList,
            openDetail: openDetail,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
