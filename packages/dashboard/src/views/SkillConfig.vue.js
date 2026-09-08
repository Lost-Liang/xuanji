/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
// core/web/src/views/SkillConfig.vue —— Skill 列表页
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
const router = useRouter();
const presets = ref([]);
const userSkills = ref([]);
const loading = ref(false);
const activeTab = ref('presets');
async function loadSkills() {
    loading.value = true;
    try {
        const res = await fetch('/api/skills');
        const data = await res.json();
        presets.value = data.presets || [];
        userSkills.value = data.user || [];
    }
    catch {
        ElMessage.error('加载 Skill 列表失败');
    }
    finally {
        loading.value = false;
    }
}
function goToDetail(row) {
    router.push(`/skills/${row.id}`);
}
function createSkill() {
    router.push('/skills/new');
}
onMounted(loadSkills);
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['clickable-table']} */ ;
/** @type {__VLS_StyleScopedClasses['el-table__row']} */ ;
/** @type {__VLS_StyleScopedClasses['el-table']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "skill-config" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "actions" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.createSkill) },
    ...{ class: "btn-primary" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.loadSkills) },
    ...{ class: "btn-secondary" },
});
const __VLS_0 = {}.ElTabs;
/** @type {[typeof __VLS_components.ElTabs, typeof __VLS_components.elTabs, typeof __VLS_components.ElTabs, typeof __VLS_components.elTabs, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    modelValue: (__VLS_ctx.activeTab),
    ...{ class: "tabs" },
}));
const __VLS_2 = __VLS_1({
    modelValue: (__VLS_ctx.activeTab),
    ...{ class: "tabs" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
const __VLS_4 = {}.ElTabPane;
/** @type {[typeof __VLS_components.ElTabPane, typeof __VLS_components.elTabPane, typeof __VLS_components.ElTabPane, typeof __VLS_components.elTabPane, ]} */ ;
// @ts-ignore
const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
    label: "预设 Skill",
    name: "presets",
}));
const __VLS_6 = __VLS_5({
    label: "预设 Skill",
    name: "presets",
}, ...__VLS_functionalComponentArgsRest(__VLS_5));
__VLS_7.slots.default;
const __VLS_8 = {}.ElTable;
/** @type {[typeof __VLS_components.ElTable, typeof __VLS_components.elTable, typeof __VLS_components.ElTable, typeof __VLS_components.elTable, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    ...{ 'onRowClick': {} },
    data: (__VLS_ctx.presets),
    ...{ class: "clickable-table" },
}));
const __VLS_10 = __VLS_9({
    ...{ 'onRowClick': {} },
    data: (__VLS_ctx.presets),
    ...{ class: "clickable-table" },
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
let __VLS_12;
let __VLS_13;
let __VLS_14;
const __VLS_15 = {
    onRowClick: (__VLS_ctx.goToDetail)
};
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
__VLS_11.slots.default;
const __VLS_16 = {}.ElTableColumn;
/** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
// @ts-ignore
const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
    label: "ID",
    prop: "id",
    minWidth: "180",
}));
const __VLS_18 = __VLS_17({
    label: "ID",
    prop: "id",
    minWidth: "180",
}, ...__VLS_functionalComponentArgsRest(__VLS_17));
const __VLS_20 = {}.ElTableColumn;
/** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
// @ts-ignore
const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
    label: "名称",
    prop: "name",
    minWidth: "160",
}));
const __VLS_22 = __VLS_21({
    label: "名称",
    prop: "name",
    minWidth: "160",
}, ...__VLS_functionalComponentArgsRest(__VLS_21));
const __VLS_24 = {}.ElTableColumn;
/** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
// @ts-ignore
const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
    label: "描述",
    prop: "description",
    minWidth: "300",
    showOverflowTooltip: true,
}));
const __VLS_26 = __VLS_25({
    label: "描述",
    prop: "description",
    minWidth: "300",
    showOverflowTooltip: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_25));
var __VLS_11;
if (!__VLS_ctx.loading && __VLS_ctx.presets.length === 0) {
    const __VLS_28 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
        description: "暂无预设 Skill",
    }));
    const __VLS_30 = __VLS_29({
        description: "暂无预设 Skill",
    }, ...__VLS_functionalComponentArgsRest(__VLS_29));
}
var __VLS_7;
const __VLS_32 = {}.ElTabPane;
/** @type {[typeof __VLS_components.ElTabPane, typeof __VLS_components.elTabPane, typeof __VLS_components.ElTabPane, typeof __VLS_components.elTabPane, ]} */ ;
// @ts-ignore
const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
    label: "用户 Skill",
    name: "user",
}));
const __VLS_34 = __VLS_33({
    label: "用户 Skill",
    name: "user",
}, ...__VLS_functionalComponentArgsRest(__VLS_33));
__VLS_35.slots.default;
const __VLS_36 = {}.ElTable;
/** @type {[typeof __VLS_components.ElTable, typeof __VLS_components.elTable, typeof __VLS_components.ElTable, typeof __VLS_components.elTable, ]} */ ;
// @ts-ignore
const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
    ...{ 'onRowClick': {} },
    data: (__VLS_ctx.userSkills),
    ...{ class: "clickable-table" },
}));
const __VLS_38 = __VLS_37({
    ...{ 'onRowClick': {} },
    data: (__VLS_ctx.userSkills),
    ...{ class: "clickable-table" },
}, ...__VLS_functionalComponentArgsRest(__VLS_37));
let __VLS_40;
let __VLS_41;
let __VLS_42;
const __VLS_43 = {
    onRowClick: (__VLS_ctx.goToDetail)
};
__VLS_asFunctionalDirective(__VLS_directives.vLoading)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading) }, null, null);
__VLS_39.slots.default;
const __VLS_44 = {}.ElTableColumn;
/** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
// @ts-ignore
const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({
    label: "ID",
    prop: "id",
    minWidth: "180",
}));
const __VLS_46 = __VLS_45({
    label: "ID",
    prop: "id",
    minWidth: "180",
}, ...__VLS_functionalComponentArgsRest(__VLS_45));
const __VLS_48 = {}.ElTableColumn;
/** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
// @ts-ignore
const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
    label: "名称",
    prop: "name",
    minWidth: "160",
}));
const __VLS_50 = __VLS_49({
    label: "名称",
    prop: "name",
    minWidth: "160",
}, ...__VLS_functionalComponentArgsRest(__VLS_49));
const __VLS_52 = {}.ElTableColumn;
/** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
// @ts-ignore
const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({
    label: "描述",
    prop: "description",
    minWidth: "300",
    showOverflowTooltip: true,
}));
const __VLS_54 = __VLS_53({
    label: "描述",
    prop: "description",
    minWidth: "300",
    showOverflowTooltip: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_53));
var __VLS_39;
if (!__VLS_ctx.loading && __VLS_ctx.userSkills.length === 0) {
    const __VLS_56 = {}.ElEmpty;
    /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
    // @ts-ignore
    const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
        description: "暂无用户 Skill",
    }));
    const __VLS_58 = __VLS_57({
        description: "暂无用户 Skill",
    }, ...__VLS_functionalComponentArgsRest(__VLS_57));
}
var __VLS_35;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['skill-config']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['clickable-table']} */ ;
/** @type {__VLS_StyleScopedClasses['clickable-table']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            presets: presets,
            userSkills: userSkills,
            loading: loading,
            activeTab: activeTab,
            loadSkills: loadSkills,
            goToDetail: goToDetail,
            createSkill: createSkill,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
