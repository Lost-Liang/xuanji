/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// views/Requirements.vue —— 需求列表页（V4 树形布局）
// 顶部：创建框 + 概览统计 + 搜索工具栏
// 主体：RequirementTreeView（全宽树 + 行操作，内部管理日志抽屉）
import { ref, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api/requirements';
import { api as projectApi } from '../api/projects';
import RequirementTreeView from '../components/RequirementTreeView.vue';
const list = ref([]);
const loading = ref(false);
const newInput = ref('');
const creating = ref(false);
const searchText = ref('');
// 项目选择（必选）
const projects = ref([]);
const selectedProjectId = ref('');
// 计算实际使用的路径
const targetRepoPath = computed(() => {
    if (selectedProjectId.value) {
        const p = projects.value.find(x => x.id === selectedProjectId.value);
        return p?.path || '';
    }
    return '';
});
// 工作流选择
const workflows = ref([]);
const selectedWorkflowId = ref('requirement-decomposition');
// 聚合状态
function aggStatus(item) {
    return item.execution_status || item.status;
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
// 加载项目列表
async function loadProjects() {
    try {
        projects.value = await projectApi.list();
    }
    catch (e) {
        console.error('加载项目列表失败:', e);
    }
}
// 创建需求
async function createAndExecute() {
    const text = newInput.value.trim();
    if (!text)
        return;
    if (!selectedProjectId.value) {
        ElMessage.warning('请选择项目');
        return;
    }
    creating.value = true;
    try {
        const reqId = `req-${Date.now()}`;
        const payload = {
            id: reqId,
            input_text: text,
            workflow_id: selectedWorkflowId.value,
            targetRepoPath: targetRepoPath.value || undefined,
        };
        const cr = await fetch('/api/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!cr.ok) {
            const e = await cr.json();
            ElMessage.error(e.error || '创建失败');
            return;
        }
        await api.execute(reqId, text);
        newInput.value = '';
        selectedProjectId.value = '';
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
onMounted(() => { loadList(); loadWorkflows(); loadProjects(); });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['workflow-select']} */ ;
/** @type {__VLS_StyleScopedClasses['create-input']} */ ;
/** @type {__VLS_StyleScopedClasses['project-select']} */ ;
/** @type {__VLS_StyleScopedClasses['project-select']} */ ;
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
/** @type {__VLS_StyleScopedClasses['create-box']} */ ;
/** @type {__VLS_StyleScopedClasses['create-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['search-box']} */ ;
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
    ...{ class: "project-select-row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "project-label" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.selectedProjectId),
    ...{ class: "project-select" },
    disabled: (__VLS_ctx.creating),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "",
    disabled: true,
});
for (const [p] of __VLS_getVForSourceType((__VLS_ctx.projects))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
        key: (p.id),
        value: (p.id),
    });
    (p.name);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "create-footer" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.createAndExecute) },
    ...{ class: "create-btn" },
    disabled: (!__VLS_ctx.newInput.trim() || !__VLS_ctx.selectedProjectId),
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
/** @type {[typeof RequirementTreeView, ]} */ ;
// @ts-ignore
const __VLS_0 = __VLS_asFunctionalComponent(RequirementTreeView, new RequirementTreeView({
    ...{ 'onRefresh': {} },
    requirements: (__VLS_ctx.filteredList),
}));
const __VLS_1 = __VLS_0({
    ...{ 'onRefresh': {} },
    requirements: (__VLS_ctx.filteredList),
}, ...__VLS_functionalComponentArgsRest(__VLS_0));
let __VLS_3;
let __VLS_4;
let __VLS_5;
const __VLS_6 = {
    onRefresh: (__VLS_ctx.loadList)
};
var __VLS_2;
/** @type {__VLS_StyleScopedClasses['requirements-page']} */ ;
/** @type {__VLS_StyleScopedClasses['create-section']} */ ;
/** @type {__VLS_StyleScopedClasses['create-box']} */ ;
/** @type {__VLS_StyleScopedClasses['create-header']} */ ;
/** @type {__VLS_StyleScopedClasses['workflow-select']} */ ;
/** @type {__VLS_StyleScopedClasses['create-input']} */ ;
/** @type {__VLS_StyleScopedClasses['project-select-row']} */ ;
/** @type {__VLS_StyleScopedClasses['project-label']} */ ;
/** @type {__VLS_StyleScopedClasses['project-select']} */ ;
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
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            RequirementTreeView: RequirementTreeView,
            list: list,
            newInput: newInput,
            creating: creating,
            searchText: searchText,
            projects: projects,
            selectedProjectId: selectedProjectId,
            workflows: workflows,
            selectedWorkflowId: selectedWorkflowId,
            summary: summary,
            filteredList: filteredList,
            loadList: loadList,
            createAndExecute: createAndExecute,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
