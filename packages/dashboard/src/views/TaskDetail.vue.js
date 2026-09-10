/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/views/TaskDetail.vue —— 任务详情页（V3 重构）
// 设计简报：https://claude.ai/skills/impeccable/shape-brief-taskdetail.md
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api/tasks';
import hljs from 'highlight.js/lib/core';
import diff from 'highlight.js/lib/languages/diff';
import LiveEventStream from '../components/execution/LiveEventStream.vue';
import ChatDrawer from '../components/drawers/ChatDrawer.vue';
import LogDrawer from '../components/drawers/LogDrawer.vue';
// 注册 diff 语言
hljs.registerLanguage('diff', diff);
const route = useRoute();
const router = useRouter();
const taskId = computed(() => route.params.id);
const detail = ref(null);
const loading = ref(true);
const workflow = ref(null);
// 折叠状态
const phaseOutputsExpanded = ref(false);
const breakdownExpanded = ref(false);
const rightDrawerVisible = ref(false);
const rightDrawerTab = ref('log');
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
        return phaseOrder.map(id => ({ id, label: phaseLabel(id), status: 'pending', iteration: 0 }));
    // 从工作流定义获取阶段列表
    const workflowNodes = workflow.value?.definition_json?.nodes || [];
    if (!workflow.value || workflowNodes.length === 0) {
        // 回退到硬编码（兼容旧数据）
        return phaseOrder.map(id => ({ id, label: phaseLabel(id), status: 'pending', iteration: 0 }));
    }
    // 构建状态映射（从 session_refs，因为 phase_outputs 为空）
    const statusMap = new Map();
    // 从 session_refs 获取状态（omnigent_status: completed/failed/running 等）
    for (const sr of d.session_refs) {
        const existing = statusMap.get(sr.node_id);
        if (!existing || sr.iteration > existing.iteration) {
            statusMap.set(sr.node_id, {
                status: sr.omnigent_status === 'completed' ? 'done' : sr.omnigent_status,
                iteration: sr.iteration || 0
            });
        }
    }
    // 当前节点
    const currentNode = d.current_node_id;
    // 从工作流节点生成阶段列表
    return workflowNodes.map((n) => {
        const phaseInfo = statusMap.get(n.id);
        return {
            id: n.id,
            label: n.name || n.id, // 使用 name，无则回退 id
            status: phaseInfo?.status
                || (n.id === currentNode ? 'running' : 'pending'),
            iteration: phaseInfo?.iteration || 0,
        };
    });
});
function phaseLabel(id) {
    const map = {
        breakdown: '拆分', planning: '规划', code: '编码',
        test: '测试', review: '审查', deploy: '部署', archive: '归档',
        // 新版工作流节点
        develop: '开发', compile_check: '编译', test_check: '测试',
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
// Diff 语法高亮
function highlightDiff(code) {
    try {
        return hljs.highlight(code, { language: 'diff' }).value;
    }
    catch {
        return code;
    }
}
function parseFileChanges(fc) {
    if (!fc)
        return [];
    if (Array.isArray(fc)) {
        return fc.map(f => ({
            action: f.action || f.type || 'modified',
            path: f.path || f.file || String(f),
        }));
    }
    return [];
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['breadcrumb-link']} */ ;
/** @type {__VLS_StyleScopedClasses['top-cards']} */ ;
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
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-danger']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-item']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-item']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-item']} */ ;
/** @type {__VLS_StyleScopedClasses['review-input']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['running']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['failed']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-header']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section']} */ ;
/** @type {__VLS_StyleScopedClasses['file-item']} */ ;
/** @type {__VLS_StyleScopedClasses['file-action']} */ ;
/** @type {__VLS_StyleScopedClasses['file-item']} */ ;
/** @type {__VLS_StyleScopedClasses['file-action']} */ ;
/** @type {__VLS_StyleScopedClasses['file-item']} */ ;
/** @type {__VLS_StyleScopedClasses['file-action']} */ ;
/** @type {__VLS_StyleScopedClasses['file-item']} */ ;
/** @type {__VLS_StyleScopedClasses['file-action']} */ ;
/** @type {__VLS_StyleScopedClasses['pr-link']} */ ;
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
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "main-content" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "top-cards" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "card status-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "status-header" },
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
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "task-id" },
    });
    (__VLS_ctx.detail.id.slice(-8));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
        ...{ class: "task-title" },
    });
    (__VLS_ctx.title);
    if (__VLS_ctx.taskDescription) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "task-description" },
        });
        (__VLS_ctx.taskDescription);
    }
    if (__VLS_ctx.taskType) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "task-type-tag" },
        });
        (__VLS_ctx.taskType);
    }
    if (__VLS_ctx.effectiveStatus === 'rate_limited') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "rate-limit-banner" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        (__VLS_ctx.detail.rate_limited_count ?? 0);
        if (__VLS_ctx.detail.rate_limited_until) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
            (__VLS_ctx.formatTime(__VLS_ctx.detail.rate_limited_until));
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "meta-grid" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "meta-item" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-value" },
    });
    (__VLS_ctx.formatTime(__VLS_ctx.detail.started_at));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "meta-item" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-value" },
    });
    (__VLS_ctx.formatDuration(__VLS_ctx.detail.started_at, __VLS_ctx.detail.finished_at));
    if (__VLS_ctx.detail.current_node_id) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "meta-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "meta-value mono" },
        });
        (__VLS_ctx.detail.current_node_id);
    }
    if (__VLS_ctx.detail.token_in || __VLS_ctx.detail.token_out || __VLS_ctx.detail.cost) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "token-stats" },
        });
        if (__VLS_ctx.detail.token_in) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "token-item" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "token-label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "token-value" },
            });
            (__VLS_ctx.detail.token_in.toLocaleString());
        }
        if (__VLS_ctx.detail.token_out) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "token-item" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "token-label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "token-value" },
            });
            (__VLS_ctx.detail.token_out.toLocaleString());
        }
        if (__VLS_ctx.detail.cost) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "token-item" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "token-label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "token-value" },
            });
            (Number(__VLS_ctx.detail.cost).toFixed(4));
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "action-bar" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.goToCanvas) },
        ...{ class: "btn btn-primary" },
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
    if (__VLS_ctx.effectiveStatus === 'running') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.pauseTask) },
            ...{ class: "btn btn-warning" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.cancelTask) },
            ...{ class: "btn btn-danger" },
        });
    }
    if (__VLS_ctx.effectiveStatus === 'paused') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.resumeTask) },
            ...{ class: "btn btn-primary" },
        });
    }
    if (__VLS_ctx.effectiveStatus === 'failed') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.retryTask) },
            ...{ class: "btn btn-primary" },
        });
    }
    if (__VLS_ctx.detail.parent_current_node_id?.startsWith('review_gate_')) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "review-gate-section" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "review-gate-header" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "review-gate-title" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "review-gate-hint" },
        });
        (__VLS_ctx.detail.parent_current_node_id);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "review-gate-body" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "radio-group" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
            ...{ class: "radio-item" },
            ...{ class: ({ checked: __VLS_ctx.gateDecision === 'approve' }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            type: "radio",
            value: "approve",
        });
        (__VLS_ctx.gateDecision);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "radio-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
            ...{ class: "radio-item" },
            ...{ class: ({ checked: __VLS_ctx.gateDecision === 'reject' }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            type: "radio",
            value: "reject",
        });
        (__VLS_ctx.gateDecision);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "radio-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.textarea, __VLS_intrinsicElements.textarea)({
            value: (__VLS_ctx.gateComments),
            ...{ class: "review-input" },
            placeholder: "审查意见（可选）",
            rows: "2",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.submitGate) },
            ...{ class: "btn btn-primary btn-block" },
            disabled: (__VLS_ctx.gateSubmitting),
        });
        (__VLS_ctx.gateSubmitting ? '提交中...' : '提交决策');
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "card progress-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "card-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "phase-flow" },
    });
    for (const [phase] of __VLS_getVForSourceType((__VLS_ctx.phaseStatuses))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (phase.id),
            ...{ class: "phase-chip" },
            ...{ class: (phase.status) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "phase-icon" },
        });
        if (phase.status === 'done') {
        }
        else if (phase.status === 'failed') {
        }
        else if (phase.status === 'running') {
        }
        else {
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "phase-label" },
        });
        (phase.label);
        if (phase.iteration > 0) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "phase-iter" },
            });
            (phase.iteration);
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-summary" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (__VLS_ctx.phaseStatuses.filter(p => p.status === 'done').length);
    (__VLS_ctx.phaseStatuses.length);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "card collapsible-card" },
        ...{ class: ({ expanded: __VLS_ctx.phaseOutputsExpanded }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.detail))
                    return;
                __VLS_ctx.phaseOutputsExpanded = !__VLS_ctx.phaseOutputsExpanded;
            } },
        ...{ class: "collapsible-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "card-title" },
    });
    if (__VLS_ctx.detail.phase_outputs.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "collapsible-meta" },
        });
        (__VLS_ctx.detail.phase_outputs.length);
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "collapsible-toggle" },
    });
    (__VLS_ctx.phaseOutputsExpanded ? '收起' : '展开');
    if (__VLS_ctx.phaseOutputsExpanded) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "collapsible-body" },
        });
        if (!__VLS_ctx.detail.phase_outputs.length) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "empty-state" },
            });
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "phase-outputs" },
            });
            for (const [po] of __VLS_getVForSourceType((__VLS_ctx.detail.phase_outputs))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
                    key: (po.id),
                    ...{ class: "phase-output-item" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
                    ...{ class: "po-header" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "po-node" },
                });
                (po.node_id);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "po-iteration" },
                });
                (po.iteration);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "po-time" },
                });
                (__VLS_ctx.formatTime(po.created_at));
                if (__VLS_ctx.parseFileChanges(__VLS_ctx.parseJson(po.file_changes)).length) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "po-section" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.h4, __VLS_intrinsicElements.h4)({
                        ...{ class: "po-section-title" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({
                        ...{ class: "file-list" },
                    });
                    for (const [fc, i] of __VLS_getVForSourceType((__VLS_ctx.parseFileChanges(__VLS_ctx.parseJson(po.file_changes))))) {
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
                            key: (i),
                            ...{ class: "file-item" },
                            ...{ class: (fc.action) },
                        });
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                            ...{ class: "file-action" },
                        });
                        (fc.action === 'new' || fc.action === 'added' ? '+' : fc.action === 'deleted' ? '-' : 'M');
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                            ...{ class: "file-path" },
                        });
                        (fc.path);
                    }
                }
                if (po.diff_content) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "po-section" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.h4, __VLS_intrinsicElements.h4)({
                        ...{ class: "po-section-title" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                        ...{ class: "diff-block" },
                    });
                    __VLS_asFunctionalDirective(__VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.highlightDiff(po.diff_content)) }, null, null);
                }
                if (po.pr_url) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "po-section" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.h4, __VLS_intrinsicElements.h4)({
                        ...{ class: "po-section-title" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
                        href: (po.pr_url),
                        target: "_blank",
                        ...{ class: "pr-link" },
                    });
                    (po.pr_url);
                }
                if (__VLS_ctx.parseJson(po.test_result)) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "po-section" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.h4, __VLS_intrinsicElements.h4)({
                        ...{ class: "po-section-title" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                        ...{ class: "json-block" },
                    });
                    (JSON.stringify(__VLS_ctx.parseJson(po.test_result), null, 2));
                }
                if (__VLS_ctx.parseJson(po.review_result)) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "po-section" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.h4, __VLS_intrinsicElements.h4)({
                        ...{ class: "po-section-title" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                        ...{ class: "json-block" },
                    });
                    (JSON.stringify(__VLS_ctx.parseJson(po.review_result), null, 2));
                }
            }
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "card collapsible-card" },
        ...{ class: ({ expanded: __VLS_ctx.breakdownExpanded }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.detail))
                    return;
                __VLS_ctx.breakdownExpanded = !__VLS_ctx.breakdownExpanded;
            } },
        ...{ class: "collapsible-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
        ...{ class: "card-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "collapsible-toggle" },
    });
    (__VLS_ctx.breakdownExpanded ? '收起' : '展开');
    if (__VLS_ctx.breakdownExpanded) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "collapsible-body" },
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
    }
}
const __VLS_4 = {}.ElDrawer;
/** @type {[typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, typeof __VLS_components.ElDrawer, typeof __VLS_components.elDrawer, ]} */ ;
// @ts-ignore
const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
    modelValue: (__VLS_ctx.rightDrawerVisible),
    title: (__VLS_ctx.rightDrawerTab === 'log' ? '执行日志' : '对话'),
    size: "480px",
    direction: "rtl",
    ...{ class: "right-drawer" },
}));
const __VLS_6 = __VLS_5({
    modelValue: (__VLS_ctx.rightDrawerVisible),
    title: (__VLS_ctx.rightDrawerTab === 'log' ? '执行日志' : '对话'),
    size: "480px",
    direction: "rtl",
    ...{ class: "right-drawer" },
}, ...__VLS_functionalComponentArgsRest(__VLS_5));
__VLS_7.slots.default;
{
    const { header: __VLS_thisSlot } = __VLS_7.slots;
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
    const __VLS_8 = __VLS_asFunctionalComponent(LiveEventStream, new LiveEventStream({
        executionId: (__VLS_ctx.detail?.id),
    }));
    const __VLS_9 = __VLS_8({
        executionId: (__VLS_ctx.detail?.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_8));
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
var __VLS_7;
/** @type {[typeof ChatDrawer, ]} */ ;
// @ts-ignore
const __VLS_11 = __VLS_asFunctionalComponent(ChatDrawer, new ChatDrawer({}));
const __VLS_12 = __VLS_11({}, ...__VLS_functionalComponentArgsRest(__VLS_11));
/** @type {[typeof LogDrawer, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(LogDrawer, new LogDrawer({}));
const __VLS_15 = __VLS_14({}, ...__VLS_functionalComponentArgsRest(__VLS_14));
/** @type {__VLS_StyleScopedClasses['task-detail']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb-link']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb-sep']} */ ;
/** @type {__VLS_StyleScopedClasses['breadcrumb-current']} */ ;
/** @type {__VLS_StyleScopedClasses['main-content']} */ ;
/** @type {__VLS_StyleScopedClasses['top-cards']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['status-card']} */ ;
/** @type {__VLS_StyleScopedClasses['status-header']} */ ;
/** @type {__VLS_StyleScopedClasses['status-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['status-label']} */ ;
/** @type {__VLS_StyleScopedClasses['task-id']} */ ;
/** @type {__VLS_StyleScopedClasses['task-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-description']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['rate-limit-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-item']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-label']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-item']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-label']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-item']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-label']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-value']} */ ;
/** @type {__VLS_StyleScopedClasses['mono']} */ ;
/** @type {__VLS_StyleScopedClasses['token-stats']} */ ;
/** @type {__VLS_StyleScopedClasses['token-item']} */ ;
/** @type {__VLS_StyleScopedClasses['token-label']} */ ;
/** @type {__VLS_StyleScopedClasses['token-value']} */ ;
/** @type {__VLS_StyleScopedClasses['token-item']} */ ;
/** @type {__VLS_StyleScopedClasses['token-label']} */ ;
/** @type {__VLS_StyleScopedClasses['token-value']} */ ;
/** @type {__VLS_StyleScopedClasses['token-item']} */ ;
/** @type {__VLS_StyleScopedClasses['token-label']} */ ;
/** @type {__VLS_StyleScopedClasses['token-value']} */ ;
/** @type {__VLS_StyleScopedClasses['action-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-danger']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['review-gate-section']} */ ;
/** @type {__VLS_StyleScopedClasses['review-gate-header']} */ ;
/** @type {__VLS_StyleScopedClasses['review-gate-title']} */ ;
/** @type {__VLS_StyleScopedClasses['review-gate-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['review-gate-body']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-group']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-item']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-label']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-item']} */ ;
/** @type {__VLS_StyleScopedClasses['radio-label']} */ ;
/** @type {__VLS_StyleScopedClasses['review-input']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-block']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-flow']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-label']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-iter']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-card']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-header']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-body']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-outputs']} */ ;
/** @type {__VLS_StyleScopedClasses['phase-output-item']} */ ;
/** @type {__VLS_StyleScopedClasses['po-header']} */ ;
/** @type {__VLS_StyleScopedClasses['po-node']} */ ;
/** @type {__VLS_StyleScopedClasses['po-iteration']} */ ;
/** @type {__VLS_StyleScopedClasses['po-time']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['file-list']} */ ;
/** @type {__VLS_StyleScopedClasses['file-item']} */ ;
/** @type {__VLS_StyleScopedClasses['file-action']} */ ;
/** @type {__VLS_StyleScopedClasses['file-path']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['diff-block']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['pr-link']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['json-block']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section']} */ ;
/** @type {__VLS_StyleScopedClasses['po-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['json-block']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-card']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-header']} */ ;
/** @type {__VLS_StyleScopedClasses['card-title']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsible-body']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-content']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field-label']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field-value']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-field-text']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['breakdown-raw']} */ ;
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
            phaseOutputsExpanded: phaseOutputsExpanded,
            breakdownExpanded: breakdownExpanded,
            rightDrawerVisible: rightDrawerVisible,
            rightDrawerTab: rightDrawerTab,
            gateDecision: gateDecision,
            gateComments: gateComments,
            gateSubmitting: gateSubmitting,
            statusText: statusText,
            parsedBreakdown: parsedBreakdown,
            title: title,
            taskType: taskType,
            taskDescription: taskDescription,
            otherBreakdownFields: otherBreakdownFields,
            fieldLabel: fieldLabel,
            formatFieldValue: formatFieldValue,
            mainSessionRef: mainSessionRef,
            effectiveStatus: effectiveStatus,
            formatTime: formatTime,
            formatDuration: formatDuration,
            phaseStatuses: phaseStatuses,
            pauseTask: pauseTask,
            cancelTask: cancelTask,
            resumeTask: resumeTask,
            retryTask: retryTask,
            submitGate: submitGate,
            openRightDrawer: openRightDrawer,
            goToCanvas: goToCanvas,
            parseJson: parseJson,
            highlightDiff: highlightDiff,
            parseFileChanges: parseFileChanges,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
