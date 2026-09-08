/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/views/Requirements.vue —— 需求列表页（V3 重构）
// 卡片列表替代表格 + 概览统计 + 详情抽屉分层
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api/requirements';
import RequirementLogDrawer from '../components/drawers/RequirementLogDrawer.vue';
import RequirementTreeView from '../components/RequirementTreeView.vue';
const router = useRouter();
const list = ref([]);
const loading = ref(false);
const newInput = ref('');
const creating = ref(false);
const searchText = ref('');
// 工作流选择
const workflows = ref([]);
const selectedWorkflowId = ref('requirement-decomposition');
// 详情抽屉
const drawerVisible = ref(false);
const detail = ref(null);
const detailLoading = ref(false);
const logDrawerVisible = ref(false);
// 状态映射
function statusTagType(status) {
    switch (status) {
        case 'running': return 'warning';
        case 'completed': return 'success';
        case 'failed': return 'danger';
        case 'cancelled':
        case 'stopped': return 'info';
        case 'paused': return 'info';
        default: return 'info';
    }
}
function statusText(status) {
    const map = {
        pending: '待执行', running: '执行中', completed: '已完成',
        failed: '失败', stopped: '已停止', cancelled: '已取消',
        paused: '已暂停', planned: '待执行',
    };
    return map[status || ''] || '待执行';
}
// 聚合状态
function aggStatus(item) {
    return item.execution_status || item.status;
}
function formatTime(ts) {
    if (!ts)
        return '-';
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
// 汇总统计
const summary = computed(() => {
    const total = list.value.length;
    const running = list.value.filter(r => aggStatus(r) === 'running').length;
    const paused = list.value.filter(r => aggStatus(r) === 'paused').length;
    const completed = list.value.filter(r => aggStatus(r) === 'completed').length;
    const failed = list.value.filter(r => aggStatus(r) === 'failed').length;
    return { total, running, paused, completed, failed };
});
// 过滤列表
const filteredList = computed(() => {
    if (!searchText.value)
        return list.value;
    const kw = searchText.value.toLowerCase();
    return list.value.filter(r => r.id.toLowerCase().includes(kw) ||
        r.input_text?.toLowerCase().includes(kw));
});
async function loadList() {
    loading.value = true;
    try {
        list.value = await api.list();
    }
    catch (e) {
        ElMessage.error(e?.message || '加载失败');
    }
    finally {
        loading.value = false;
    }
}
// 加载工作流列表
async function loadWorkflows() {
    try {
        const r = await fetch('/api/workflows');
        const data = await r.json();
        // 合并 presets 和 user workflows
        workflows.value = [
            ...(data.presets || []).map((w) => ({ id: w.id, name: w.name || w.id })),
            ...(data.user || []).map((w) => ({ id: w.id, name: w.name || w.id })),
        ];
    }
    catch (e) {
        console.error('加载工作流失败:', e);
    }
}
// 创建需求
async function createAndExecute() {
    const text = newInput.value.trim();
    if (!text)
        return;
    creating.value = true;
    try {
        const reqId = `req-${Date.now()}`;
        const cr = await fetch('/api/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reqId, input_text: text, workflow_id: selectedWorkflowId.value }),
        });
        if (!cr.ok) {
            const e = await cr.json();
            ElMessage.error(e.error || '创建失败');
            return;
        }
        await api.execute(reqId, text);
        newInput.value = '';
        ElMessage.success('已创建并执行');
        loadList();
    }
    catch (e) {
        ElMessage.error(e?.message || '操作失败');
    }
    finally {
        creating.value = false;
    }
}
// 打开详情
async function openDetail(item) {
    drawerVisible.value = true;
    detail.value = null;
    detailLoading.value = true;
    try {
        detail.value = await api.get(item.id);
    }
    catch (e) {
        ElMessage.error(e?.message || '加载详情失败');
    }
    finally {
        detailLoading.value = false;
    }
}
// 停止执行
async function stopRequirement() {
    if (!detail.value)
        return;
    try {
        await ElMessageBox.confirm('确定停止该需求的执行吗？此操作不可恢复。', '停止确认', { type: 'warning' });
    }
    catch {
        return;
    }
    try {
        await api.stop(detail.value.id);
        ElMessage.success('已停止');
        detail.value = await api.get(detail.value.id);
        loadList();
    }
    catch (e) {
        ElMessage.error(e?.message || '停止失败');
    }
}
// Review gate 决策
async function gateDecision(decision) {
    if (!detail.value?.execution_id) {
        ElMessage.warning('无关联执行，无法操作 gate');
        return;
    }
    let comments;
    if (decision === 'reject') {
        try {
            const { value } = await ElMessageBox.prompt('请输入驳回意见（将带回上游节点重做）', '驳回', {
                confirmButtonText: '驳回', cancelButtonText: '取消', inputType: 'textarea', inputPlaceholder: '驳回意见...',
            });
            comments = value?.trim();
            if (!comments) {
                ElMessage.warning('驳回需填写意见');
                return;
            }
        }
        catch {
            return;
        }
    }
    try {
        await api.gate(detail.value.execution_id, decision, comments);
        ElMessage.success(decision === 'approve' ? '已通过' : '已驳回');
        detail.value = await api.get(detail.value.id);
        loadList();
    }
    catch (e) {
        ElMessage.error(e?.message || 'gate 操作失败');
    }
}
function openLog() {
    logDrawerVisible.value = true;
}
function goToCanvas() {
    if (!detail.value?.execution_id)
        return;
    router.push({ path: '/canvas', query: { execution_id: detail.value.execution_id } });
}
const hasSpec = computed(() => !!detail.value?.spec_content);
// 删除需求
async function deleteRequirement(item, event) {
    event?.stopPropagation();
    const status = aggStatus(item);
    if (status === 'running') {
        ElMessage.warning('需求正在执行中，请先停止后再删除');
        return;
    }
    try {
        await ElMessageBox.confirm('确定删除该需求吗？关联的任务和执行记录将被标记为已删除。', '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    }
    catch {
        return;
    }
    try {
        const res = await api.delete(item.id);
        if (res.ok) {
            ElMessage.success('已删除');
            loadList();
        }
        else {
            ElMessage.error(res.error || '删除失败');
        }
    }
    catch (e) {
        ElMessage.error(e?.message || '删除失败');
    }
}
// 详情抽屉中删除
async function deleteFromDetail() {
    if (!detail.value)
        return;
    if (detail.value.execution?.status === 'running') {
        ElMessage.warning('需求正在执行中，请先停止后再删除');
        return;
    }
    try {
        await ElMessageBox.confirm('确定删除该需求吗？关联的任务和执行记录将被标记为已删除。', '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    }
    catch {
        return;
    }
    try {
        const res = await api.delete(detail.value.id);
        if (res.ok) {
            ElMessage.success('已删除');
            drawerVisible.value = false;
            loadList();
        }
        else {
            ElMessage.error(res.error || '删除失败');
        }
    }
    catch (e) {
        ElMessage.error(e?.message || '删除失败');
    }
}
onMounted(() => { loadList(); loadWorkflows(); });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['workflow-select']} */ ;
/** @type {__VLS_StyleScopedClasses['create-input']} */ ;
/** @type {__VLS_StyleScopedClasses['create-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['create-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['search-input']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-refresh']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-card']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-card']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-card']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-card']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-card']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['pending']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['planned']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-delete-card']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-delete-card']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-value']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-value']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-value']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-danger']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-delete']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-delete']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['session-status']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['create-box']} */ ;
/** @type {__VLS_StyleScopedClasses['create-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['search-box']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "requirements-page" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "create-section" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "create-box" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "create-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.selectedWorkflowId),
    ...{ class: "workflow-select" },
    disabled: (__VLS_ctx.creating),
});
for (const [wf] of __VLS_getVForSourceType((__VLS_ctx.workflows))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
        key: (wf.id),
        value: (wf.id),
    });
    (wf.name);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.textarea, __VLS_intrinsicElements.textarea)({
    ...{ onKeyup: (__VLS_ctx.createAndExecute) },
    value: (__VLS_ctx.newInput),
    ...{ class: "create-input" },
    placeholder: "一句话描述需求，回车创建并执行...",
    disabled: (__VLS_ctx.creating),
    rows: "2",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "create-footer" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.createAndExecute) },
    ...{ class: "create-btn" },
    loading: (__VLS_ctx.creating),
    disabled: (!__VLS_ctx.newInput.trim()),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    'stroke-width': "2",
    width: "18",
    height: "18",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
    d: "M12 5v14M5 12h14",
});
if (__VLS_ctx.list.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "dashboard" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card total" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.summary.total);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
    if (__VLS_ctx.summary.running) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "stat-card running" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-value" },
        });
        (__VLS_ctx.summary.running);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-label" },
        });
    }
    if (__VLS_ctx.summary.paused) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "stat-card paused" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-value" },
        });
        (__VLS_ctx.summary.paused);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-label" },
        });
    }
    if (__VLS_ctx.summary.completed) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "stat-card completed" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-value" },
        });
        (__VLS_ctx.summary.completed);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-label" },
        });
    }
    if (__VLS_ctx.summary.failed) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "stat-card failed" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-value" },
        });
        (__VLS_ctx.summary.failed);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "stat-label" },
        });
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "search-box" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
    ...{ class: "search-icon" },
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    'stroke-width': "2",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.circle)({
    cx: "11",
    cy: "11",
    r: "8",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
    d: "M21 21l-4.35-4.35",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    value: (__VLS_ctx.searchText),
    type: "text",
    ...{ class: "search-input" },
    placeholder: "搜索需求...",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.loadList) },
    ...{ class: "btn-refresh" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    'stroke-width': "2",
    width: "16",
    height: "16",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
    d: "M23 4v6h-6M1 20v-6h6",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
    d: "M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "requirement-list" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
if (!__VLS_ctx.filteredList.length && !__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "hint" },
    });
}
for (const [item] of __VLS_getVForSourceType((__VLS_ctx.filteredList))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.openDetail(item);
            } },
        key: (item.id),
        ...{ class: "requirement-card" },
        ...{ class: (__VLS_ctx.aggStatus(item)) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "card-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "status-badge" },
        ...{ class: (__VLS_ctx.aggStatus(item)) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-icon" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-text" },
    });
    (__VLS_ctx.statusText(__VLS_ctx.aggStatus(item)));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "card-id" },
    });
    (item.id.slice(-12));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "card-content" },
    });
    (item.input_text);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "card-footer" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "card-time" },
    });
    (__VLS_ctx.formatTime(item.created_at));
    if (item.execution_status) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "card-exec-status" },
        });
        (__VLS_ctx.statusText(item.execution_status));
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.deleteRequirement(item, $event);
            } },
        ...{ class: "btn-delete-card" },
        disabled: (__VLS_ctx.aggStatus(item) === 'running'),
        title: "删除",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        'stroke-width': "2",
        width: "14",
        height: "14",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
        d: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
    });
}
const __VLS_0 = {}.ElDrawer;
/** @type {[typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    modelValue: (__VLS_ctx.drawerVisible),
    title: "需求详情",
    size: "600px",
    direction: "rtl",
    ...{ class: "detail-drawer" },
}));
const __VLS_2 = __VLS_1({
    modelValue: (__VLS_ctx.drawerVisible),
    title: "需求详情",
    size: "600px",
    direction: "rtl",
    ...{ class: "detail-drawer" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
if (__VLS_ctx.detail) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "drawer-content" },
    });
    __VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.detailLoading) }, null, null);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "detail-section status-section" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "status-badge-lg" },
        ...{ class: (__VLS_ctx.detail.status) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-icon" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-text" },
    });
    (__VLS_ctx.statusText(__VLS_ctx.detail.status));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "detail-title" },
    });
    (__VLS_ctx.detail.input_text);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-meta" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-id" },
    });
    (__VLS_ctx.detail.id);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-time" },
    });
    (__VLS_ctx.formatTime(__VLS_ctx.detail.created_at));
    if (__VLS_ctx.detail.execution?.status) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "exec-status-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "exec-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "exec-value" },
            ...{ class: (__VLS_ctx.detail.execution.status) },
        });
        (__VLS_ctx.statusText(__VLS_ctx.detail.execution.status));
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "detail-actions" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.openLog) },
        ...{ class: "btn btn-secondary" },
    });
    if (__VLS_ctx.detail.execution_id) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.goToCanvas) },
            ...{ class: "btn btn-primary" },
        });
    }
    if (__VLS_ctx.detail.execution_id && __VLS_ctx.detail.execution?.status === 'running') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.stopRequirement) },
            ...{ class: "btn btn-warning" },
        });
    }
    if (__VLS_ctx.detail.execution_id && __VLS_ctx.detail.execution?.status === 'paused') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.detail))
                        return;
                    if (!(__VLS_ctx.detail.execution_id && __VLS_ctx.detail.execution?.status === 'paused'))
                        return;
                    __VLS_ctx.gateDecision('approve');
                } },
            ...{ class: "btn btn-success" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.detail))
                        return;
                    if (!(__VLS_ctx.detail.execution_id && __VLS_ctx.detail.execution?.status === 'paused'))
                        return;
                    __VLS_ctx.gateDecision('reject');
                } },
            ...{ class: "btn btn-danger" },
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.deleteFromDetail) },
        ...{ class: "btn btn-delete" },
        disabled: (__VLS_ctx.detail.execution?.status === 'running'),
    });
    if (__VLS_ctx.hasSpec) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "detail-section collapsible" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.details, __VLS_intrinsicElements.details)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.summary, __VLS_intrinsicElements.summary)({
            ...{ class: "section-title" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
            ...{ class: "spec-content" },
        });
        (__VLS_ctx.detail.spec_content);
    }
    if (__VLS_ctx.detail.execution_id) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "detail-section" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({
            ...{ class: "section-header" },
        });
        /** @type {[typeof RequirementTreeView, ]} */ ;
        // @ts-ignore
        const __VLS_4 = __VLS_asFunctionalComponent(RequirementTreeView, new RequirementTreeView({
            requirementId: (__VLS_ctx.detail.id),
        }));
        const __VLS_5 = __VLS_4({
            requirementId: (__VLS_ctx.detail.id),
        }, ...__VLS_functionalComponentArgsRest(__VLS_4));
    }
    if (__VLS_ctx.detail.session_refs.length > 0) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "detail-section collapsible" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.details, __VLS_intrinsicElements.details)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.summary, __VLS_intrinsicElements.summary)({
            ...{ class: "section-title" },
        });
        (__VLS_ctx.detail.session_refs.length);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "session-list" },
        });
        for (const [s] of __VLS_getVForSourceType((__VLS_ctx.detail.session_refs))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (s.id),
                ...{ class: "session-item" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "session-meta" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "phase-name" },
            });
            (s.node_id);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "session-status" },
                ...{ class: (s.omnigent_status) },
            });
            (__VLS_ctx.statusText(s.omnigent_status));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "session-iter" },
            });
            (s.iteration);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.code, __VLS_intrinsicElements.code)({
                ...{ class: "session-id" },
            });
            (s.omnigent_session_id);
        }
    }
}
var __VLS_3;
/** @type {[typeof RequirementLogDrawer, ]} */ ;
// @ts-ignore
const __VLS_7 = __VLS_asFunctionalComponent(RequirementLogDrawer, new RequirementLogDrawer({
    modelValue: (__VLS_ctx.logDrawerVisible),
    requirementId: (__VLS_ctx.detail?.id || ''),
}));
const __VLS_8 = __VLS_7({
    modelValue: (__VLS_ctx.logDrawerVisible),
    requirementId: (__VLS_ctx.detail?.id || ''),
}, ...__VLS_functionalComponentArgsRest(__VLS_7));
/** @type {__VLS_StyleScopedClasses['requirements-page']} */ ;
/** @type {__VLS_StyleScopedClasses['create-section']} */ ;
/** @type {__VLS_StyleScopedClasses['create-box']} */ ;
/** @type {__VLS_StyleScopedClasses['create-header']} */ ;
/** @type {__VLS_StyleScopedClasses['workflow-select']} */ ;
/** @type {__VLS_StyleScopedClasses['create-input']} */ ;
/** @type {__VLS_StyleScopedClasses['create-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['create-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['dashboard']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['total']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['search-box']} */ ;
/** @type {__VLS_StyleScopedClasses['search-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['search-input']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-refresh']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-list']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['hint']} */ ;
/** @type {__VLS_StyleScopedClasses['requirement-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-header']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-text']} */ ;
/** @type {__VLS_StyleScopedClasses['card-id']} */ ;
/** @type {__VLS_StyleScopedClasses['card-content']} */ ;
/** @type {__VLS_StyleScopedClasses['card-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['card-time']} */ ;
/** @type {__VLS_StyleScopedClasses['card-exec-status']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-delete-card']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-drawer']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-content']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
/** @type {__VLS_StyleScopedClasses['status-section']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-text']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-title']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-id']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-time']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-status-row']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-label']} */ ;
/** @type {__VLS_StyleScopedClasses['exec-value']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-success']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-danger']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-delete']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['spec-content']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
/** @type {__VLS_StyleScopedClasses['section-header']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['session-list']} */ ;
/** @type {__VLS_StyleScopedClasses['session-item']} */ ;
/** @type {__VLS_StyleScopedClasses['session-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-name']} */ ;
/** @type {__VLS_StyleScopedClasses['session-status']} */ ;
/** @type {__VLS_StyleScopedClasses['session-iter']} */ ;
/** @type {__VLS_StyleScopedClasses['session-id']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            RequirementLogDrawer: RequirementLogDrawer,
            RequirementTreeView: RequirementTreeView,
            list: list,
            loading: loading,
            newInput: newInput,
            creating: creating,
            searchText: searchText,
            workflows: workflows,
            selectedWorkflowId: selectedWorkflowId,
            drawerVisible: drawerVisible,
            detail: detail,
            detailLoading: detailLoading,
            logDrawerVisible: logDrawerVisible,
            statusText: statusText,
            aggStatus: aggStatus,
            formatTime: formatTime,
            summary: summary,
            filteredList: filteredList,
            loadList: loadList,
            createAndExecute: createAndExecute,
            openDetail: openDetail,
            stopRequirement: stopRequirement,
            gateDecision: gateDecision,
            openLog: openLog,
            goToCanvas: goToCanvas,
            hasSpec: hasSpec,
            deleteRequirement: deleteRequirement,
            deleteFromDetail: deleteFromDetail,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
