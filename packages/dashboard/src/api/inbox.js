// packages/dashboard/src/api/inbox.ts —— 人机交互 API 客户端
// 对接璇玑 Core 的 /api/inbox 路由（routes/inbox.mts）
//
// Agent 通过 inbox_ask 工具向人类提问，问题持久化到 inbox_questions 表。
// Dashboard 轮询 getPending() 展示待回答列表，用户回答后调用 answer() 提交，
// Core 通知等待中的 agent-node 解除阻塞（同一 CLI 会话，无需 --resume）。
const base = '/api/inbox';
export const inboxApi = {
    /**
     * 获取所有待回答的问题（按创建时间升序）
     * Dashboard 轮询此接口，建议间隔 3-5 秒
     */
    async getPending() {
        const r = await fetch(`${base}/pending`);
        if (!r.ok) {
            throw new Error(`获取待回答问题失败: ${r.status} ${r.statusText}`);
        }
        return r.json();
    },
    /**
     * 提交人类回答
     *
     * 1. Core 更新 inbox_questions 表（status='answered', answer, answeredAt）
     * 2. Core 调用 notifyHumanAnswered() 解除 agent-node 中 waitForHumanAnswer 的阻塞
     * 3. Agent 继续执行（同一 CLI 会话）
     */
    async answer(questionId, answer) {
        const r = await fetch(`${base}/${questionId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer }),
        });
        if (!r.ok) {
            const text = await r.text();
            throw new Error(`提交回答失败: ${r.status} ${text}`);
        }
        return r.json();
    },
};
