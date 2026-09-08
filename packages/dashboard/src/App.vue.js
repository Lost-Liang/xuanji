/// <reference types="../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { Odometer, Document, List, Monitor, Setting, Collection, Operation, ChatDotRound } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import LoginDialog from './components/LoginDialog.vue';
import { currentUser, isLoggedIn, logout, checkAuth } from './stores/user';
const route = useRoute();
const menus = [
    { path: '/canvas', match: '/canvas', label: '流程画布', icon: Odometer },
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
// 登录对话框
const showLoginDialog = ref(false);
function handleLoginSuccess() {
    ElMessage.success('欢迎回来！');
}
// 用户下拉菜单处理
function handleUserCommand(command) {
    switch (command) {
        case 'profile':
            // TODO: 跳转到个人中心
            ElMessage.info('个人中心功能开发中...');
            break;
        case 'settings':
            // TODO: 跳转到设置
            ElMessage.info('设置功能开发中...');
            break;
        case 'logout':
            logout();
            ElMessage.success('已退出登录');
            break;
    }
}
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
    // 检查登录状态
    checkAuth();
});
onUnmounted(() => clearInterval(timer));
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['mark']} */ ;
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
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-login']} */ ;
/** @type {__VLS_StyleScopedClasses['user-info']} */ ;
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
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "mark" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "name" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "dot-sep" },
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
    ...{ class: "topbar-right" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.$router.push('/requirements');
        } },
    ...{ class: "btn btn-primary" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "user-area" },
});
if (__VLS_ctx.isLoggedIn) {
    const __VLS_12 = {}.ElDropdown;
    /** @type {[typeof __VLS_components.ElDropdown, typeof __VLS_components.elDropdown, typeof __VLS_components.ElDropdown, typeof __VLS_components.elDropdown, ]} */ ;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
        ...{ 'onCommand': {} },
        trigger: "click",
    }));
    const __VLS_14 = __VLS_13({
        ...{ 'onCommand': {} },
        trigger: "click",
    }, ...__VLS_functionalComponentArgsRest(__VLS_13));
    let __VLS_16;
    let __VLS_17;
    let __VLS_18;
    const __VLS_19 = {
        onCommand: (__VLS_ctx.handleUserCommand)
    };
    __VLS_15.slots.default;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "user-info" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "user-avatar" },
    });
    (__VLS_ctx.currentUser?.displayName?.charAt(0).toUpperCase() || 'U');
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "user-name" },
    });
    (__VLS_ctx.currentUser?.displayName);
    {
        const { dropdown: __VLS_thisSlot } = __VLS_15.slots;
        const __VLS_20 = {}.ElDropdownMenu;
        /** @type {[typeof __VLS_components.ElDropdownMenu, typeof __VLS_components.elDropdownMenu, typeof __VLS_components.ElDropdownMenu, typeof __VLS_components.elDropdownMenu, ]} */ ;
        // @ts-ignore
        const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({}));
        const __VLS_22 = __VLS_21({}, ...__VLS_functionalComponentArgsRest(__VLS_21));
        __VLS_23.slots.default;
        const __VLS_24 = {}.ElDropdownItem;
        /** @type {[typeof __VLS_components.ElDropdownItem, typeof __VLS_components.elDropdownItem, typeof __VLS_components.ElDropdownItem, typeof __VLS_components.elDropdownItem, ]} */ ;
        // @ts-ignore
        const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
            command: "profile",
        }));
        const __VLS_26 = __VLS_25({
            command: "profile",
        }, ...__VLS_functionalComponentArgsRest(__VLS_25));
        __VLS_27.slots.default;
        var __VLS_27;
        const __VLS_28 = {}.ElDropdownItem;
        /** @type {[typeof __VLS_components.ElDropdownItem, typeof __VLS_components.elDropdownItem, typeof __VLS_components.ElDropdownItem, typeof __VLS_components.elDropdownItem, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            command: "settings",
        }));
        const __VLS_30 = __VLS_29({
            command: "settings",
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
        __VLS_31.slots.default;
        var __VLS_31;
        const __VLS_32 = {}.ElDropdownItem;
        /** @type {[typeof __VLS_components.ElDropdownItem, typeof __VLS_components.elDropdownItem, typeof __VLS_components.ElDropdownItem, typeof __VLS_components.elDropdownItem, ]} */ ;
        // @ts-ignore
        const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
            divided: true,
            command: "logout",
        }));
        const __VLS_34 = __VLS_33({
            divided: true,
            command: "logout",
        }, ...__VLS_functionalComponentArgsRest(__VLS_33));
        __VLS_35.slots.default;
        var __VLS_35;
        var __VLS_23;
    }
    var __VLS_15;
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.isLoggedIn))
                    return;
                __VLS_ctx.showLoginDialog = true;
            } },
        ...{ class: "btn btn-login" },
    });
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "content" },
});
const __VLS_36 = {}.RouterView;
/** @type {[typeof __VLS_components.RouterView, typeof __VLS_components.routerView, ]} */ ;
// @ts-ignore
const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({}));
const __VLS_38 = __VLS_37({}, ...__VLS_functionalComponentArgsRest(__VLS_37));
/** @type {[typeof LoginDialog, ]} */ ;
// @ts-ignore
const __VLS_40 = __VLS_asFunctionalComponent(LoginDialog, new LoginDialog({
    ...{ 'onSuccess': {} },
    modelValue: (__VLS_ctx.showLoginDialog),
}));
const __VLS_41 = __VLS_40({
    ...{ 'onSuccess': {} },
    modelValue: (__VLS_ctx.showLoginDialog),
}, ...__VLS_functionalComponentArgsRest(__VLS_40));
let __VLS_43;
let __VLS_44;
let __VLS_45;
const __VLS_46 = {
    onSuccess: (__VLS_ctx.handleLoginSuccess)
};
var __VLS_42;
/** @type {__VLS_StyleScopedClasses['app']} */ ;
/** @type {__VLS_StyleScopedClasses['side']} */ ;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['mark']} */ ;
/** @type {__VLS_StyleScopedClasses['name']} */ ;
/** @type {__VLS_StyleScopedClasses['dot-sep']} */ ;
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
/** @type {__VLS_StyleScopedClasses['topbar-right']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['user-area']} */ ;
/** @type {__VLS_StyleScopedClasses['user-info']} */ ;
/** @type {__VLS_StyleScopedClasses['user-avatar']} */ ;
/** @type {__VLS_StyleScopedClasses['user-name']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-login']} */ ;
/** @type {__VLS_StyleScopedClasses['content']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            LoginDialog: LoginDialog,
            currentUser: currentUser,
            isLoggedIn: isLoggedIn,
            menus: menus,
            activeMenu: activeMenu,
            currentTitle: currentTitle,
            showLoginDialog: showLoginDialog,
            handleLoginSuccess: handleLoginSuccess,
            handleUserCommand: handleUserCommand,
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
