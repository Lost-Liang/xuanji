// 调试脚本：验证 default-dev-flow 的图构建和路由
import { loadWorkflowFromYaml, mapYamlToGraphDef } from '../packages/core/src/graph/yaml-loader.mjs';
import { buildGraphFromDef } from '../packages/core/src/graph/builder.mjs';
import { collectRoutes } from '../packages/core/src/graph/builder.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const yamlPath = join(__dirname, '../packages/core/workflows/default-dev-flow.yaml');
const yamlContent = readFileSync(yamlPath, 'utf-8');

console.log('=== 1. 加载 YAML ===');
const def = loadWorkflowFromYaml(yamlContent);
console.log('Nodes:', def.nodes.map(n => n.id).join(', '));
console.log('Edges:');
for (const e of def.edges) {
  console.log(`  ${e.from} → ${e.to}${e.condition ? ` (条件: ${e.condition.config.name})` : ''}${e.loop_max ? ` [loop_max=${e.loop_max}]` : ''}`);
}

console.log('\n=== 2. 映射为 GraphDef ===');
const graph = mapYamlToGraphDef(def);
console.log('Graph nodes:', graph.nodes.map(n => n.id).join(', '));
console.log('Graph edges:');
for (const e of graph.edges) {
  console.log(`  ${e.source} → ${e.target}`);
}

console.log('\n=== 3. 收集 Routes ===');
const routes = collectRoutes(def, graph);
console.log('Routes:');
for (const r of routes) {
  console.log(`  ${r.source}:`);
  for (const e of r.edges) {
    console.log(`    → ${e.target}${e.condition ? ` (条件: ${e.condition.config?.name})` : ' (无条件)'}${e.loop_back ? ` [回环]` : ''}${e.is_default ? ` [默认]` : ''}`);
  }
}

console.log('\n=== 4. 分析边路由 ===');
const conditionalNodeIds = new Set(routes.map(r => r.source));
console.log('Conditional node IDs:', [...conditionalNodeIds].join(', '));

// 检查 develop 的边
const developEdges = def.edges.filter(e => e.from === 'develop');
console.log('\nDevelop 的边:', developEdges.length);
for (const e of developEdges) {
  console.log(`  ${e.from} → ${e.to}${e.condition ? ` (条件)` : ''}`);
}

// 检查 develop 是否会被跳过
console.log('\ndevelop 在 conditionalNodeIds 中吗？', conditionalNodeIds.has('develop'));

console.log('\n=== 5. 构建图（测试）===');
try {
  const compiledGraph = buildGraphFromDef(yamlContent);
  console.log('图构建成功！');
} catch (err) {
  console.error('图构建失败:', err.message);
}
