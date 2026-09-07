import { test } from 'node:test'
import assert from 'node:assert'
import { layoutDagre } from '../dagre-layout.ts'

test('layoutDagre 为节点生成有效坐标', () => {
  const nodes = [
    { id: 'n1', position: { x: 0, y: 0 }, data: {} },
    { id: 'n2', position: { x: 0, y: 0 }, data: {} },
    { id: 'n3', position: { x: 0, y: 0 }, data: {} },
  ] as any
  const edges = [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ] as any
  const laid = layoutDagre(nodes, edges, 'LR')
  assert.equal(laid.length, 3)
  for (const n of laid) {
    assert.equal(typeof n.position.x, 'number')
    assert.equal(typeof n.position.y, 'number')
  }
  // n2 应在 n1 右侧（LR 方向）
  assert.ok(laid[1].position.x > laid[0].position.x, 'n2 应在 n1 右侧')
})
