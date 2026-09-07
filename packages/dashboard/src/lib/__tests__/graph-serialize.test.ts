import { test } from 'node:test'
import assert from 'node:assert'
import { toGraphDef, toVueFlow } from '../graph-serialize.ts'
import type { GraphDef } from '../graph-serialize.ts'

test('round-trip: toGraphDef(toVueFlow(def)) 深等于 def（位置字段除外）', () => {
  const def: GraphDef = {
    name: 'demo',
    plugin_id: 'demo-plugin',
    version: 1,
    nodes: [
      { id: 'n1', type: 'agent', agent_binding_ids: ['b1'] },
      { id: 'n2', type: 'command', command: 'echo hello' },
      { id: 'n3', type: 'gate' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
    loops: [],
    subgraphs: [],
  }
  const { nodes, edges } = toVueFlow(def)
  const round = toGraphDef(nodes, edges, def.name, def.plugin_id)
  assert.deepStrictEqual(round, def)
})

test('toVueFlow 生成的节点带 position 和 data', () => {
  const def: GraphDef = {
    name: 't', plugin_id: 'p', version: 1,
    nodes: [{ id: 'n1', type: 'agent', agent_binding_ids: ['b1'] }],
    edges: [],
    loops: [],
    subgraphs: [],
  }
  const { nodes } = toVueFlow(def)
  assert.equal(nodes[0].position.x, 0)
  assert.equal(nodes[0].position.y, 0)
  assert.equal(nodes[0].data.id, 'n1')
  assert.equal(nodes[0].data.type, 'agent')
})
