/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/views/TaskDetail.vue —— 任务详情页（V4 重构）
// 设计简报：任务详情页重设计 Plan
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api/tasks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import LiveEventStream from '../components/execution/LiveEventStream.vue';
import ChatDrawer from '../components/drawers/ChatDrawer.vue';
import LogDrawer from '../components/drawers/LogDrawer.vue';
const route = useRoute();
const router = useRouter();
const taskId = computed(() => route.params.id);
const detail = ref(null);
const loading = ref(true);
const workflow = ref(null);
// 折叠状态
const rightDrawerVisible = ref(false);
const rightDrawerTab = ref('log');
const selectedPhaseIndex = ref(0); // 当前选中的流程节点索引
// review gate
const gateDecision = ref('approve');
const gateComments = ref('');
const gateSubmitting = ref(false);
// 状态文本映射
function statusText(status) {
    const map = {
        pending: '待执行', running: '执行中', completed: '已完成',
        failed: '失败', cancelled: '已取消', paused: '已暂停',
        rate_limited: '限流中',
    };
    return map[status] || status;
}
// 阶段结果：根据选中的节点过滤
const selectedPhaseOutputs = computed(() => {
    if (!detail.value)
        return [];
    const selected = phaseStatuses.value[selectedPhaseIndex.value];
    if (!selected)
        return [];
    return detail.value.phase_outputs.filter(po => po.node_id === selected.id);
});
// 点击流程节点
function selectPhase(index) {
    selectedPhaseIndex.value = index;
}
// Markdown 渲染（Task 6c）
function renderMarkdown(text) {
    if (!text)
        return '';
    try {
        const rawHtml = marked(text);
        return DOMPurify.sanitize(rawHtml);
    }
    catch {
        return text;
    }
}
const parsedBreakdown = computed(() => {
    const c = detail.value?.breakdown_content;
    if (!c)
        return null;
    if (typeof c === 'object') {
        return { kind: 'json', obj: c };
    }
    try {
        const obj = JSON.parse(c);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            return { kind: 'json', obj };
        }
    }
    catch { /* 非 JSON，按文本处理 */ }
    return { kind: 'text', text: c };
});
const title = computed(() => {
    // 优先使用 API 返回的 title 字段
    if (detail.value?.title)
        return detail.value.title;
    const p = parsedBreakdown.value;
    if (!p)
        return '(无标题)';
    if (p.kind === 'json')
        return p.obj.title || p.obj.task_type || '(无标题)';
    const firstLine = p.text.split('\n')[0] || '';
    return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine || '(无标题)';
});
const taskType = computed(() => parsedBreakdown.value?.kind === 'json' ? parsedBreakdown.value.obj.task_type : null);
const taskDescription = computed(() => parsedBreakdown.value?.kind === 'json' ? parsedBreakdown.value.obj.description : null);
// 拆分内容其余字段
const otherBreakdownFields = computed(() => {
    const p = parsedBreakdown.value;
    if (!p || p.kind !== 'json')
        return {};
    const { title: _t, task_type: _tt, description: _d, ...rest } = p.obj;
    return rest;
});
function fieldLabel(k) {
    const m = {
        acceptance_criteria: '验收标准', acceptance: '验收标准',
        priority: '优先级', files: '涉及文件', dependencies: '依赖',
        estimated_effort: '预估工作量', notes: '备注',
    };
    return m[k] || k;
}
function formatFieldValue(v) {
    if (v === null || v === undefined)
        return '';
    if (Array.isArray(v))
        return v.map(i => typeof i === 'object' && i !== null ? JSON.stringify(i) : String(i)).join('\n');
    if (typeof v === 'object')
        return JSON.stringify(v, null, 2);
    return String(v);
}
// 主 session ref
const mainSessionRef = computed(() => {
    if (!detail.value?.session_refs)
        return null;
    return detail.value.session_refs.find(r => r.role === 'main') || null;
});
// 推导状态
const effectiveStatus = computed(() => {
    const d = detail.value;
    if (!d)
        return 'pending';
    if (d.status !== 'pending')
        return d.status;
    const pos = d.phase_outputs;
    if (!pos.length)
        return 'pending';
    return pos.some(po => po.node_id === 'archive') ? 'completed' : 'running';
});
// 格式化时间
function formatTime(ts) {
    if (!ts)
        return '-';
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
function formatDuration(start, end) {
    if (!start)
        return '-';
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diff = Math.floor((endTime - startTime) / 1000);
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    return min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
}
// 阶段定义（按典型执行顺序）
// 支持两种命名体系：旧版（breakdown/planning/code/test/review/deploy/archive）
// 和新版工作流（develop/compile_check/test_check/quality_review/security_review/final_review）
const phaseOrder = ['breakdown', 'planning', 'develop', 'code', 'compile_check', 'test', 'test_check', 'review', 'quality_review', 'security_review', 'deploy', 'archive', 'final_review'];
const phaseStatuses = computed(() => {
    const d = detail.value;
    if (!d)
        return [];
    // 构建状态映射（从 session_refs）
    const statusMap = new Map();
    for (const sr of d.session_refs) {
        const existing = statusMap.get(sr.node_id);
        if (!existing || sr.iteration > existing.iteration) {
            statusMap.set(sr.node_id, {
                status: sr.omnigent_status === 'completed' ? 'done' : sr.omnigent_status,
                iteration: sr.iteration || 0,
                started_at: sr.started_at,
                completed_at: sr.completed_at,
            });
        }
    }
    // 按执行顺序排列（从 session_refs 的创建时间排序）
    const executionOrder = [...d.session_refs].sort((a, b) => {
        const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
        const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
        return aTime - bTime;
    });
    // 生成实际执行路径（保留重复节点以体现循环）
    const seen = new Map(); // node_id -> count
    return executionOrder.map((sr) => {
        const count = (seen.get(sr.node_id) || 0) + 1;
        seen.set(sr.node_id, count);
        const duration = sr.started_at && sr.completed_at
            ? formatDuration(sr.started_at, sr.completed_at)
            : null;
        const timeText = sr.omnigent_status === 'completed'
            ? (duration || '')
            : sr.omnigent_status === 'running'
                ? '进行中'
                : '';
        return {
            id: sr.node_id,
            label: phaseLabel(sr.node_id),
            status: sr.omnigent_status === 'completed' ? 'done' : sr.omnigent_status,
            iteration: sr.iteration || 0,
            duration,
            timeText,
        };
    });
});
function phaseLabel(id) {
    const map = {
        breakdown: '拆分', planning: '规划', code: '编码',
        test: '测试', review: '审查', deploy: '部署', archive: '归档',
        // 新版工作流节点
        develop: '开发', compile_check: '编译', test_check: '测试',
        write_tests: '写测试', // 添加 write_tests 映射
        quality_review: '质量审查', security_review: '安全审查', final_review: '终审',
        bug_fix: '修复', quality_issue_fix: '质量修复', security_issue_fix: '安全修复',
    };
    return map[id] || id;
}
// 加载数据
async function loadData() {
    loading.value = true;
    try {
        const data = await api.get(taskId.value);
        detail.value = data;
    }
    catch (e) {
        ElMessage.error(e?.message || '加载失败');
    }
    finally {
        loading.value = false;
    }
}
// 加载工作流定义
async function loadWorkflow() {
    if (!detail.value?.graph_definition_id) {
        workflow.value = null;
        return;
    }
    try {
        const res = await fetch(`/api/graph-definitions/${detail.value.graph_definition_id}`);
        workflow.value = await res.json();
    }
    catch (e) {
        console.warn('[TaskDetail] 加载工作流失败:', e);
        workflow.value = null;
    }
}
// 定时刷新
let refreshTimer = null;
onMounted(() => {
    loadData().then(() => {
        loadWorkflow();
    });
    refreshTimer = setInterval(() => {
        if (detail.value && ['running', 'rate_limited', 'paused', 'pending'].includes(effectiveStatus.value)) {
            loadData();
        }
    }, 5000);
});
onUnmounted(() => {
    if (refreshTimer)
        clearInterval(refreshTimer);
});
// 操作
async function pauseTask() {
    if (!detail.value)
        return;
    try {
        await ElMessageBox.confirm('确定暂停此任务吗？', '暂停确认', { type: 'warning' });
        await api.pause(detail.value.id);
        ElMessage.success('已暂停');
        loadData();
    }
    catch { }
}
async function cancelTask() {
    if (!detail.value)
        return;
    try {
        await ElMessageBox.confirm('确定取消此任务吗？取消后不可恢复', '取消确认', { type: 'warning' });
        await api.cancel(detail.value.id);
        ElMessage.success('已取消');
        loadData();
    }
    catch { }
}
async function resumeTask() {
    if (!detail.value)
        return;
    try {
        await api.resume(detail.value.id);
        ElMessage.success('已继续执行');
        loadData();
    }
    catch {
        ElMessage.error('继续失败');
    }
}
async function retryTask() {
    if (!detail.value)
        return;
    try {
        await api.retry(detail.value.id, detail.value.current_node_id || '');
        ElMessage.success('已重试');
        loadData();
    }
    catch {
        ElMessage.error('重试失败');
    }
}
// review gate 提交
async function submitGate() {
    if (!detail.value?.parent_execution_id)
        return;
    gateSubmitting.value = true;
    try {
        await api.gate(detail.value.parent_execution_id, gateDecision.value, gateComments.value);
        ElMessage.success('已提交审查决策');
        gateComments.value = '';
        loadData();
    }
    catch {
        ElMessage.error('提交失败');
    }
    finally {
        gateSubmitting.value = false;
    }
}
// 打开右侧抽屉
function openRightDrawer(tab) {
    rightDrawerTab.value = tab;
    rightDrawerVisible.value = true;
}
// 查看执行画布
function goToCanvas() {
    if (!detail.value)
        return;
    router.push({ path: '/canvas', query: { execution_id: detail.value.id } });
}
// 解析 JSONB 字段
function parseJson(v) {
    if (!v)
        return null;
    if (typeof v === 'string') {
        try {
            return JSON.parse(v);
        }
        catch {
            return null;
        }
    }
    return v;
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['breadcrumb-link']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['paused']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['rate_limited']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-node']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-node']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-node']} */ ;
/** @type {__VLS_StyleScopedClasses['selected']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-connector']} */ ;
/** @type {__VLS_StyleScopedClasses['done']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-connector']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-label']} */ ;
/** @type {__VLS_StyleScopedClasses['main-content-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-placeholder']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "task-detail" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
__VLS_asFunctionalElement(__VLS_intrinsicElements.nav, __VLS_intrinsicElements.nav)({
    ...{ class: "breadcrumb" },
});
const __VLS_0 = {}.RouterLink;
/** @type {[typeof __VLS_components.RouterLink, typeof __VLS_components.routerLink, typeof __VLS_components.RouterLink, typeof __VLS_components.routerLink, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    to: "/tasks",
    ...{ class: "breadcrumb-link" },
}));
const __VLS_2 = __VLS_1({
    to: "/tasks",
    ...{ class: "breadcrumb-link" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
var __VLS_3;
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "breadcrumb-sep" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "breadcrumb-current" },
});
(__VLS_ctx.title);
if (__VLS_ctx.detail) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "title-bar" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "title-bar-main" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "status-badge" },
        ...{ class: (__VLS_ctx.effectiveStatus) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-icon" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "status-label" },
    });
    (__VLS_ctx.statusText(__VLS_ctx.effectiveStatus));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
        ...{ class: "task-title" },
    });
    (__VLS_ctx.title);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-meta" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (__VLS_ctx.formatTime(__VLS_ctx.detail.started_at));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-sep" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (__VLS_ctx.formatDuration(__VLS_ctx.detail.started_at, __VLS_ctx.detail.finished_at));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "title-bar-actions" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.goToCanvas) },
        ...{ class: "btn btn-secondary" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.detail))
                    return;
                __VLS_ctx.openRightDrawer('chat');
            } },
        ...{ class: "btn btn-secondary" },
        disabled: (!__VLS_ctx.mainSessionRef),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.detail))
                    return;
                __VLS_ctx.openRightDrawer('log');
            } },
        ...{ class: "btn btn-secondary" },
    });
    if (__VLS_ctx.effectiveStatus === 'failed') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.retryTask) },
            ...{ class: "btn btn-primary" },
        });
    }
    if (__VLS_ctx.effectiveStatus === 'running') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.pauseTask) },
            ...{ class: "btn btn-warning" },
        });
    }
    if (__VLS_ctx.effectiveStatus === 'paused') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.resumeTask) },
            ...{ class: "btn btn-primary" },
        });
    }
}
if (__VLS_ctx.detail && __VLS_ctx.phaseStatuses.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "phase-flow-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "phase-flow" },
    });
    for (const [phase, idx] of __VLS_getVForSourceType((__VLS_ctx.phaseStatuses))) {
        (`${phase.id}-${idx}`);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.detail && __VLS_ctx.phaseStatuses.length))
                        return;
                    __VLS_ctx.selectPhase(idx);
                } },
            ...{ class: "phase-node" },
            ...{ class: ({ selected: __VLS_ctx.selectedPhaseIndex === idx }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "phase-dot" },
            ...{ class: (phase.status) },
        });
        if (phase.status === 'done') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
                width: "12",
                height: "12",
                viewBox: "0 0 12 12",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
                d: "M2.5 6.5L5 9L9.5 3",
                stroke: "currentColor",
                'stroke-width': "2",
                fill: "none",
                'stroke-linecap': "round",
                'stroke-linejoin': "round",
            });
        }
        else if (phase.status === 'failed') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
                width: "12",
                height: "12",
                viewBox: "0 0 12 12",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
                d: "M3 3L9 9M9 3L3 9",
                stroke: "currentColor",
                'stroke-width': "2",
                'stroke-linecap': "round",
            });
        }
        else if (phase.status === 'running') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "running-dot" },
            });
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "phase-info" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "phase-label" },
        });
        (phase.label);
        if (phase.timeText) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "phase-time" },
            });
            (phase.timeText);
        }
        if (idx < __VLS_ctx.phaseStatuses.length - 1) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "phase-connector" },
                ...{ class: (phase.status) },
            });
        }
    }
}
if (__VLS_ctx.detail && !__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "main-content-grid" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "main-col" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "content-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "card-title" },
    });
    if (!__VLS_ctx.selectedPhaseOutputs.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-state" },
        });
    }
    for (const [po] of __VLS_getVForSourceType((__VLS_ctx.selectedPhaseOutputs))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (po.id),
            ...{ class: "phase-result" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "phase-result-header" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "phase-result-title" },
        });
        (__VLS_ctx.phaseLabel(po.node_id));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "phase-result-time" },
        });
        (__VLS_ctx.formatTime(po.created_at));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "phase-result-body" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.renderMarkdown(po.value || '')) }, null, null);
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "side-col" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "content-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "card-title" },
    });
    if (!__VLS_ctx.parsedBreakdown) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-state" },
        });
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "breakdown-content" },
        });
        if (__VLS_ctx.parsedBreakdown.kind === 'json') {
            for (const [v, k] of __VLS_getVForSourceType((__VLS_ctx.otherBreakdownFields))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    key: (k),
                    ...{ class: "breakdown-field" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "breakdown-field-label" },
                });
                (__VLS_ctx.fieldLabel(String(k)));
                if (typeof v === 'object' && v !== null) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                        ...{ class: "breakdown-field-value" },
                    });
                    (__VLS_ctx.formatFieldValue(v));
                }
                else {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
                        ...{ class: "breakdown-field-text" },
                    });
                    (__VLS_ctx.formatFieldValue(v));
                }
            }
            if (!Object.keys(__VLS_ctx.otherBreakdownFields).length) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
                    ...{ class: "empty-state" },
                });
            }
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                ...{ class: "breakdown-raw" },
            });
            (__VLS_ctx.parsedBreakdown.text);
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "content-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "card-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "meta-list" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "meta-row" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-value mono" },
    });
    (__VLS_ctx.detail.id);
    if (__VLS_ctx.detail.requirement_id) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "meta-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-value mono" },
        });
        (__VLS_ctx.detail.requirement_id);
    }
    if (__VLS_ctx.detail.rate_limited_count) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "meta-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-value" },
        });
        (__VLS_ctx.detail.rate_limited_count);
    }
    if (__VLS_ctx.detail.phase_outputs.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "content-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
            ...{ class: "card-title" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "output-index" },
        });
        for (const [po] of __VLS_getVForSourceType((__VLS_ctx.detail.phase_outputs))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (po.id),
                ...{ class: "output-index-item" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "output-index-label" },
            });
            (__VLS_ctx.phaseLabel(po.node_id));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "output-index-time" },
            });
            (__VLS_ctx.formatTime(po.created_at));
        }
    }
}
else if (__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "loading-state" },
    });
    const __VLS_4 = {}.ElSkeleton;
    /** @type {[typeof __VLS_components.ElSkeleton, typeof __VLS_components.elSkeleton, ]} */ ;
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
        rows: (5),
        animated: true,
    }));
    const __VLS_6 = __VLS_5({
        rows: (5),
        animated: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_5));
}
const __VLS_8 = {}.ElDrawer;
/** @type {[typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    modelValue: (__VLS_ctx.rightDrawerVisible),
    title: (__VLS_ctx.rightDrawerTab === 'log' ? '执行日志' : '对话'),
    size: "480px",
    direction: "rtl",
    ...{ class: "right-drawer" },
}));
const __VLS_10 = __VLS_9({
    modelValue: (__VLS_ctx.rightDrawerVisible),
    title: (__VLS_ctx.rightDrawerTab === 'log' ? '执行日志' : '对话'),
    size: "480px",
    direction: "rtl",
    ...{ class: "right-drawer" },
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
__VLS_11.slots.default;
{
    const { header: __VLS_thisSlot } = __VLS_11.slots;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "drawer-tabs" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.rightDrawerTab = 'log';
            } },
        ...{ class: "drawer-tab" },
        ...{ class: ({ active: __VLS_ctx.rightDrawerTab === 'log' }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.rightDrawerTab = 'chat';
            } },
        ...{ class: "drawer-tab" },
        ...{ class: ({ active: __VLS_ctx.rightDrawerTab === 'chat' }) },
    });
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "drawer-body" },
});
if (__VLS_ctx.rightDrawerTab === 'log') {
    /** @type {[typeof LiveEventStream, ]} */ ;
    // @ts-ignore
    const __VLS_12 = __VLS_asFunctionalComponent(LiveEventStream, new LiveEventStream({
        executionId: (__VLS_ctx.detail?.id),
    }));
    const __VLS_13 = __VLS_12({
        executionId: (__VLS_ctx.detail?.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_12));
}
else if (__VLS_ctx.mainSessionRef) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "chat-placeholder" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "muted" },
    });
    (__VLS_ctx.mainSessionRef.id);
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
}
var __VLS_11;
/** @type {[typeof ChatDrawer, ]} */ ;
// @ts-ignore
const __VLS_15 = __VLS_asFunctionalComponent(ChatDrawer, new ChatDrawer({}));
const __VLS_16 = __VLS_15({}, ...__VLS_functionalComponentArgsRest(__VLS_15));
/** @type {[typeof LogDrawer, ]} */ ;
// @ts-ignore
const __VLS_18 = __VLS_asFunctionalComponent(LogDrawer, new LogDrawer({}));
const __VLS_19 = __VLS_18({}, ...__VLS_functionalComponentArgsRest(__VLS_18));
/** @type {__VLS_StyleScopedClasses['task-detail']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb-link']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb-sep']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb-current']} */ ;
/** @type {__VLS_StyleScopedClasses['title-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['title-bar-main']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-label']} */ ;
/** @type {__VLS_StyleScopedClasses['task-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-sep']} */ ;
/** @type {__VLS_StyleScopedClasses['title-bar-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-flow-card']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-flow']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-node']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['running-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-info']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-label']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-time']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-connector']} */ ;
/** @type {__VLS_StyleScopedClasses['main-content-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['main-col']} */ ;
/** @type {__VLS_StyleScopedClasses['content-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-header']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-title']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-time']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-result-body']} */ ;
/** @type {__VLS_StyleScopedClasses['side-col']} */ ;
/** @type {__VLS_StyleScopedClasses['content-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-content']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field-label']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field-value']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field-text']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-raw']} */ ;
/** @type {__VLS_StyleScopedClasses['content-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-list']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-row']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-label']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['mono']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-row']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-label']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['mono']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-row']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-label']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['content-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['output-index']} */ ;
/** @type {__VLS_StyleScopedClasses['output-index-item']} */ ;
/** @type {__VLS_StyleScopedClasses['output-index-label']} */ ;
/** @type {__VLS_StyleScopedClasses['output-index-time']} */ ;
/** @type {__VLS_StyleScopedClasses['loading-state']} */ ;
/** @type {__VLS_StyleScopedClasses['right-drawer']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer-body']} */ ;
/** @type {__VLS_StyleScopedClasses['chat-placeholder']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            LiveEventStream: LiveEventStream,
            ChatDrawer: ChatDrawer,
            LogDrawer: LogDrawer,
            detail: detail,
            loading: loading,
            rightDrawerVisible: rightDrawerVisible,
            rightDrawerTab: rightDrawerTab,
            selectedPhaseIndex: selectedPhaseIndex,
            statusText: statusText,
            selectedPhaseOutputs: selectedPhaseOutputs,
            selectPhase: selectPhase,
            renderMarkdown: renderMarkdown,
            parsedBreakdown: parsedBreakdown,
            title: title,
            otherBreakdownFields: otherBreakdownFields,
            fieldLabel: fieldLabel,
            formatFieldValue: formatFieldValue,
            mainSessionRef: mainSessionRef,
            effectiveStatus: effectiveStatus,
            formatTime: formatTime,
            formatDuration: formatDuration,
            phaseStatuses: phaseStatuses,
            phaseLabel: phaseLabel,
            pauseTask: pauseTask,
            resumeTask: resumeTask,
            retryTask: retryTask,
            openRightDrawer: openRightDrawer,
            goToCanvas: goToCanvas,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
