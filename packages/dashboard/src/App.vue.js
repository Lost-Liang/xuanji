/// <reference types="../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { Odometer, Document, List, Monitor, Setting, Collection, Operation, ChatDotRound, Folder } from '@element-plus/icons-vue';
const route = useRoute();
const menus = [
    { path: '/canvas', match: '/canvas', label: '流程画布', icon: Odometer },
    { path: '/projects', match: '/projects', label: '项目管理', icon: Folder },
    { path: '/requirements', match: '/requirements', label: '需求管理', icon: Document },
    { path: '/tasks', match: '/tasks', label: '任务列表', icon: List },
    { path: '/executions', match: '/executions', label: '执行概览', icon: Monitor },
    { path: '/inbox', match: '/inbox', label: '人机交互', icon: ChatDotRound },
    { path: '/agents', match: '/agents', label: 'Agent配置', icon: Setting },
    { path: '/skills', match: '/skills', label: 'Skill配置', icon: Collection },
    { path: '/workflows', match: '/workflows', label: '工作流列表', icon: Operation },
];
const activeMenu = computed(() => {
    if (route.path.startsWith('/tasks'))
        return '/tasks';
    if (route.path.startsWith('/requirements'))
        return '/requirements';
    if (route.path.startsWith('/conversations/'))
        return '/inbox';
    return route.path;
});
const titleMap = {
    '/canvas': '流程画布',
    '/projects': '项目管理',
    '/requirements': '需求管理',
    '/tasks': '任务列表',
    '/executions': '执行概览',
    '/inbox': '人机交互',
    '/agents': 'Agent配置',
    '/skills': 'Skill配置',
    '/workflows': '工作流列表',
};
const currentTitle = computed(() => {
    if (route.path.startsWith('/tasks'))
        return '任务列表';
    if (route.path.startsWith('/requirements'))
        return '需求管理';
    if (route.path.startsWith('/conversations/'))
        return '对话历史';
    return titleMap[route.path] ?? '';
});
// Host 状态
const hostStatus = ref('checking');
const hostStatusText = computed(() => {
    switch (hostStatus.value) {
        case 'online': return 'online';
        case 'offline': return 'offline';
        default: return 'checking…';
    }
});
async function checkHostStatus() {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        hostStatus.value = data.status === 'ok' ? 'online' : 'offline';
    }
    catch {
        hostStatus.value = 'offline';
    }
}
let timer;
onMounted(() => {
    checkHostStatus();
    timer = setInterval(checkHostStatus, 30000);
});
onUnmounted(() => clearInterval(timer));
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['el-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['host-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['host-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['host-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['crumb']} */ ;
/** @type {__VLS_StyleScopedClasses['crumb']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "app" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.aside, __VLS_intrinsicElements.aside)({
    ...{ class: "side" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "brand" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.img, __VLS_intrinsicElements.img)({
    src: "/favicon.svg",
    ...{ class: "logo-icon" },
    alt: "璇玑",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "name" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.nav, __VLS_intrinsicElements.nav)({
    ...{ class: "nav" },
});
for (const [m] of __VLS_getVForSourceType((__VLS_ctx.menus))) {
    const __VLS_0 = {}.RouterLink;
    /** @type {[typeof __VLS_components.RouterLink, typeof __VLS_components.routerLink, typeof __VLS_components.RouterLink, typeof __VLS_components.routerLink, ]} */ ;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
        key: (m.path),
        to: (m.path),
        ...{ class: "nav-item" },
        ...{ class: ({ active: __VLS_ctx.activeMenu === m.match }) },
    }));
    const __VLS_2 = __VLS_1({
        key: (m.path),
        to: (m.path),
        ...{ class: "nav-item" },
        ...{ class: ({ active: __VLS_ctx.activeMenu === m.match }) },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    __VLS_3.slots.default;
    const __VLS_4 = {}.ElIcon;
    /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({}));
    const __VLS_6 = __VLS_5({}, ...__VLS_functionalComponentArgsRest(__VLS_5));
    __VLS_7.slots.default;
    const __VLS_8 = ((m.icon));
    // @ts-ignore
    const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({}));
    const __VLS_10 = __VLS_9({}, ...__VLS_functionalComponentArgsRest(__VLS_9));
    var __VLS_7;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "label" },
    });
    (m.label);
    if (m.count) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "ct" },
        });
        (m.count);
    }
    var __VLS_3;
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "host" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "host-label" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "host-row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "host-dot" },
    ...{ class: (__VLS_ctx.hostStatus) },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "host-text" },
});
(__VLS_ctx.hostStatusText);
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "main" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "topbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "crumb" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "sep" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.b, __VLS_intrinsicElements.b)({});
(__VLS_ctx.currentTitle);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "content" },
});
const __VLS_12 = {}.RouterView;
/** @type {[typeof __VLS_components.RouterView, typeof __VLS_components.routerView, ]} */ ;
// @ts-ignore
const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({}));
const __VLS_14 = __VLS_13({}, ...__VLS_functionalComponentArgsRest(__VLS_13));
/** @type {__VLS_StyleScopedClasses['app']} */ ;
/** @type {__VLS_StyleScopedClasses['side']} */ ;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['logo-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['name']} */ ;
/** @type {__VLS_StyleScopedClasses['nav']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['ct']} */ ;
/** @type {__VLS_StyleScopedClasses['host']} */ ;
/** @type {__VLS_StyleScopedClasses['host-label']} */ ;
/** @type {__VLS_StyleScopedClasses['host-row']} */ ;
/** @type {__VLS_StyleScopedClasses['host-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['host-text']} */ ;
/** @type {__VLS_StyleScopedClasses['main']} */ ;
/** @type {__VLS_StyleScopedClasses['topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['crumb']} */ ;
/** @type {__VLS_StyleScopedClasses['sep']} */ ;
/** @type {__VLS_StyleScopedClasses['content']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            menus: menus,
            activeMenu: activeMenu,
            currentTitle: currentTitle,
            hostStatus: hostStatus,
            hostStatusText: hostStatusText,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
