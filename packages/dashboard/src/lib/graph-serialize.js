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
    return {
        nodes: def.nodes.map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: { ...n } })),
        edges: def.edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'particle',
            markerEnd: 'arrowclosed',
            data: {
                condition: e.condition,
                loop_max: e.loop_max,
            },
        })),
    };
}
