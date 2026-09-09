// 调试脚本：验证 default-dev-flow 的图构建和路由
import { loadWorkflowFromYaml } from '../packages/core/dist/graph/yaml-loader.mjs';
import { buildGraphFromDef, collectRoutes } from '../packages/core/dist/graph/builder.mjs';
import { initDefaultConditions } from '../packages/core/dist/graph/conditions/default-conditions.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 先注册条件函数！
initDefaultConditions();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const yamlPath = join(__dirname, '../packages/core/workflows/default-dev-flow.yaml');
const yamlContent = readFileSync(yamlPath, 'utf-8');

console.log('=== 1. 加载 YAML ===');
const def = loadWorkflowFromYaml(yamlContent);
console.log('Nodes:', def.nodes.map(n => n.id).join(', '));
console.log('\nEdges:');
for (const e of def.edges) {
  console.log(`  ${e.from} → ${e.to}${e.condition ? ` (条件: ${e.condition.config.name})` : ''}${e.loop_max ? ` [loop_max=${e.loop_max}]` : ''}`);
}

console.log('\n=== 2. 收集 Routes ===');
const routes = collectRoutes(def, { nodes: def.nodes, edges: def.edges });
console.log('Routes:');
for (const r of routes) {
  console.log(`  ${r.source}:`);
  for (const e of r.edges) {
    console.log(`    → ${e.target}${e.condition ? ` (条件: ${e.condition?.config?.name})` : ' (无条件)'}${e.loop_back ? ` [回环]` : ''}${e.is_default ? ` [默认]` : ''}`);
  }
}

console.log('\n=== 3. 分析边路由 ===');
const conditionalNodeIds = new Set(routes.map(r => r.source));
console.log('Conditional node IDs:', [...conditionalNodeIds].join(', '));

console.log('\n=== 4. 预期执行流程 ===');
console.log('根据 YAML 定义，预期流程：');
console.log('  develop → compile_check → test_check → quality_review → security_review → final_review → __end__');

console.log('\n=== 5. 检查条件函数 ===');
console.log('条件函数已注册');

const { getCondition } = await import('../packages/core/dist/graph/conditions/index.mjs');

// 测试 compile_pass（无数据时）
const compilePass = getCondition('compile_pass');
const emptyState = {};
console.log('\ncompile_pass(emptyState):', compilePass(emptyState));

const compileFail = getCondition('compile_fail');
console.log('compile_fail(emptyState):', compileFail(emptyState));

console.log('\n=== 6. 构建图（测试）===');
try {
  const compiledGraph = buildGraphFromDef(yamlContent);
  console.log('图构建成功！');

  // 测试路由函数
  console.log('\n=== 7. 测试路由逻辑 ===');
  const { routeFromSource } = await import('../packages/core/dist/graph/builder.mjs');

  // 模拟 develop 的路由（只有 1 条边到 compile_check）
  const developRoute = routes.find(r => r.source === 'develop');
  console.log('\ndevelop 路由:', JSON.stringify(developRoute, null, 2));

  // 模拟 compile_check 的路由（有 2 条条件边）
  const compileCheckRoute = routes.find(r => r.source === 'compile_check');
  console.log('\ncompile_check 路由:', JSON.stringify(compileCheckRoute, null, 2));

  // 测试 routeFromSource（空 state）
  console.log('\nrouteFromSource(emptyState, compileCheckRoute):', routeFromSource(emptyState, compileCheckRoute));

} catch (err) {
  console.error('图构建失败:', err.message);
  console.error(err.stack);
}
