// core/web/src/stores/requirements.ts —— 需求页简易 store（ref 模式，照 graph.ts）
import { ref } from 'vue';
import { api } from '../api/requirements';
export const requirements = ref([]);
export const currentDetail = ref(null);
export const loading = ref(false);
export async function loadList() {
    loading.value = true;
    try {
        requirements.value = await api.list();
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
