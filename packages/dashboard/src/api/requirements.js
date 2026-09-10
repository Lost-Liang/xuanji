// core/web/src/api/requirements.ts —— 需求 API 客户端（fetch 薄封装，照 graph.ts 模式）
const base = '/api/requirements';
export const api = {
    async list() {
        const r = await fetch(base);
        return r.json();
    },
    async get(id) {
        const r = await fetch(`${base}/${id}`);
        return r.json();
    },
    async getTree(id) {
        const r = await fetch(`${base}/${id}/tree`);
        return r.json();
    },
    async execute(id, input_text) {
        const r = await fetch(`${base}/${id}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input_text }),
        });
        return r.json();
    },
    async stop(id) {
        const r = await fetch(`${base}/${id}/stop`, { method: 'POST' });
        return r.json();
    },
    async delete(id) {
        const r = await fetch(`${base}/${id}`, { method: 'DELETE' });
        return r.json();
    },
    async gate(execId, decision, comments) {
        const r = await fetch(`/api/executions/${execId}/gate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, comments }),
        });
        return r.json();
    },
    async confirmAll(requirementId) {
        const r = await fetch(`${base}/${requirementId}/confirm-all-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        return r.json();
    },
};
