// Vue Flow node.data 承载 GraphNode 业务字段（id/type/agent_binding_ids/selector/command/...）
export function toGraphDef(nodes, edges, name, pluginId) {
    return {
        name, plugin_id: pluginId, version: 1,
        nodes: nodes.map(n => ({ id: n.id, ...n.data })),
        edges: edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            condition: e.data?.condition,
            loop_max: e.data?.loop_max,
        })),
        loops: [], subgraphs: [],
    };
}
export function toVueFlow(def) {
    // 检测循环边（双向边）
    const edgeKeys = new Set();
    const isLoopEdge = new Set();
    // 第一遍：收集所有边的 key
    for (const e of def.edges) {
        edgeKeys.add(`${e.source}-${e.target}`);
    }
    // 第二遍：检测循环（如果存在反向边）
    for (const e of def.edges) {
        const reverseKey = `${e.target}-${e.source}`;
        if (edgeKeys.has(reverseKey)) {
            isLoopEdge.add(e.id);
        }
    }
    return {
        nodes: def.nodes.map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: { ...n } })),
        edges: def.edges.map(e => {
            const isLoop = isLoopEdge.has(e.id);
            return {
                id: e.id,
                source: e.source,
                target: e.target,
                type: 'smoothstep', // 统一使用 smoothstep
                markerEnd: 'arrowclosed',
                // 循环边添加特殊 className
                className: isLoop ? 'loop-edge' : undefined,
                data: {
                    condition: e.condition,
                    loop_max: e.loop_max,
                    isLoopEdge: isLoop,
                },
            };
        }),
    };
}
