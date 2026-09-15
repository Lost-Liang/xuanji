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
    const edgeMap = new Map(); // key -> edge id
    const reverseEdgeIds = new Set(); // 反向边的 id
    // 第一遍：收集所有边的 key → id 映射
    for (const e of def.edges) {
        edgeMap.set(`${e.source}-${e.target}`, e.id);
    }
    // 第二遍：检测循环，标记反向边
    for (const e of def.edges) {
        const reverseKey = `${e.target}-${e.source}`;
        const reverseId = edgeMap.get(reverseKey);
        // 如果存在反向边，且当前边的 id > 反向边的 id（按字母顺序），则当前边是反向边
        if (reverseId && e.id > reverseId) {
            reverseEdgeIds.add(e.id);
        }
    }
    return {
        nodes: def.nodes.map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: { ...n } })),
        edges: def.edges.map(e => {
            const isReverse = reverseEdgeIds.has(e.id);
            return {
                id: e.id,
                source: e.source,
                target: e.target,
                // 循环边使用 default 类型（贝塞尔曲线），正向边使用 smoothstep
                type: isReverse ? 'default' : 'smoothstep',
                markerEnd: 'arrowclosed',
                // 反向边（循环）使用 Bottom→Top，与正向边 Right→Left 错开
                sourcePosition: isReverse ? 'bottom' : 'right',
                targetPosition: isReverse ? 'top' : 'left',
                className: isReverse ? 'loop-edge' : undefined,
                data: {
                    condition: e.condition,
                    loop_max: e.loop_max,
                    isLoopEdge: isReverse,
                },
            };
        }),
    };
}
