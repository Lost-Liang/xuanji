// core/web/src/api/tasks.ts —— 任务 API 客户端（fetch 薄封装，照 requirements.ts 模式）
const base = '/api/tasks';
export const api = {
    async list(requirementId) {
        const url = requirementId ? `${base}?requirement_id=${encodeURIComponent(requirementId)}` : base;
        const r = await fetch(url);
        return r.json();
    },
    async get(id) {
        const r = await fetch(`${base}/${id}`);
        return r.json();
    },
    async pause(execId) {
        const r = await fetch(`/api/executions/${execId}/pause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: 'sub' }),
        });
        return r.json();
    },
    async resume(execId) {
        const r = await fetch(`/api/executions/${execId}/resume`, { method: 'POST' });
        return r.json();
    },
    async cancel(execId) {
        const r = await fetch(`/api/executions/${execId}/cancel`, { method: 'POST' });
        return r.json();
    },
    async retry(execId, nodeId) {
        const r = await fetch(`/api/executions/${execId}/retry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId, mode: 'message' }),
        });
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
    async chat(refId, message) {
        const r = await fetch(`/api/sessions/${refId}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        });
        return r.json();
    },
    async confirm(execId) {
        const r = await fetch(`${base}/${execId}/confirm`, { method: 'POST' });
        return r.json();
    },
    async execute(execId) {
        const r = await fetch(`${base}/${execId}/execute`, { method: 'POST' });
        return r.json();
    },
};
