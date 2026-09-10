import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api as reqApi } from '../api/requirements';
import { api as taskApi } from '../api/tasks';
import { openLogDrawer as openTaskLogDrawerGlobal } from '../stores/tasks';
import RequirementLogDrawer from './drawers/RequirementLogDrawer.vue';
import LogDrawer from './drawers/LogDrawer.vue';
const props = defineProps();
const emit = defineEmits();
const router = useRouter();
const loading = ref(false);
const treeData = ref(new Map());
const expandedNodes = ref(new Set());
// 内部日志抽屉（需求级）
const logDrawerVisible = ref(false);
const logDrawerReqId = ref('');
function openLogDrawer(reqId) {
    logDrawerReqId.value = reqId;
    logDrawerVisible.value = true;
}
// 任务级日志：通过全局 store 打开 LogDrawer（本组件挂载了 LogDrawer 实例）
function openTaskLogDrawer(execId) {
    if (!execId)
        return;
    // LogDrawer 由 stores/tasks 的 showLogDrawer 驱动，仅消费 id/status/rate_limited_until
    openTaskLogDrawerGlobal({
        id: execId,
        status: '',
        rate_limited_until: null,
    });
}
// 全量加载所有需求的分解树
async function loadAllTrees() {
    loading.value = true;
    try {
        const trees = await Promise.all(props.requirements.map(r => reqApi.getTree(r.id)));
        const map = new Map();
        trees.forEach(t => map.set(t.requirement.id, t));
        treeData.value = map;
        // 默认展开所有需求行
        props.requirements.forEach(r => expandedNodes.value.add(r.id));
    }
    catch (e) {
        ElMessage.error('加载分解结构失败');
    }
    finally {
        loading.value = false;
    }
}
onMounted(loadAllTrees);
watch(() => props.requirements.length, loadAllTrees);
// 展开/折叠
function toggle(nodeId) {
    if (expandedNodes.value.has(nodeId)) {
        expandedNodes.value.delete(nodeId);
    }
    else {
        expandedNodes.value.add(nodeId);
    }
}
function isExpanded(nodeId) {
    return expandedNodes.value.has(nodeId);
}
// 状态标签（中文）
const statusLabels = {
    draft: '草稿', pending: '待执行', running: '执行中',
    completed: '已完成', failed: '失败', cancelled: '已取消',
    waiting: '等待回答', paused: '已暂停', stopped: '已停止',
    planned: '待执行',
};
function statusLabel(s) {
    return statusLabels[s] || s || '-';
}
function statusClass(s) {
    return `st-${s}`;
}
// 判断需求是否可执行
function canExecute(req) {
    const s = req.execution_status || req.status;
    return !s || s === 'draft' || s === 'pending' || s === 'failed' || s === 'cancelled' || s === 'stopped';
}
// 行交互：任务跳转、其他展开/折叠
function handleRowClick(level, node) {
    if (level === 'task' && node.execution_id) {
        router.push(`/tasks/${node.execution_id}`);
    }
    else {
        toggle(node.id);
    }
}
// Actions —— 需求级
async function executeRequirement(reqId) {
    try {
        await reqApi.execute(reqId);
        ElMessage.success('执行已启动');
        emit('refresh');
    }
    catch (e) {
        ElMessage.error('启动失败');
    }
}
async function stopRequirement(reqId) {
    try {
        await reqApi.stop(reqId);
        ElMessage.success('已停止');
        emit('refresh');
    }
    catch (e) {
        ElMessage.error('停止失败');
    }
}
async function confirmAllTasks(reqId) {
    try {
        const res = await reqApi.confirmAll(reqId);
        ElMessage.success(res.message || `已确认 ${res.confirmed_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('确认失败');
    }
}
async function deleteRequirement(reqId) {
    try {
        await ElMessageBox.confirm('确定删除该需求？所有关联执行将被取消。', '删除确认', {
            type: 'warning',
            confirmButtonText: '删除',
            cancelButtonText: '取消',
        });
        await reqApi.delete(reqId);
        ElMessage.success('已删除');
        emit('refresh');
    }
    catch (e) {
        if (e !== 'cancel')
            ElMessage.error('删除失败');
    }
}
// Actions —— 任务级
async function confirmTask(execId) {
    try {
        await taskApi.confirm(execId);
        ElMessage.success('已确认');
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('确认失败');
    }
}
async function executeTask(execId) {
    try {
        await taskApi.execute(execId);
        ElMessage.success('执行已启动');
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('启动失败');
    }
}
async function deleteTask(execId) {
    try {
        await ElMessageBox.confirm('确定删除该任务？', '删除确认', {
            type: 'warning',
        });
        await taskApi.delete(execId);
        ElMessage.success('已删除');
        await loadAllTrees();
    }
    catch (e) {
        if (e !== 'cancel')
            ElMessage.error('删除失败');
    }
}
// 判断是否有 draft 任务（用于显示"确认任务"按钮）
function hasDraftTasks(tree) {
    for (const epic of tree.epics) {
        for (const feature of epic.features) {
            for (const story of feature.user_stories) {
                if (story.tasks.some(t => t.status === 'draft'))
                    return true;
            }
        }
        for (const story of epic.orphan_user_stories) {
            if (story.tasks.some(t => t.status === 'draft'))
                return true;
        }
    }
    return false;
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['hours-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['priority-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "req-tree" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
if (__VLS_ctx.requirements.length === 0 && !__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
}
for (const [req] of __VLS_getVForSourceType((__VLS_ctx.requirements))) {
    (req.id);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.handleRowClick('requirement', req);
            } },
        ...{ class: "tree-row level-requirement" },
        ...{ class: ({ 'is-running': (req.execution_status || req.status) === 'running' }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "toggle-icon" },
    });
    (__VLS_ctx.isExpanded(req.id) ? '▼' : '▶');
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "level-badge requirement" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "title" },
    });
    (req.input_text);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-chip" },
        ...{ class: (__VLS_ctx.statusClass(req.execution_status || req.status)) },
    });
    (__VLS_ctx.statusLabel(req.execution_status || req.status));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "created-at" },
    });
    (new Date(req.created_at).toLocaleDateString());
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ onClick: () => { } },
        ...{ class: "actions" },
    });
    if (__VLS_ctx.canExecute(req)) {
        const __VLS_0 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
        }));
        const __VLS_2 = __VLS_1({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
        }, ...__VLS_functionalComponentArgsRest(__VLS_1));
        let __VLS_4;
        let __VLS_5;
        let __VLS_6;
        const __VLS_7 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.canExecute(req)))
                    return;
                __VLS_ctx.executeRequirement(req.id);
            }
        };
        __VLS_3.slots.default;
        var __VLS_3;
    }
    if (req.execution_status === 'running' || req.execution_status === 'pending') {
        const __VLS_8 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
            ...{ 'onClick': {} },
            size: "small",
            type: "warning",
        }));
        const __VLS_10 = __VLS_9({
            ...{ 'onClick': {} },
            size: "small",
            type: "warning",
        }, ...__VLS_functionalComponentArgsRest(__VLS_9));
        let __VLS_12;
        let __VLS_13;
        let __VLS_14;
        const __VLS_15 = {
            onClick: (...[$event]) => {
                if (!(req.execution_status === 'running' || req.execution_status === 'pending'))
                    return;
                __VLS_ctx.stopRequirement(req.id);
            }
        };
        __VLS_11.slots.default;
        var __VLS_11;
    }
    if (__VLS_ctx.treeData.get(req.id) && __VLS_ctx.hasDraftTasks(__VLS_ctx.treeData.get(req.id))) {
        const __VLS_16 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
        }));
        const __VLS_18 = __VLS_17({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
        }, ...__VLS_functionalComponentArgsRest(__VLS_17));
        let __VLS_20;
        let __VLS_21;
        let __VLS_22;
        const __VLS_23 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.treeData.get(req.id) && __VLS_ctx.hasDraftTasks(__VLS_ctx.treeData.get(req.id))))
                    return;
                __VLS_ctx.confirmAllTasks(req.id);
            }
        };
        __VLS_19.slots.default;
        var __VLS_19;
    }
    const __VLS_24 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
        ...{ 'onClick': {} },
        size: "small",
    }));
    const __VLS_26 = __VLS_25({
        ...{ 'onClick': {} },
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_25));
    let __VLS_28;
    let __VLS_29;
    let __VLS_30;
    const __VLS_31 = {
        onClick: (...[$event]) => {
            __VLS_ctx.openLogDrawer(req.id);
        }
    };
    __VLS_27.slots.default;
    var __VLS_27;
    if (req.execution_id) {
        const __VLS_32 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_34 = __VLS_33({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_33));
        let __VLS_36;
        let __VLS_37;
        let __VLS_38;
        const __VLS_39 = {
            onClick: (...[$event]) => {
                if (!(req.execution_id))
                    return;
                __VLS_ctx.router.push('/canvas');
            }
        };
        __VLS_35.slots.default;
        var __VLS_35;
    }
    const __VLS_40 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
        ...{ 'onClick': {} },
        size: "small",
        type: "danger",
    }));
    const __VLS_42 = __VLS_41({
        ...{ 'onClick': {} },
        size: "small",
        type: "danger",
    }, ...__VLS_functionalComponentArgsRest(__VLS_41));
    let __VLS_44;
    let __VLS_45;
    let __VLS_46;
    const __VLS_47 = {
        onClick: (...[$event]) => {
            __VLS_ctx.deleteRequirement(req.id);
        }
    };
    __VLS_43.slots.default;
    var __VLS_43;
    if (__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)) {
        for (const [epic] of __VLS_getVForSourceType((__VLS_ctx.treeData.get(req.id).epics))) {
            (epic.id);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                            return;
                        __VLS_ctx.toggle(epic.id);
                    } },
                ...{ class: "tree-row level-epic" },
                ...{ class: ({ 'is-running': epic.status === 'running' }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "toggle-icon" },
                ...{ style: {} },
            });
            (__VLS_ctx.isExpanded(epic.id) ? '▼' : '▶');
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "level-badge epic" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "title" },
            });
            (epic.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "status-chip" },
                ...{ class: (__VLS_ctx.statusClass(epic.status)) },
            });
            (__VLS_ctx.statusLabel(epic.status));
            if (epic.module) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "module-tag" },
                });
                (epic.module);
            }
            if (__VLS_ctx.isExpanded(epic.id)) {
                for (const [feature] of __VLS_getVForSourceType((epic.features))) {
                    (feature.id);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ onClick: (...[$event]) => {
                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                    return;
                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                    return;
                                __VLS_ctx.toggle(feature.id);
                            } },
                        ...{ class: "tree-row level-feature" },
                        ...{ class: ({ 'is-running': feature.status === 'running' }) },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "toggle-icon" },
                        ...{ style: {} },
                    });
                    (__VLS_ctx.isExpanded(feature.id) ? '▼' : '▶');
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "level-badge feature" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "title" },
                    });
                    (feature.title);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "status-chip" },
                        ...{ class: (__VLS_ctx.statusClass(feature.status)) },
                    });
                    (__VLS_ctx.statusLabel(feature.status));
                    if (__VLS_ctx.isExpanded(feature.id)) {
                        for (const [story] of __VLS_getVForSourceType((feature.user_stories))) {
                            (story.id);
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                ...{ onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(feature.id)))
                                            return;
                                        __VLS_ctx.toggle(story.id);
                                    } },
                                ...{ class: "tree-row level-story" },
                                ...{ class: ({ 'is-running': story.status === 'running' }) },
                            });
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "toggle-icon" },
                                ...{ style: {} },
                            });
                            (__VLS_ctx.isExpanded(story.id) ? '▼' : '▶');
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "level-badge story" },
                            });
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "title" },
                            });
                            (story.title);
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "priority-tag" },
                            });
                            (story.priority);
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "status-chip" },
                                ...{ class: (__VLS_ctx.statusClass(story.status)) },
                            });
                            (__VLS_ctx.statusLabel(story.status));
                            if (__VLS_ctx.isExpanded(story.id)) {
                                for (const [task] of __VLS_getVForSourceType((story.tasks))) {
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                        ...{ onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                __VLS_ctx.handleRowClick('task', task);
                                            } },
                                        key: (task.id),
                                        ...{ class: "tree-row level-task" },
                                        ...{ class: ({ 'is-running': task.status === 'running' }) },
                                    });
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                        ...{ class: "toggle-icon" },
                                        ...{ style: {} },
                                    });
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                        ...{ class: "level-badge task" },
                                    });
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                        ...{ class: "title" },
                                    });
                                    (task.title || '(无标题)');
                                    if (task.estimated_hours) {
                                        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                            ...{ class: "hours-tag" },
                                        });
                                        (task.estimated_hours);
                                    }
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                        ...{ class: "status-chip" },
                                        ...{ class: (__VLS_ctx.statusClass(task.status)) },
                                    });
                                    (__VLS_ctx.statusLabel(task.status));
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                        ...{ onClick: () => { } },
                                        ...{ class: "actions" },
                                    });
                                    if (task.status === 'draft') {
                                        const __VLS_48 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }));
                                        const __VLS_50 = __VLS_49({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_49));
                                        let __VLS_52;
                                        let __VLS_53;
                                        let __VLS_54;
                                        const __VLS_55 = {
                                            onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                if (!(task.status === 'draft'))
                                                    return;
                                                __VLS_ctx.confirmTask(task.execution_id);
                                            }
                                        };
                                        __VLS_51.slots.default;
                                        var __VLS_51;
                                    }
                                    if (task.status === 'pending') {
                                        const __VLS_56 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }));
                                        const __VLS_58 = __VLS_57({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_57));
                                        let __VLS_60;
                                        let __VLS_61;
                                        let __VLS_62;
                                        const __VLS_63 = {
                                            onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                if (!(task.status === 'pending'))
                                                    return;
                                                __VLS_ctx.executeTask(task.execution_id);
                                            }
                                        };
                                        __VLS_59.slots.default;
                                        var __VLS_59;
                                    }
                                    if (task.execution_id) {
                                        const __VLS_64 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                        }));
                                        const __VLS_66 = __VLS_65({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_65));
                                        let __VLS_68;
                                        let __VLS_69;
                                        let __VLS_70;
                                        const __VLS_71 = {
                                            onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                if (!(task.execution_id))
                                                    return;
                                                __VLS_ctx.openTaskLogDrawer(task.execution_id);
                                            }
                                        };
                                        __VLS_67.slots.default;
                                        var __VLS_67;
                                    }
                                    if (task.status !== 'running' && task.execution_id) {
                                        const __VLS_72 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "danger",
                                        }));
                                        const __VLS_74 = __VLS_73({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "danger",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_73));
                                        let __VLS_76;
                                        let __VLS_77;
                                        let __VLS_78;
                                        const __VLS_79 = {
                                            onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                if (!(task.status !== 'running' && task.execution_id))
                                                    return;
                                                __VLS_ctx.deleteTask(task.execution_id);
                                            }
                                        };
                                        __VLS_75.slots.default;
                                        var __VLS_75;
                                    }
                                }
                                if (story.tasks.length === 0) {
                                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                        ...{ class: "no-items" },
                                    });
                                }
                            }
                        }
                    }
                }
                for (const [story] of __VLS_getVForSourceType((epic.orphan_user_stories))) {
                    (story.id);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ onClick: (...[$event]) => {
                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                    return;
                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                    return;
                                __VLS_ctx.toggle(story.id);
                            } },
                        ...{ class: "tree-row level-story orphan" },
                        ...{ class: ({ 'is-running': story.status === 'running' }) },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "toggle-icon" },
                        ...{ style: {} },
                    });
                    (__VLS_ctx.isExpanded(story.id) ? '▼' : '▶');
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "level-badge story" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "title" },
                    });
                    (story.title);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "priority-tag" },
                    });
                    (story.priority);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "status-chip" },
                        ...{ class: (__VLS_ctx.statusClass(story.status)) },
                    });
                    (__VLS_ctx.statusLabel(story.status));
                    if (__VLS_ctx.isExpanded(story.id)) {
                        for (const [task] of __VLS_getVForSourceType((story.tasks))) {
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                ...{ onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(story.id)))
                                            return;
                                        __VLS_ctx.handleRowClick('task', task);
                                    } },
                                key: (task.id),
                                ...{ class: "tree-row level-task" },
                                ...{ class: ({ 'is-running': task.status === 'running' }) },
                            });
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "toggle-icon" },
                                ...{ style: {} },
                            });
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "level-badge task" },
                            });
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "title" },
                            });
                            (task.title || '(无标题)');
                            if (task.estimated_hours) {
                                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                    ...{ class: "hours-tag" },
                                });
                                (task.estimated_hours);
                            }
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                                ...{ class: "status-chip" },
                                ...{ class: (__VLS_ctx.statusClass(task.status)) },
                            });
                            (__VLS_ctx.statusLabel(task.status));
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                ...{ onClick: () => { } },
                                ...{ class: "actions" },
                            });
                            if (task.status === 'draft') {
                                const __VLS_80 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }));
                                const __VLS_82 = __VLS_81({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_81));
                                let __VLS_84;
                                let __VLS_85;
                                let __VLS_86;
                                const __VLS_87 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(story.id)))
                                            return;
                                        if (!(task.status === 'draft'))
                                            return;
                                        __VLS_ctx.confirmTask(task.execution_id);
                                    }
                                };
                                __VLS_83.slots.default;
                                var __VLS_83;
                            }
                            if (task.status === 'pending') {
                                const __VLS_88 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_89 = __VLS_asFunctionalComponent(__VLS_88, new __VLS_88({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }));
                                const __VLS_90 = __VLS_89({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_89));
                                let __VLS_92;
                                let __VLS_93;
                                let __VLS_94;
                                const __VLS_95 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(story.id)))
                                            return;
                                        if (!(task.status === 'pending'))
                                            return;
                                        __VLS_ctx.executeTask(task.execution_id);
                                    }
                                };
                                __VLS_91.slots.default;
                                var __VLS_91;
                            }
                            if (task.execution_id) {
                                const __VLS_96 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_97 = __VLS_asFunctionalComponent(__VLS_96, new __VLS_96({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                }));
                                const __VLS_98 = __VLS_97({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_97));
                                let __VLS_100;
                                let __VLS_101;
                                let __VLS_102;
                                const __VLS_103 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(story.id)))
                                            return;
                                        if (!(task.execution_id))
                                            return;
                                        __VLS_ctx.openTaskLogDrawer(task.execution_id);
                                    }
                                };
                                __VLS_99.slots.default;
                                var __VLS_99;
                            }
                            if (task.status !== 'running' && task.execution_id) {
                                const __VLS_104 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_105 = __VLS_asFunctionalComponent(__VLS_104, new __VLS_104({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "danger",
                                }));
                                const __VLS_106 = __VLS_105({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "danger",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_105));
                                let __VLS_108;
                                let __VLS_109;
                                let __VLS_110;
                                const __VLS_111 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(story.id)))
                                            return;
                                        if (!(task.status !== 'running' && task.execution_id))
                                            return;
                                        __VLS_ctx.deleteTask(task.execution_id);
                                    }
                                };
                                __VLS_107.slots.default;
                                var __VLS_107;
                            }
                        }
                    }
                }
            }
        }
    }
}
/** @type {[typeof RequirementLogDrawer, ]} */ ;
// @ts-ignore
const __VLS_112 = __VLS_asFunctionalComponent(RequirementLogDrawer, new RequirementLogDrawer({
    modelValue: (__VLS_ctx.logDrawerVisible),
    requirementId: (__VLS_ctx.logDrawerReqId),
}));
const __VLS_113 = __VLS_112({
    modelValue: (__VLS_ctx.logDrawerVisible),
    requirementId: (__VLS_ctx.logDrawerReqId),
}, ...__VLS_functionalComponentArgsRest(__VLS_112));
/** @type {[typeof LogDrawer, ]} */ ;
// @ts-ignore
const __VLS_115 = __VLS_asFunctionalComponent(LogDrawer, new LogDrawer({}));
const __VLS_116 = __VLS_115({}, ...__VLS_functionalComponentArgsRest(__VLS_115));
/** @type {__VLS_StyleScopedClasses['req-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-requirement']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['created-at']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-epic']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['epic']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['module-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-feature']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['feature']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-story']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['story']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['priority-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-task']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['task']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['hours-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
/** @type {__VLS_StyleScopedClasses['no-items']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-story']} */ ;
/** @type {__VLS_StyleScopedClasses['orphan']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['story']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['priority-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-task']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['task']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['hours-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            RequirementLogDrawer: RequirementLogDrawer,
            LogDrawer: LogDrawer,
            router: router,
            loading: loading,
            treeData: treeData,
            logDrawerVisible: logDrawerVisible,
            logDrawerReqId: logDrawerReqId,
            openLogDrawer: openLogDrawer,
            openTaskLogDrawer: openTaskLogDrawer,
            toggle: toggle,
            isExpanded: isExpanded,
            statusLabel: statusLabel,
            statusClass: statusClass,
            canExecute: canExecute,
            handleRowClick: handleRowClick,
            executeRequirement: executeRequirement,
            stopRequirement: stopRequirement,
            confirmAllTasks: confirmAllTasks,
            deleteRequirement: deleteRequirement,
            confirmTask: confirmTask,
            executeTask: executeTask,
            deleteTask: deleteTask,
            hasDraftTasks: hasDraftTasks,
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
