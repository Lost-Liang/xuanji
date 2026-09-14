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
                // 正向边和循环边都使用 smoothstep（折线）
                type: 'smoothstep',
                markerEnd: 'arrowclosed',
                // 循环边使用 Top→Top，从上方绕路形成平滑曲线
                sourcePosition: isReverse ? 'top' : 'right',
                targetPosition: isReverse ? 'top' : 'left',
                sourceHandle: isReverse ? 'top' : null,
                targetHandle: isReverse ? 'top' : null,
                // 贝塞尔曲线使用曲率参数，让循环边绕远路
                pathOptions: isReverse ? { curvature: 1.0 } : undefined,
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
