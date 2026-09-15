// core/web/src/lib/dagre-layout.ts
import dagre, { graphlib } from '@dagrejs/dagre';
const NODE_W = 180, NODE_H = 64;
export function layoutDagre(nodes, edges, dir = 'LR') {
    const g = new graphlib.Graph({ directed: true, compound: true });
    g.setGraph({ rankdir: dir, nodesep: 40, edgesep: 20, ranksep: 60, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes)
        g.setNode(n.id, { width: NODE_W, height: NODE_H });
    for (const e of edges)
        g.setEdge(e.source, e.target);
    dagre.layout(g);
    return nodes.map(n => {
        const { x, y } = g.node(n.id);
        return { ...n, position: { x: x - NODE_W / 2, y: y - NODE_H / 2 } }; // 中心点转左上角
    });
}
