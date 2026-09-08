/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/views/Tasks.vue —— 任务列表页（V3 重构）
// 状态分组列表 + 概览仪表板 + 改进的筛选交互
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api/tasks';
import { tasks, loading, loadList, openChatDrawer, openLogDrawer, } from '../stores/tasks';
import ChatDrawer from '../components/drawers/ChatDrawer.vue';
import LogDrawer from '../components/drawers/LogDrawer.vue';
const requirements = ref([]);
const selectedReqId = ref('');
const router = useRouter();
const searchText = ref('');
const statusFilter = ref([]);
// 状态优先级排序
const statusPriority = ['running', 'rate_limited', 'paused', 'draft', 'pending', 'failed', 'cancelled', 'completed'];
const filterableStatuses = ['draft', 'pending', 'running', 'rate_limited', 'paused', 'completed', 'failed', 'cancelled'];
// 状态文本
function statusText(status) {
    const map = {
        draft: '待确认', pending: '待执行', running: '执行中', completed: '已完成',
        failed: '失败', cancelled: '已取消', paused: '已暂停',
        rate_limited: '限流中',
    };
    return map[status] || status;
}
// 标题提取
function taskTitle(row) {
    // 优先使用 title 字段（V4 Task 模型）
    if (row.title)
        return row.title;
    // fallback: 从 breakdown_content 解析（V3 兼容）
    const c = row.breakdown_content || '';
    try {
        const obj = JSON.parse(c);
        if (obj && typeof obj === 'object' && obj.title) {
            return obj.title;
        }
    }
    catch { }
    // fallback: 首行
    const firstLine = c.split('\n')[0] || '';
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine || '(无标题)';
}
// 过滤 + 排序后的列表
const filteredTasks = computed(() => {
    let list = tasks.value;
    if (searchText.value) {
        const kw = searchText.value.toLowerCase();
        list = list.filter(t => taskTitle(t).toLowerCase().includes(kw) ||
            t.id.toLowerCase().includes(kw));
    }
    if (statusFilter.value.length > 0) {
        list = list.filter(t => statusFilter.value.includes(t.status));
    }
    return [...list].sort((a, b) => {
        const pa = statusPriority.indexOf(a.status);
        const pb = statusPriority.indexOf(b.status);
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    });
});
// 按状态分组
const groupedTasks = computed(() => {
    const groups = {
        running: [],
        rate_limited: [],
        paused: [],
        draft: [],
        pending: [],
        failed: [],
        completed: [],
        cancelled: [],
    };
    for (const t of filteredTasks.value) {
        if (groups[t.status]) {
            groups[t.status].push(t);
        }
    }
    return groups;
});
// 汇总统计
const taskSummary = computed(() => {
    const total = tasks.value.length;
    const running = tasks.value.filter(t => t.status === 'running').length;
    const rateLimited = tasks.value.filter(t => t.status === 'rate_limited').length;
    const draft = tasks.value.filter(t => t.status === 'draft').length;
    const pending = tasks.value.filter(t => t.status === 'pending').length;
    const paused = tasks.value.filter(t => t.status === 'paused').length;
    const completed = tasks.value.filter(t => t.status === 'completed').length;
    const failed = tasks.value.filter(t => t.status === 'failed').length;
    const cancelled = tasks.value.filter(t => t.status === 'cancelled').length;
    return { total, running, rateLimited, draft, pending, paused, completed, failed, cancelled };
});
// 重要的状态组（优先显示）
const priorityGroups = ['running', 'rate_limited', 'paused', 'draft', 'failed'];
const normalGroups = ['pending', 'completed', 'cancelled'];
// 加载需求列表
async function loadRequirements() {
    try {
        const r = await fetch('/api/requirements');
        requirements.value = await r.json();
    }
    catch (e) {
        console.error('加载需求列表失败', e);
    }
}
// 监听需求筛选变化
watch(selectedReqId, (newVal) => {
    loadList(newVal || undefined);
});
onMounted(() => {
    loadRequirements();
    loadList();
});
function toggleStatus(status) {
    const idx = statusFilter.value.indexOf(status);
    if (idx >= 0) {
        statusFilter.value = statusFilter.value.filter(s => s !== status);
    }
    else {
        statusFilter.value = [...statusFilter.value, status];
    }
}
function openDetail(task) {
    router.push(`/tasks/${task.id}`);
}
async function pauseTask(task) {
    try {
        await ElMessageBox.confirm('确定要暂停吗？', '暂停确认', { type: 'warning' });
        await api.pause(task.id);
        ElMessage.success('已请求暂停');
        loadList();
    }
    catch { }
}
async function cancelTask(task) {
    try {
        await ElMessageBox.confirm('确定要取消吗？取消后不可恢复', '取消确认', { type: 'warning' });
        await api.cancel(task.id);
        ElMessage.success('已请求取消');
        loadList();
    }
    catch { }
}
async function resumeTask(task) {
    try {
        await api.resume(task.id);
        ElMessage.success('已继续执行');
        loadList();
    }
    catch (e) {
        ElMessage.error('继续失败');
    }
}
async function retryTask(task) {
    try {
        await api.retry(task.id, task.current_node_id || '');
        ElMessage.success('已重试');
        loadList();
    }
    catch (e) {
        ElMessage.error('重试失败');
    }
}
async function confirmTask(task, event) {
    event?.stopPropagation();
    try {
        const res = await api.confirm(task.id);
        if (res.ok) {
            ElMessage.success('已确认，任务将开始执行');
            loadList();
        }
        else {
            ElMessage.error(res.error || '确认失败');
        }
    }
    catch (e) {
        ElMessage.error(e?.message || '确认失败');
    }
}
// 删除任务
async function deleteTask(task, event) {
    event?.stopPropagation();
    if (task.status === 'running') {
        ElMessage.warning('任务正在执行中，请先停止后再删除');
        return;
    }
    try {
        await ElMessageBox.confirm('确定删除该任务吗？执行记录和 Session 数据将被标记为已删除。', '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    }
    catch {
        return;
    }
    try {
        const res = await api.delete(task.id);
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
// 格式化时间
function formatTime(ts) {
    if (!ts)
        return '-';
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
// 用时计算
function duration(start, end) {
    if (!start)
        return '-';
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diff = Math.floor((endTime - startTime) / 1000);
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    return min > 0 ? `${min}分${sec}秒` : `${sec}秒`;
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['rate-limited']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['draft']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['search-input']} */ ;
/** @type {__VLS_StyleScopedClasses['req-filter']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['draft']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-refresh']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['rate_limited']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['draft']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['rate_limited']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['draft']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['pending']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['rate_limited']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['primary']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['warn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['danger']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['delete']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['delete']} */ ;
/** @type {__VLS_StyleScopedClasses['group-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['group-details']} */ ;
/** @type {__VLS_StyleScopedClasses['group-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['group-details']} */ ;
/** @type {__VLS_StyleScopedClasses['group-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['dashboard']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['search-box']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chips']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-actions']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "tasks-page" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "dashboard" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "stat-card total" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "stat-value" },
});
(__VLS_ctx.taskSummary.total);
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "stat-label" },
});
if (__VLS_ctx.taskSummary.running) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card running" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.running);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
}
if (__VLS_ctx.taskSummary.rateLimited) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card rate-limited" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.rateLimited);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
}
if (__VLS_ctx.taskSummary.paused) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card paused" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.paused);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
}
if (__VLS_ctx.taskSummary.draft) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card draft" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.draft);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
}
if (__VLS_ctx.taskSummary.pending) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card pending" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.pending);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
}
if (__VLS_ctx.taskSummary.failed) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card failed" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.failed);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
}
if (__VLS_ctx.taskSummary.completed) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stat-card completed" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-value" },
    });
    (__VLS_ctx.taskSummary.completed);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "stat-label" },
    });
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
    placeholder: "搜索任务...",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.selectedReqId),
    ...{ class: "req-filter" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "",
});
for (const [req] of __VLS_getVForSourceType((__VLS_ctx.requirements))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
        key: (req.id),
        value: (req.id),
    });
    (req.input_text?.slice(0, 30) || req.id);
    (req.input_text?.length > 30 ? '...' : '');
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "filter-chips" },
});
for (const [s] of __VLS_getVForSourceType((__VLS_ctx.filterableStatuses))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.toggleStatus(s);
            } },
        key: (s),
        ...{ class: "filter-chip" },
        ...{ class: ([s, { active: __VLS_ctx.statusFilter.includes(s) }]) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "chip-dot" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "chip-label" },
    });
    (__VLS_ctx.statusText(s));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "chip-count" },
    });
    (__VLS_ctx.groupedTasks[s]?.length || 0);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.loadList(__VLS_ctx.selectedReqId || undefined);
        } },
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
    ...{ class: "task-groups" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
for (const [group] of __VLS_getVForSourceType((__VLS_ctx.priorityGroups))) {
    (group);
    if (__VLS_ctx.groupedTasks[group]?.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "task-group" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
            ...{ class: "group-header" },
            ...{ class: (group) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "group-icon" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "group-title" },
        });
        (__VLS_ctx.statusText(group));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "group-count" },
        });
        (__VLS_ctx.groupedTasks[group].length);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-cards" },
        });
        for (const [task] of __VLS_getVForSourceType((__VLS_ctx.groupedTasks[group]))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.openDetail(task);
                    } },
                key: (task.id),
                ...{ class: "task-card" },
                ...{ class: (group) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "card-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({
                ...{ class: "card-title" },
            });
            (__VLS_ctx.taskTitle(task));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "card-meta" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "card-id" },
            });
            (task.id.slice(-8));
            if (task.current_node_id) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "card-node" },
                });
                (task.current_node_id);
            }
            if (task.rate_limited_count && group === 'rate_limited') {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "card-limit" },
                });
                (task.rate_limited_count);
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: () => { } },
                ...{ class: "card-actions" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.openChatDrawer(task);
                    } },
                ...{ class: "action-btn" },
                disabled: (!task.session_ref_id),
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.openLogDrawer(task);
                    } },
                ...{ class: "action-btn" },
            });
            if (group === 'running') {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!(__VLS_ctx.groupedTasks[group]?.length))
                                return;
                            if (!(group === 'running'))
                                return;
                            __VLS_ctx.pauseTask(task);
                        } },
                    ...{ class: "action-btn warn" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!(__VLS_ctx.groupedTasks[group]?.length))
                                return;
                            if (!(group === 'running'))
                                return;
                            __VLS_ctx.cancelTask(task);
                        } },
                    ...{ class: "action-btn danger" },
                });
            }
            if (group === 'draft') {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!(__VLS_ctx.groupedTasks[group]?.length))
                                return;
                            if (!(group === 'draft'))
                                return;
                            __VLS_ctx.confirmTask(task, $event);
                        } },
                    ...{ class: "action-btn primary" },
                });
            }
            if (group === 'paused') {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!(__VLS_ctx.groupedTasks[group]?.length))
                                return;
                            if (!(group === 'paused'))
                                return;
                            __VLS_ctx.resumeTask(task);
                        } },
                    ...{ class: "action-btn primary" },
                });
            }
            if (group === 'failed') {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!(__VLS_ctx.groupedTasks[group]?.length))
                                return;
                            if (!(group === 'failed'))
                                return;
                            __VLS_ctx.retryTask(task);
                        } },
                    ...{ class: "action-btn primary" },
                });
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.deleteTask(task, $event);
                    } },
                ...{ class: "action-btn delete" },
                disabled: (task.status === 'running'),
            });
        }
    }
}
for (const [group] of __VLS_getVForSourceType((__VLS_ctx.normalGroups))) {
    (group);
    if (__VLS_ctx.groupedTasks[group]?.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "task-group collapsed" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
            ...{ class: "group-header" },
            ...{ class: (group) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "group-icon" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "group-title" },
        });
        (__VLS_ctx.statusText(group));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "group-count" },
        });
        (__VLS_ctx.groupedTasks[group].length);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.details, __VLS_intrinsicElements.details)({
            ...{ class: "group-details" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.summary, __VLS_intrinsicElements.summary)({
            ...{ class: "group-toggle" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-cards" },
        });
        for (const [task] of __VLS_getVForSourceType((__VLS_ctx.groupedTasks[group]))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.openDetail(task);
                    } },
                key: (task.id),
                ...{ class: "task-card" },
                ...{ class: (group) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "card-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({
                ...{ class: "card-title" },
            });
            (__VLS_ctx.taskTitle(task));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "card-meta" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "card-id" },
            });
            (task.id.slice(-8));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: () => { } },
                ...{ class: "card-actions" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.openChatDrawer(task);
                    } },
                ...{ class: "action-btn" },
                disabled: (!task.session_ref_id),
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.openLogDrawer(task);
                    } },
                ...{ class: "action-btn" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.groupedTasks[group]?.length))
                            return;
                        __VLS_ctx.deleteTask(task, $event);
                    } },
                ...{ class: "action-btn delete" },
            });
        }
    }
}
if (!__VLS_ctx.filteredTasks.length && !__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
}
/** @type {[typeof ChatDrawer, ]} */ ;
// @ts-ignore
const __VLS_0 = __VLS_asFunctionalComponent(ChatDrawer, new ChatDrawer({}));
const __VLS_1 = __VLS_0({}, ...__VLS_functionalComponentArgsRest(__VLS_0));
/** @type {[typeof LogDrawer, ]} */ ;
// @ts-ignore
const __VLS_3 = __VLS_asFunctionalComponent(LogDrawer, new LogDrawer({}));
const __VLS_4 = __VLS_3({}, ...__VLS_functionalComponentArgsRest(__VLS_3));
/** @type {__VLS_StyleScopedClasses['tasks-page']} */ ;
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
/** @type {__VLS_StyleScopedClasses['rate-limited']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['draft']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['pending']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-card']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['search-box']} */ ;
/** @type {__VLS_StyleScopedClasses['search-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['search-input']} */ ;
/** @type {__VLS_StyleScopedClasses['req-filter']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chips']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-label']} */ ;
/** @type {__VLS_StyleScopedClasses['chip-count']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-refresh']} */ ;
/** @type {__VLS_StyleScopedClasses['task-groups']} */ ;
/** @type {__VLS_StyleScopedClasses['task-group']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-title']} */ ;
/** @type {__VLS_StyleScopedClasses['group-count']} */ ;
/** @type {__VLS_StyleScopedClasses['task-cards']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-main']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['card-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['card-id']} */ ;
/** @type {__VLS_StyleScopedClasses['card-node']} */ ;
/** @type {__VLS_StyleScopedClasses['card-limit']} */ ;
/** @type {__VLS_StyleScopedClasses['card-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['warn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['danger']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['primary']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['primary']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['primary']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['delete']} */ ;
/** @type {__VLS_StyleScopedClasses['task-group']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsed']} */ ;
/** @type {__VLS_StyleScopedClasses['group-header']} */ ;
/** @type {__VLS_StyleScopedClasses['group-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['group-title']} */ ;
/** @type {__VLS_StyleScopedClasses['group-count']} */ ;
/** @type {__VLS_StyleScopedClasses['group-details']} */ ;
/** @type {__VLS_StyleScopedClasses['group-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-cards']} */ ;
/** @type {__VLS_StyleScopedClasses['task-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-main']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['card-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['card-id']} */ ;
/** @type {__VLS_StyleScopedClasses['card-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['delete']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            loading: loading,
            loadList: loadList,
            openChatDrawer: openChatDrawer,
            openLogDrawer: openLogDrawer,
            ChatDrawer: ChatDrawer,
            LogDrawer: LogDrawer,
            requirements: requirements,
            selectedReqId: selectedReqId,
            searchText: searchText,
            statusFilter: statusFilter,
            filterableStatuses: filterableStatuses,
            statusText: statusText,
            taskTitle: taskTitle,
            filteredTasks: filteredTasks,
            groupedTasks: groupedTasks,
            taskSummary: taskSummary,
            priorityGroups: priorityGroups,
            normalGroups: normalGroups,
            toggleStatus: toggleStatus,
            openDetail: openDetail,
            pauseTask: pauseTask,
            cancelTask: cancelTask,
            resumeTask: resumeTask,
            retryTask: retryTask,
            confirmTask: confirmTask,
            deleteTask: deleteTask,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
