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
    // Requirement 级暂停
    async pauseRequirement(id) {
        const r = await fetch(`${base}/${id}/pause`, { method: 'POST' });
        return r.json();
    },
    // Requirement 级恢复
    async resumeRequirement(id) {
        const r = await fetch(`${base}/${id}/resume`, { method: 'POST' });
        return r.json();
    },
    // Epic 级操作
    async executeEpic(epicId) {
        const r = await fetch(`${base}/epics/${epicId}/execute`, { method: 'POST' });
        return r.json();
    },
    async pauseEpic(epicId) {
        const r = await fetch(`${base}/epics/${epicId}/pause`, { method: 'POST' });
        return r.json();
    },
    async resumeEpic(epicId) {
        const r = await fetch(`${base}/epics/${epicId}/resume`, { method: 'POST' });
        return r.json();
    },
    async deleteEpic(epicId) {
        const r = await fetch(`${base}/epics/${epicId}`, { method: 'DELETE' });
        return r.json();
    },
    // Feature 级操作
    async executeFeature(featureId) {
        const r = await fetch(`${base}/features/${featureId}/execute`, { method: 'POST' });
        return r.json();
    },
    async pauseFeature(featureId) {
        const r = await fetch(`${base}/features/${featureId}/pause`, { method: 'POST' });
        return r.json();
    },
    async resumeFeature(featureId) {
        const r = await fetch(`${base}/features/${featureId}/resume`, { method: 'POST' });
        return r.json();
    },
    async deleteFeature(featureId) {
        const r = await fetch(`${base}/features/${featureId}`, { method: 'DELETE' });
        return r.json();
    },
    // UserStory 级操作
    async executeUserStory(userStoryId) {
        const r = await fetch(`${base}/user-stories/${userStoryId}/execute`, { method: 'POST' });
        return r.json();
    },
    async pauseUserStory(userStoryId) {
        const r = await fetch(`${base}/user-stories/${userStoryId}/pause`, { method: 'POST' });
        return r.json();
    },
    async resumeUserStory(userStoryId) {
        const r = await fetch(`${base}/user-stories/${userStoryId}/resume`, { method: 'POST' });
        return r.json();
    },
    async deleteUserStory(userStoryId) {
        const r = await fetch(`${base}/user-stories/${userStoryId}`, { method: 'DELETE' });
        return r.json();
    },
};
