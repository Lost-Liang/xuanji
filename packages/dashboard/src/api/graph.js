// 图定义 API 客户端
// V4: 移除对 V3 server 路径的引用，定义本地最小类型
// TODO: 后续通过 monorepo 共享 @xuanji/core 类型
const base = '/api/graph-definitions';
export const api = {
    async list() {
        const r = await fetch(base);
        return r.json();
    },
    async get(id) {
        const r = await fetch(`${base}/${id}`);
        return r.json();
    },
    async save(def) {
        if (def.id) {
            const r = await fetch(`${base}/${def.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ definition_json: def }),
            });
            return r.json();
        }
        const id = `${def.name}-${Date.now()}`;
        const r = await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name: def.name, plugin_id: def.plugin_id, definition_json: def }),
        });
        return r.json();
    },
};
