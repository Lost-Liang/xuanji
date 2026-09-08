/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/components/RequirementTreeView.vue —— 需求树状视图
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/requirements';
const props = defineProps();
const emit = defineEmits();
const router = useRouter();
const tree = ref(null);
const loading = ref(false);
const expandedNodes = ref(new Set());
async function loadTree() {
    loading.value = true;
    try {
        tree.value = await api.getTree(props.requirementId);
        // 默认展开所有节点
        expandAll();
    }
    catch (e) {
        console.error('加载需求树失败', e);
    }
    finally {
        loading.value = false;
    }
}
function expandAll() {
    if (!tree.value)
        return;
    const set = new Set();
    tree.value.epics.forEach(epic => {
        set.add(epic.id);
        epic.features.forEach(f => set.add(f.id));
        epic.orphan_user_stories.forEach(s => set.add(s.id));
    });
    expandedNodes.value = set;
}
function toggleNode(id) {
    if (expandedNodes.value.has(id)) {
        expandedNodes.value.delete(id);
    }
    else {
        expandedNodes.value.add(id);
    }
}
function isExpanded(id) {
    return expandedNodes.value.has(id);
}
function statusText(status) {
    const map = {
        pending: '待执行', running: '执行中', completed: '已完成',
        failed: '失败', paused: '已暂停', stopped: '已停止',
    };
    return map[status] || status;
}
function statusClass(status) {
    return status;
}
function goToTask(task) {
    if (task.execution_id) {
        router.push(`/tasks/${task.execution_id}`);
    }
}
watch(() => props.requirementId, () => {
    if (props.requirementId)
        loadTree();
}, { immediate: true });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['empty-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-node']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['story-detail']} */ ;
/** @type {__VLS_StyleScopedClasses['story-detail']} */ ;
/** @type {__VLS_StyleScopedClasses['task-item']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "tree-view" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
if (!__VLS_ctx.loading && __VLS_ctx.tree) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "tree-root" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "root-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "root-title" },
    });
    (__VLS_ctx.tree.requirement.input_text);
    if (__VLS_ctx.tree.epics.length === 0) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-tree" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "hint" },
        });
    }
    for (const [epic] of __VLS_getVForSourceType((__VLS_ctx.tree.epics))) {
        (epic.id);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "tree-node level-epic" },
            ...{ class: ({ expanded: __VLS_ctx.isExpanded(epic.id) }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onClick: (...[$event]) => {
                    if (!(!__VLS_ctx.loading && __VLS_ctx.tree))
                        return;
                    __VLS_ctx.toggleNode(epic.id);
                } },
            ...{ class: "node-header" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "toggle-btn" },
        });
        (__VLS_ctx.isExpanded(epic.id) ? '−' : '+');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "level-badge epic" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "node-title" },
        });
        (epic.title);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "node-status" },
            ...{ class: (__VLS_ctx.statusClass(epic.status)) },
        });
        (__VLS_ctx.statusText(epic.status));
        if (epic.module) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "node-module" },
            });
            (epic.module);
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "node-children" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.isExpanded(epic.id)) }, null, null);
        for (const [feature] of __VLS_getVForSourceType((epic.features))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (feature.id),
                ...{ class: "tree-node level-feature" },
                ...{ class: ({ expanded: __VLS_ctx.isExpanded(feature.id) }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!(!__VLS_ctx.loading && __VLS_ctx.tree))
                            return;
                        __VLS_ctx.toggleNode(feature.id);
                    } },
                ...{ class: "node-header" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "toggle-btn" },
            });
            (__VLS_ctx.isExpanded(feature.id) ? '−' : '+');
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "level-badge feature" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "node-title" },
            });
            (feature.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "node-status" },
                ...{ class: (__VLS_ctx.statusClass(feature.status)) },
            });
            (__VLS_ctx.statusText(feature.status));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "node-children" },
            });
            __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.isExpanded(feature.id)) }, null, null);
            for (const [story] of __VLS_getVForSourceType((feature.user_stories))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    key: (story.id),
                    ...{ class: "tree-node level-story" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "node-header story-header" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "level-badge story" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "node-title" },
                });
                (story.title);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "priority-tag" },
                });
                (story.priority);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "node-status" },
                    ...{ class: (__VLS_ctx.statusClass(story.status)) },
                });
                (__VLS_ctx.statusText(story.status));
                if (story.as_a || story.i_want || story.so_that) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "story-detail" },
                    });
                    if (story.as_a) {
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
                        (story.as_a);
                    }
                    if (story.i_want) {
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
                        (story.i_want);
                    }
                    if (story.so_that) {
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
                        (story.so_that);
                    }
                }
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-list" },
                });
                for (const [task] of __VLS_getVForSourceType((story.tasks))) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ onClick: (...[$event]) => {
                                if (!(!__VLS_ctx.loading && __VLS_ctx.tree))
                                    return;
                                __VLS_ctx.goToTask(task);
                            } },
                        key: (task.id),
                        ...{ class: "task-item" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "level-badge task" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "task-title" },
                    });
                    (task.title);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "node-status" },
                        ...{ class: (__VLS_ctx.statusClass(task.status)) },
                    });
                    (__VLS_ctx.statusText(task.status));
                    if (task.estimated_hours) {
                        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                            ...{ class: "task-hours" },
                        });
                        (task.estimated_hours);
                    }
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ onClick: () => { } },
                        ...{ class: "task-actions" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                        ...{ onClick: (...[$event]) => {
                                if (!(!__VLS_ctx.loading && __VLS_ctx.tree))
                                    return;
                                __VLS_ctx.emit('openLog', task.execution_id || '');
                            } },
                        ...{ class: "action-btn" },
                    });
                }
                if (story.tasks.length === 0) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                        ...{ class: "no-tasks" },
                    });
                }
            }
            if (feature.user_stories.length === 0) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "no-children" },
                });
            }
        }
        for (const [story] of __VLS_getVForSourceType((epic.orphan_user_stories))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (story.id),
                ...{ class: "tree-node level-story" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "node-header story-header" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "level-badge story" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "node-title" },
            });
            (story.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "priority-tag" },
            });
            (story.priority);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-list" },
            });
            for (const [task] of __VLS_getVForSourceType((story.tasks))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ onClick: (...[$event]) => {
                            if (!(!__VLS_ctx.loading && __VLS_ctx.tree))
                                return;
                            __VLS_ctx.goToTask(task);
                        } },
                    key: (task.id),
                    ...{ class: "task-item" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "level-badge task" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-title" },
                });
                (task.title);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "node-status" },
                    ...{ class: (__VLS_ctx.statusClass(task.status)) },
                });
                (__VLS_ctx.statusText(task.status));
            }
        }
        if (epic.features.length === 0 && epic.orphan_user_stories.length === 0) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "no-children" },
            });
        }
    }
}
/** @type {__VLS_StyleScopedClasses['tree-view']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-root']} */ ;
/** @type {__VLS_StyleScopedClasses['root-label']} */ ;
/** @type {__VLS_StyleScopedClasses['root-title']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['hint']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-node']} */ ;
/** @type {__VLS_StyleScopedClasses['level-epic']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['epic']} */ ;
/** @type {__VLS_StyleScopedClasses['node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-module']} */ ;
/** @type {__VLS_StyleScopedClasses['node-children']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-node']} */ ;
/** @type {__VLS_StyleScopedClasses['level-feature']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['feature']} */ ;
/** @type {__VLS_StyleScopedClasses['node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['node-children']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-node']} */ ;
/** @type {__VLS_StyleScopedClasses['level-story']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['story-header']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['story']} */ ;
/** @type {__VLS_StyleScopedClasses['node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['priority-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['story-detail']} */ ;
/** @type {__VLS_StyleScopedClasses['task-list']} */ ;
/** @type {__VLS_StyleScopedClasses['task-item']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['task']} */ ;
/** @type {__VLS_StyleScopedClasses['task-title']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['task-hours']} */ ;
/** @type {__VLS_StyleScopedClasses['task-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['action-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['no-tasks']} */ ;
/** @type {__VLS_StyleScopedClasses['no-children']} */ ;
/** @type {__VLS_StyleScopedClasses['tree-node']} */ ;
/** @type {__VLS_StyleScopedClasses['level-story']} */ ;
/** @type {__VLS_StyleScopedClasses['node-header']} */ ;
/** @type {__VLS_StyleScopedClasses['story-header']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['story']} */ ;
/** @type {__VLS_StyleScopedClasses['node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['priority-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['task-list']} */ ;
/** @type {__VLS_StyleScopedClasses['task-item']} */ ;
/** @type {__VLS_StyleScopedClasses['level-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['task']} */ ;
/** @type {__VLS_StyleScopedClasses['task-title']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status']} */ ;
/** @type {__VLS_StyleScopedClasses['no-children']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            emit: emit,
            tree: tree,
            loading: loading,
            toggleNode: toggleNode,
            isExpanded: isExpanded,
            statusText: statusText,
            statusClass: statusClass,
            goToTask: goToTask,
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
