// core/web/src/api/agent-bindings.ts —— Agent 绑定 API 客户端（fetch 薄封装，照 tasks.ts 模式）
const base = '/api/agent-bindings';
export const api = {
    async list() {
        const r = await fetch(base);
        return r.json();
    },
    async get(id) {
        const r = await fetch(`${base}/${id}`);
        return r.json();
    },
    async create(b) {
        const r = await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b),
        });
        return r.json();
    },
    async update(id, b) {
        const r = await fetch(`${base}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b),
        });
        return r.json();
    },
    async remove(id) {
        const r = await fetch(`${base}/${id}`, { method: 'DELETE' });
        return r.json();
    },
};
export const execApi = {
    async list() {
        const r = await fetch('/api/executions?subject_type=requirement');
        return r.json();
    },
    async subExecutions(id) {
        const r = await fetch(`/api/executions/${id}/sub-executions`);
        return r.json();
    },
};
// —— 画布用：agent binding id → 中文 agent 名（节点 label 缺省时回填）——
let labelCache = null;
export const agentApi = {
    async list() {
        return api.list();
    },
    /** 获取所有 agent binding 的 id → agent_id 映射 */
    async getLabelMap() {
        if (labelCache)
            return labelCache;
        const list = await api.list();
        const map = new Map();
        for (const b of list) {
            map.set(b.id, b.agent_id || b.id);
        }
        labelCache = map;
        return map;
    },
    invalidateCache() { labelCache = null; },
};
