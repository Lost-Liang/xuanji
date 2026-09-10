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
// 需求行状态：优先使用树汇总状态（真实反映子任务执行情况），无树数据时回退到需求级执行状态
function reqStatus(req) {
    const rollup = treeData.value.get(req.id)?.requirement?.rollup_status;
    return rollup || req.execution_status || req.status;
}
function reqCanPause(req) {
    const t = treeData.value.get(req.id);
    if (!t)
        return req.execution_status === 'running';
    return t.requirement?.can_pause === true;
}
function reqCanResume(req) {
    return treeData.value.get(req.id)?.requirement?.can_resume === true;
}
// 点击任务行 → 进入任务详情
function openTask(task) {
    if (!task.execution_id) {
        ElMessage.info('该任务尚未创建执行实例');
        return;
    }
    router.push(`/tasks/${task.execution_id}`);
}
// 行交互：需求行展开/折叠（任务行单独走 openTask）
function handleRowClick(_level, node) {
    toggle(node.id);
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
async function pauseRequirement(reqId) {
    try {
        const res = await reqApi.pauseRequirement(reqId);
        ElMessage.success(`已暂停 ${res.paused_count} 个任务`);
        emit('refresh');
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('暂停失败');
    }
}
async function resumeRequirement(reqId) {
    try {
        const res = await reqApi.resumeRequirement(reqId);
        ElMessage.success(`已恢复 ${res.resumed_count} 个任务`);
        emit('refresh');
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('恢复失败');
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
async function pauseTask(execId) {
    try {
        await taskApi.pause(execId);
        ElMessage.success('已暂停');
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('暂停失败');
    }
}
async function resumeTask(execId) {
    try {
        await taskApi.resume(execId);
        ElMessage.success('已恢复');
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('恢复失败');
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
// Actions —— Epic 级
async function executeEpic(epicId) {
    try {
        const res = await reqApi.executeEpic(epicId);
        ElMessage.success(res.message || `已入队 ${res.started_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('启动失败');
    }
}
async function pauseEpic(epicId) {
    try {
        const res = await reqApi.pauseEpic(epicId);
        ElMessage.success(`已暂停 ${res.paused_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('暂停失败');
    }
}
async function resumeEpic(epicId) {
    try {
        const res = await reqApi.resumeEpic(epicId);
        ElMessage.success(`已恢复 ${res.resumed_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('恢复失败');
    }
}
async function deleteEpic(epicId) {
    try {
        await ElMessageBox.confirm('确定删除该史诗？所有关联任务将被删除。', '删除确认', {
            type: 'warning',
        });
        await reqApi.deleteEpic(epicId);
        ElMessage.success('已删除');
        await loadAllTrees();
    }
    catch (e) {
        if (e !== 'cancel')
            ElMessage.error('删除失败');
    }
}
// Actions —— Feature 级
async function executeFeature(featureId) {
    try {
        const res = await reqApi.executeFeature(featureId);
        ElMessage.success(res.message || `已入队 ${res.started_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('启动失败');
    }
}
async function pauseFeature(featureId) {
    try {
        const res = await reqApi.pauseFeature(featureId);
        ElMessage.success(`已暂停 ${res.paused_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('暂停失败');
    }
}
async function resumeFeature(featureId) {
    try {
        const res = await reqApi.resumeFeature(featureId);
        ElMessage.success(`已恢复 ${res.resumed_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('恢复失败');
    }
}
async function deleteFeature(featureId) {
    try {
        await ElMessageBox.confirm('确定删除该特性？所有关联任务将被删除。', '删除确认', {
            type: 'warning',
        });
        await reqApi.deleteFeature(featureId);
        ElMessage.success('已删除');
        await loadAllTrees();
    }
    catch (e) {
        if (e !== 'cancel')
            ElMessage.error('删除失败');
    }
}
// Actions —— UserStory 级
async function executeUserStory(userStoryId) {
    try {
        const res = await reqApi.executeUserStory(userStoryId);
        ElMessage.success(res.message || `已入队 ${res.started_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('启动失败');
    }
}
async function pauseUserStory(userStoryId) {
    try {
        const res = await reqApi.pauseUserStory(userStoryId);
        ElMessage.success(`已暂停 ${res.paused_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('暂停失败');
    }
}
async function resumeUserStory(userStoryId) {
    try {
        const res = await reqApi.resumeUserStory(userStoryId);
        ElMessage.success(`已恢复 ${res.resumed_count} 个任务`);
        await loadAllTrees();
    }
    catch (e) {
        ElMessage.error('恢复失败');
    }
}
async function deleteUserStory(userStoryId) {
    try {
        await ElMessageBox.confirm('确定删除该用户故事？所有关联任务将被删除。', '删除确认', {
            type: 'warning',
        });
        await reqApi.deleteUserStory(userStoryId);
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
        ...{ class: ({ 'is-running': __VLS_ctx.reqStatus(req) === 'running' }) },
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
        ...{ class: (__VLS_ctx.statusClass(__VLS_ctx.reqStatus(req))) },
    });
    (__VLS_ctx.statusLabel(__VLS_ctx.reqStatus(req)));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "created-at" },
    });
    (req.created_at ? new Date(req.created_at).toLocaleDateString() : '');
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
    if (__VLS_ctx.reqCanPause(req)) {
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
                if (!(__VLS_ctx.reqCanPause(req)))
                    return;
                __VLS_ctx.pauseRequirement(req.id);
            }
        };
        __VLS_11.slots.default;
        var __VLS_11;
    }
    if (__VLS_ctx.reqCanResume(req)) {
        const __VLS_16 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
            ...{ 'onClick': {} },
            size: "small",
            type: "success",
        }));
        const __VLS_18 = __VLS_17({
            ...{ 'onClick': {} },
            size: "small",
            type: "success",
        }, ...__VLS_functionalComponentArgsRest(__VLS_17));
        let __VLS_20;
        let __VLS_21;
        let __VLS_22;
        const __VLS_23 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.reqCanResume(req)))
                    return;
                __VLS_ctx.resumeRequirement(req.id);
            }
        };
        __VLS_19.slots.default;
        var __VLS_19;
    }
    if (__VLS_ctx.treeData.get(req.id) && __VLS_ctx.hasDraftTasks(__VLS_ctx.treeData.get(req.id))) {
        const __VLS_24 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
        }));
        const __VLS_26 = __VLS_25({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
        }, ...__VLS_functionalComponentArgsRest(__VLS_25));
        let __VLS_28;
        let __VLS_29;
        let __VLS_30;
        const __VLS_31 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.treeData.get(req.id) && __VLS_ctx.hasDraftTasks(__VLS_ctx.treeData.get(req.id))))
                    return;
                __VLS_ctx.confirmAllTasks(req.id);
            }
        };
        __VLS_27.slots.default;
        var __VLS_27;
    }
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
            __VLS_ctx.openLogDrawer(req.id);
        }
    };
    __VLS_35.slots.default;
    var __VLS_35;
    if (req.execution_id) {
        const __VLS_40 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_42 = __VLS_41({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_41));
        let __VLS_44;
        let __VLS_45;
        let __VLS_46;
        const __VLS_47 = {
            onClick: (...[$event]) => {
                if (!(req.execution_id))
                    return;
                __VLS_ctx.router.push(`/canvas?execution_id=${req.execution_id}`);
            }
        };
        __VLS_43.slots.default;
        var __VLS_43;
    }
    const __VLS_48 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
        ...{ 'onClick': {} },
        size: "small",
        type: "danger",
    }));
    const __VLS_50 = __VLS_49({
        ...{ 'onClick': {} },
        size: "small",
        type: "danger",
    }, ...__VLS_functionalComponentArgsRest(__VLS_49));
    let __VLS_52;
    let __VLS_53;
    let __VLS_54;
    const __VLS_55 = {
        onClick: (...[$event]) => {
            __VLS_ctx.deleteRequirement(req.id);
        }
    };
    __VLS_51.slots.default;
    var __VLS_51;
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
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: () => { } },
                ...{ class: "actions" },
            });
            if (epic.can_execute) {
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
                        if (!(epic.can_execute))
                            return;
                        __VLS_ctx.executeEpic(epic.id);
                    }
                };
                __VLS_59.slots.default;
                var __VLS_59;
            }
            if (epic.can_pause) {
                const __VLS_64 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({
                    ...{ 'onClick': {} },
                    size: "small",
                    type: "warning",
                }));
                const __VLS_66 = __VLS_65({
                    ...{ 'onClick': {} },
                    size: "small",
                    type: "warning",
                }, ...__VLS_functionalComponentArgsRest(__VLS_65));
                let __VLS_68;
                let __VLS_69;
                let __VLS_70;
                const __VLS_71 = {
                    onClick: (...[$event]) => {
                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                            return;
                        if (!(epic.can_pause))
                            return;
                        __VLS_ctx.pauseEpic(epic.id);
                    }
                };
                __VLS_67.slots.default;
                var __VLS_67;
            }
            if (epic.can_resume) {
                const __VLS_72 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
                    ...{ 'onClick': {} },
                    size: "small",
                    type: "success",
                }));
                const __VLS_74 = __VLS_73({
                    ...{ 'onClick': {} },
                    size: "small",
                    type: "success",
                }, ...__VLS_functionalComponentArgsRest(__VLS_73));
                let __VLS_76;
                let __VLS_77;
                let __VLS_78;
                const __VLS_79 = {
                    onClick: (...[$event]) => {
                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                            return;
                        if (!(epic.can_resume))
                            return;
                        __VLS_ctx.resumeEpic(epic.id);
                    }
                };
                __VLS_75.slots.default;
                var __VLS_75;
            }
            const __VLS_80 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_82 = __VLS_81({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_81));
            let __VLS_84;
            let __VLS_85;
            let __VLS_86;
            const __VLS_87 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                        return;
                    __VLS_ctx.deleteEpic(epic.id);
                }
            };
            __VLS_83.slots.default;
            var __VLS_83;
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
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ onClick: () => { } },
                        ...{ class: "actions" },
                    });
                    if (feature.can_execute) {
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
                                if (!(feature.can_execute))
                                    return;
                                __VLS_ctx.executeFeature(feature.id);
                            }
                        };
                        __VLS_91.slots.default;
                        var __VLS_91;
                    }
                    if (feature.can_pause) {
                        const __VLS_96 = {}.ElButton;
                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                        // @ts-ignore
                        const __VLS_97 = __VLS_asFunctionalComponent(__VLS_96, new __VLS_96({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "warning",
                        }));
                        const __VLS_98 = __VLS_97({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "warning",
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
                                if (!(feature.can_pause))
                                    return;
                                __VLS_ctx.pauseFeature(feature.id);
                            }
                        };
                        __VLS_99.slots.default;
                        var __VLS_99;
                    }
                    if (feature.can_resume) {
                        const __VLS_104 = {}.ElButton;
                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                        // @ts-ignore
                        const __VLS_105 = __VLS_asFunctionalComponent(__VLS_104, new __VLS_104({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "success",
                        }));
                        const __VLS_106 = __VLS_105({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "success",
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
                                if (!(feature.can_resume))
                                    return;
                                __VLS_ctx.resumeFeature(feature.id);
                            }
                        };
                        __VLS_107.slots.default;
                        var __VLS_107;
                    }
                    const __VLS_112 = {}.ElButton;
                    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                    // @ts-ignore
                    const __VLS_113 = __VLS_asFunctionalComponent(__VLS_112, new __VLS_112({
                        ...{ 'onClick': {} },
                        size: "small",
                        type: "danger",
                    }));
                    const __VLS_114 = __VLS_113({
                        ...{ 'onClick': {} },
                        size: "small",
                        type: "danger",
                    }, ...__VLS_functionalComponentArgsRest(__VLS_113));
                    let __VLS_116;
                    let __VLS_117;
                    let __VLS_118;
                    const __VLS_119 = {
                        onClick: (...[$event]) => {
                            if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                return;
                            if (!(__VLS_ctx.isExpanded(epic.id)))
                                return;
                            __VLS_ctx.deleteFeature(feature.id);
                        }
                    };
                    __VLS_115.slots.default;
                    var __VLS_115;
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
                            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                                ...{ onClick: () => { } },
                                ...{ class: "actions" },
                            });
                            if (story.can_execute) {
                                const __VLS_120 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_121 = __VLS_asFunctionalComponent(__VLS_120, new __VLS_120({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }));
                                const __VLS_122 = __VLS_121({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_121));
                                let __VLS_124;
                                let __VLS_125;
                                let __VLS_126;
                                const __VLS_127 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(feature.id)))
                                            return;
                                        if (!(story.can_execute))
                                            return;
                                        __VLS_ctx.executeUserStory(story.id);
                                    }
                                };
                                __VLS_123.slots.default;
                                var __VLS_123;
                            }
                            if (story.can_pause) {
                                const __VLS_128 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_129 = __VLS_asFunctionalComponent(__VLS_128, new __VLS_128({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "warning",
                                }));
                                const __VLS_130 = __VLS_129({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "warning",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_129));
                                let __VLS_132;
                                let __VLS_133;
                                let __VLS_134;
                                const __VLS_135 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(feature.id)))
                                            return;
                                        if (!(story.can_pause))
                                            return;
                                        __VLS_ctx.pauseUserStory(story.id);
                                    }
                                };
                                __VLS_131.slots.default;
                                var __VLS_131;
                            }
                            if (story.can_resume) {
                                const __VLS_136 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_137 = __VLS_asFunctionalComponent(__VLS_136, new __VLS_136({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "success",
                                }));
                                const __VLS_138 = __VLS_137({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "success",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_137));
                                let __VLS_140;
                                let __VLS_141;
                                let __VLS_142;
                                const __VLS_143 = {
                                    onClick: (...[$event]) => {
                                        if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(epic.id)))
                                            return;
                                        if (!(__VLS_ctx.isExpanded(feature.id)))
                                            return;
                                        if (!(story.can_resume))
                                            return;
                                        __VLS_ctx.resumeUserStory(story.id);
                                    }
                                };
                                __VLS_139.slots.default;
                                var __VLS_139;
                            }
                            const __VLS_144 = {}.ElButton;
                            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                            // @ts-ignore
                            const __VLS_145 = __VLS_asFunctionalComponent(__VLS_144, new __VLS_144({
                                ...{ 'onClick': {} },
                                size: "small",
                                type: "danger",
                            }));
                            const __VLS_146 = __VLS_145({
                                ...{ 'onClick': {} },
                                size: "small",
                                type: "danger",
                            }, ...__VLS_functionalComponentArgsRest(__VLS_145));
                            let __VLS_148;
                            let __VLS_149;
                            let __VLS_150;
                            const __VLS_151 = {
                                onClick: (...[$event]) => {
                                    if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                        return;
                                    if (!(__VLS_ctx.isExpanded(epic.id)))
                                        return;
                                    if (!(__VLS_ctx.isExpanded(feature.id)))
                                        return;
                                    __VLS_ctx.deleteUserStory(story.id);
                                }
                            };
                            __VLS_147.slots.default;
                            var __VLS_147;
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
                                                __VLS_ctx.openTask(task);
                                            } },
                                        key: (task.id),
                                        ...{ class: "tree-row level-task" },
                                        ...{ class: ({ 'is-running': task.status === 'running' || task.status === 'rate_limited' }) },
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
                                        const __VLS_152 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_153 = __VLS_asFunctionalComponent(__VLS_152, new __VLS_152({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }));
                                        const __VLS_154 = __VLS_153({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_153));
                                        let __VLS_156;
                                        let __VLS_157;
                                        let __VLS_158;
                                        const __VLS_159 = {
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
                                        __VLS_155.slots.default;
                                        var __VLS_155;
                                    }
                                    if (task.status === 'pending') {
                                        const __VLS_160 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_161 = __VLS_asFunctionalComponent(__VLS_160, new __VLS_160({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }));
                                        const __VLS_162 = __VLS_161({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "primary",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_161));
                                        let __VLS_164;
                                        let __VLS_165;
                                        let __VLS_166;
                                        const __VLS_167 = {
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
                                        __VLS_163.slots.default;
                                        var __VLS_163;
                                    }
                                    if (task.status === 'running' || task.status === 'rate_limited') {
                                        const __VLS_168 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_169 = __VLS_asFunctionalComponent(__VLS_168, new __VLS_168({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "warning",
                                        }));
                                        const __VLS_170 = __VLS_169({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "warning",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_169));
                                        let __VLS_172;
                                        let __VLS_173;
                                        let __VLS_174;
                                        const __VLS_175 = {
                                            onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                if (!(task.status === 'running' || task.status === 'rate_limited'))
                                                    return;
                                                __VLS_ctx.pauseTask(task.execution_id);
                                            }
                                        };
                                        __VLS_171.slots.default;
                                        var __VLS_171;
                                    }
                                    if (task.status === 'paused' || task.status === 'failed' || task.status === 'stopped' || task.status === 'cancelled') {
                                        const __VLS_176 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_177 = __VLS_asFunctionalComponent(__VLS_176, new __VLS_176({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "success",
                                        }));
                                        const __VLS_178 = __VLS_177({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "success",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_177));
                                        let __VLS_180;
                                        let __VLS_181;
                                        let __VLS_182;
                                        const __VLS_183 = {
                                            onClick: (...[$event]) => {
                                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(feature.id)))
                                                    return;
                                                if (!(__VLS_ctx.isExpanded(story.id)))
                                                    return;
                                                if (!(task.status === 'paused' || task.status === 'failed' || task.status === 'stopped' || task.status === 'cancelled'))
                                                    return;
                                                __VLS_ctx.resumeTask(task.execution_id);
                                            }
                                        };
                                        __VLS_179.slots.default;
                                        var __VLS_179;
                                    }
                                    if (task.execution_id) {
                                        const __VLS_184 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_185 = __VLS_asFunctionalComponent(__VLS_184, new __VLS_184({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                        }));
                                        const __VLS_186 = __VLS_185({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_185));
                                        let __VLS_188;
                                        let __VLS_189;
                                        let __VLS_190;
                                        const __VLS_191 = {
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
                                        __VLS_187.slots.default;
                                        var __VLS_187;
                                    }
                                    if (task.status !== 'running' && task.execution_id) {
                                        const __VLS_192 = {}.ElButton;
                                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                        // @ts-ignore
                                        const __VLS_193 = __VLS_asFunctionalComponent(__VLS_192, new __VLS_192({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "danger",
                                        }));
                                        const __VLS_194 = __VLS_193({
                                            ...{ 'onClick': {} },
                                            size: "small",
                                            type: "danger",
                                        }, ...__VLS_functionalComponentArgsRest(__VLS_193));
                                        let __VLS_196;
                                        let __VLS_197;
                                        let __VLS_198;
                                        const __VLS_199 = {
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
                                        __VLS_195.slots.default;
                                        var __VLS_195;
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
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ onClick: () => { } },
                        ...{ class: "actions" },
                    });
                    if (story.can_execute) {
                        const __VLS_200 = {}.ElButton;
                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                        // @ts-ignore
                        const __VLS_201 = __VLS_asFunctionalComponent(__VLS_200, new __VLS_200({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "primary",
                        }));
                        const __VLS_202 = __VLS_201({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "primary",
                        }, ...__VLS_functionalComponentArgsRest(__VLS_201));
                        let __VLS_204;
                        let __VLS_205;
                        let __VLS_206;
                        const __VLS_207 = {
                            onClick: (...[$event]) => {
                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                    return;
                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                    return;
                                if (!(story.can_execute))
                                    return;
                                __VLS_ctx.executeUserStory(story.id);
                            }
                        };
                        __VLS_203.slots.default;
                        var __VLS_203;
                    }
                    if (story.can_pause) {
                        const __VLS_208 = {}.ElButton;
                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                        // @ts-ignore
                        const __VLS_209 = __VLS_asFunctionalComponent(__VLS_208, new __VLS_208({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "warning",
                        }));
                        const __VLS_210 = __VLS_209({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "warning",
                        }, ...__VLS_functionalComponentArgsRest(__VLS_209));
                        let __VLS_212;
                        let __VLS_213;
                        let __VLS_214;
                        const __VLS_215 = {
                            onClick: (...[$event]) => {
                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                    return;
                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                    return;
                                if (!(story.can_pause))
                                    return;
                                __VLS_ctx.pauseUserStory(story.id);
                            }
                        };
                        __VLS_211.slots.default;
                        var __VLS_211;
                    }
                    if (story.can_resume) {
                        const __VLS_216 = {}.ElButton;
                        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                        // @ts-ignore
                        const __VLS_217 = __VLS_asFunctionalComponent(__VLS_216, new __VLS_216({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "success",
                        }));
                        const __VLS_218 = __VLS_217({
                            ...{ 'onClick': {} },
                            size: "small",
                            type: "success",
                        }, ...__VLS_functionalComponentArgsRest(__VLS_217));
                        let __VLS_220;
                        let __VLS_221;
                        let __VLS_222;
                        const __VLS_223 = {
                            onClick: (...[$event]) => {
                                if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                    return;
                                if (!(__VLS_ctx.isExpanded(epic.id)))
                                    return;
                                if (!(story.can_resume))
                                    return;
                                __VLS_ctx.resumeUserStory(story.id);
                            }
                        };
                        __VLS_219.slots.default;
                        var __VLS_219;
                    }
                    const __VLS_224 = {}.ElButton;
                    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                    // @ts-ignore
                    const __VLS_225 = __VLS_asFunctionalComponent(__VLS_224, new __VLS_224({
                        ...{ 'onClick': {} },
                        size: "small",
                        type: "danger",
                    }));
                    const __VLS_226 = __VLS_225({
                        ...{ 'onClick': {} },
                        size: "small",
                        type: "danger",
                    }, ...__VLS_functionalComponentArgsRest(__VLS_225));
                    let __VLS_228;
                    let __VLS_229;
                    let __VLS_230;
                    const __VLS_231 = {
                        onClick: (...[$event]) => {
                            if (!(__VLS_ctx.isExpanded(req.id) && __VLS_ctx.treeData.has(req.id)))
                                return;
                            if (!(__VLS_ctx.isExpanded(epic.id)))
                                return;
                            __VLS_ctx.deleteUserStory(story.id);
                        }
                    };
                    __VLS_227.slots.default;
                    var __VLS_227;
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
                                        __VLS_ctx.openTask(task);
                                    } },
                                key: (task.id),
                                ...{ class: "tree-row level-task" },
                                ...{ class: ({ 'is-running': task.status === 'running' || task.status === 'rate_limited' }) },
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
                                const __VLS_232 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_233 = __VLS_asFunctionalComponent(__VLS_232, new __VLS_232({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }));
                                const __VLS_234 = __VLS_233({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_233));
                                let __VLS_236;
                                let __VLS_237;
                                let __VLS_238;
                                const __VLS_239 = {
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
                                __VLS_235.slots.default;
                                var __VLS_235;
                            }
                            if (task.status === 'pending') {
                                const __VLS_240 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_241 = __VLS_asFunctionalComponent(__VLS_240, new __VLS_240({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }));
                                const __VLS_242 = __VLS_241({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "primary",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_241));
                                let __VLS_244;
                                let __VLS_245;
                                let __VLS_246;
                                const __VLS_247 = {
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
                                __VLS_243.slots.default;
                                var __VLS_243;
                            }
                            if (task.execution_id) {
                                const __VLS_248 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_249 = __VLS_asFunctionalComponent(__VLS_248, new __VLS_248({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                }));
                                const __VLS_250 = __VLS_249({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_249));
                                let __VLS_252;
                                let __VLS_253;
                                let __VLS_254;
                                const __VLS_255 = {
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
                                __VLS_251.slots.default;
                                var __VLS_251;
                            }
                            if (task.status !== 'running' && task.execution_id) {
                                const __VLS_256 = {}.ElButton;
                                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                                // @ts-ignore
                                const __VLS_257 = __VLS_asFunctionalComponent(__VLS_256, new __VLS_256({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "danger",
                                }));
                                const __VLS_258 = __VLS_257({
                                    ...{ 'onClick': {} },
                                    size: "small",
                                    type: "danger",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_257));
                                let __VLS_260;
                                let __VLS_261;
                                let __VLS_262;
                                const __VLS_263 = {
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
                                __VLS_259.slots.default;
                                var __VLS_259;
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
const __VLS_264 = __VLS_asFunctionalComponent(RequirementLogDrawer, new RequirementLogDrawer({
    modelValue: (__VLS_ctx.logDrawerVisible),
    requirementId: (__VLS_ctx.logDrawerReqId),
}));
const __VLS_265 = __VLS_264({
    modelValue: (__VLS_ctx.logDrawerVisible),
    requirementId: (__VLS_ctx.logDrawerReqId),
}, ...__VLS_functionalComponentArgsRest(__VLS_264));
/** @type {[typeof LogDrawer, ]} */ ;
// @ts-ignore
const __VLS_267 = __VLS_asFunctionalComponent(LogDrawer, new LogDrawer({}));
const __VLS_268 = __VLS_267({}, ...__VLS_functionalComponentArgsRest(__VLS_267));
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
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-feature']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['feature']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-row']} */ ;
/** @type {__VLS_StyleScopedClasses['level-story']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['story']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['priority-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
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
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
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
            reqStatus: reqStatus,
            reqCanPause: reqCanPause,
            reqCanResume: reqCanResume,
            openTask: openTask,
            handleRowClick: handleRowClick,
            executeRequirement: executeRequirement,
            pauseRequirement: pauseRequirement,
            resumeRequirement: resumeRequirement,
            confirmAllTasks: confirmAllTasks,
            deleteRequirement: deleteRequirement,
            confirmTask: confirmTask,
            executeTask: executeTask,
            pauseTask: pauseTask,
            resumeTask: resumeTask,
            deleteTask: deleteTask,
            executeEpic: executeEpic,
            pauseEpic: pauseEpic,
            resumeEpic: resumeEpic,
            deleteEpic: deleteEpic,
            executeFeature: executeFeature,
            pauseFeature: pauseFeature,
            resumeFeature: resumeFeature,
            deleteFeature: deleteFeature,
            executeUserStory: executeUserStory,
            pauseUserStory: pauseUserStory,
            resumeUserStory: resumeUserStory,
            deleteUserStory: deleteUserStory,
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
