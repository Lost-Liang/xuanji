// 画布编辑态简易 store
import { ref } from 'vue';
import { api } from '../api/graph';
export const currentDef = ref(null);
export async function loadGraph(id) {
    const row = await api.get(id);
    if (row)
        currentDef.value = row.definition_json;
}
export async function saveGraph(def) {
    await api.save(def);
    currentDef.value = def;
}
