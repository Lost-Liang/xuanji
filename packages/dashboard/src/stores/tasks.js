// core/web/src/stores/tasks.ts —— 任务页简易 store（ref 模式，照 requirements.ts）
import { ref } from 'vue';
import { api } from '../api/tasks';
export const tasks = ref([]);
export const currentDetail = ref(null);
export const loading = ref(false);
// 抽屉状态
export const showChatDrawer = ref(false);
export const showLogDrawer = ref(false);
export const currentExecId = ref('');
export const currentSessionRefId = ref(null);
export const currentRateLimitedUntil = ref(null);
export const currentStatus = ref('');
export async function loadList(requirementId) {
    loading.value = true;
    try {
        tasks.value = await api.list(requirementId);
    }
    finally {
        loading.value = false;
    }
}
export async function loadDetail(id) {
    loading.value = true;
    try {
        currentDetail.value = await api.get(id);
    }
    finally {
        loading.value = false;
    }
}
// 列表页打开抽屉：从行数据传入（详情页可传部分对象，仅含这几个字段）
export function openChatDrawer(row) {
    currentExecId.value = row.id;
    currentSessionRefId.value = row.session_ref_id;
    currentStatus.value = row.status;
    currentRateLimitedUntil.value = row.rate_limited_until;
    showChatDrawer.value = true;
}
export function closeChatDrawer() {
    showChatDrawer.value = false;
    currentExecId.value = '';
    currentSessionRefId.value = null;
}
export function openLogDrawer(row) {
    currentExecId.value = row.id;
    currentStatus.value = row.status;
    currentRateLimitedUntil.value = row.rate_limited_until;
    showLogDrawer.value = true;
}
export function closeLogDrawer() {
    showLogDrawer.value = false;
    currentExecId.value = '';
    currentRateLimitedUntil.value = null;
}
