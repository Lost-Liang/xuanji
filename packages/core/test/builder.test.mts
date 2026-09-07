// packages/core/test/builder.test.mts
// 验证 builder.mts 核心函数 + 默认 YAML 加载

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  buildGraphFromDef,
  buildTopGraph,
  buildSubGraph,
  loadWorkflowFromYaml,
  mapYamlToGraphDef,
  initDefaultConditions,
  findEntryNodes,
  collectRoutes,
  routeFromSource,
  withLoopCounter,
} from '../src/index.mjs';
import type { GraphDef } from '../src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('builder.mts 核心函数', () => {
  beforeAll(() => {
    // 注册默认条件函数（compile_pass, test_pass 等）
    initDefaultConditions();
  });

  describe('buildGraphFromDef（YAML 驱动）', () => {
    it('应该能加载默认 YAML 并构建图', async () => {
      const yamlPath = path.join(__dirname, '..', 'workflows', 'default-dev-flow.yaml');
      const yamlContent = await fs.readFile(yamlPath, 'utf-8');

      // 1. YAML 解析
      const workflowDef = loadWorkflowFromYaml(yamlContent);
      expect(workflowDef.id).toBe('default-dev-flow');
      expect(workflowDef.nodes.length).toBeGreaterThan(0);
      expect(workflowDef.edges.length).toBeGreaterThan(0);

      // 2. 映射为 GraphDef
      const graphDef = mapYamlToGraphDef(workflowDef);
      expect(graphDef.nodes.length).toBe(workflowDef.nodes.length);
      // __end__ 边被过滤
      const endEdges = workflowDef.edges.filter((e) => e.to === '__end__');
      expect(graphDef.edges.length).toBe(workflowDef.edges.length - endEdges.length);

      // 3. 构建可执行图
      const compiled = buildGraphFromDef(yamlContent);
      expect(compiled).toBeTruthy();
    });

    it('应该能识别入口节点', async () => {
      const yamlPath = path.join(__dirname, '..', 'workflows', 'default-dev-flow.yaml');
      const yamlContent = await fs.readFile(yamlPath, 'utf-8');
      const workflowDef = loadWorkflowFromYaml(yamlContent);
      const graphDef = mapYamlToGraphDef(workflowDef);

      const entries = findEntryNodes(graphDef);
      // develop 是唯一的入口节点（没有入边）
      expect(entries).toContain('develop');
      // bug_fix / quality_issue_fix / security_issue_fix 有入边，不是入口
      expect(entries).not.toContain('bug_fix');
    });

    it('collectRoutes 应该按 source 分组边', async () => {
      const yamlPath = path.join(__dirname, '..', 'workflows', 'default-dev-flow.yaml');
      const yamlContent = await fs.readFile(yamlPath, 'utf-8');
      const workflowDef = loadWorkflowFromYaml(yamlContent);
      const graphDef = mapYamlToGraphDef(workflowDef);

      const routes = collectRoutes(workflowDef, graphDef);

      // compile_check 有 2 条出边（pass → test_check, fail → bug_fix）
      const compileRoute = routes.find((r) => r.source === 'compile_check');
      expect(compileRoute).toBeTruthy();
      expect(compileRoute!.edges.length).toBe(2);

      // 其中一条是 loop_back
      const loopBackEdge = compileRoute!.edges.find((e) => e.loop_back);
      expect(loopBackEdge).toBeTruthy();
      expect(loopBackEdge!.target).toBe('bug_fix');
      expect(loopBackEdge!.loop_max).toBe(3);
    });

    it('routeFromSource 应该根据条件选择下一个节点', () => {
      const meta = {
        source: 'compile_check',
        edges: [
          { target: 'test_check', condition: { type: 'function' as const, config: { name: 'compile_pass' } } },
          { target: 'bug_fix', condition: { type: 'function' as const, config: { name: 'compile_fail' } }, loop_back: true, loop_max: 3 },
        ],
      };

      // 编译通过 → test_check
      const passState = {
        node_outputs: { compile_check: [JSON.stringify({ ok: true })] },
        loop_counters: {},
      };
      expect(routeFromSource(passState, meta)).toBe('test_check');

      // 编译失败 → bug_fix
      const failState = {
        node_outputs: { compile_check: [JSON.stringify({ ok: false })] },
        loop_counters: {},
      };
      expect(routeFromSource(failState, meta)).toBe('bug_fix');

      // 编译失败但循环次数达到上限 → __end__（无默认边）
      const exhaustedState = {
        node_outputs: { compile_check: [JSON.stringify({ ok: false })] },
        loop_counters: { compile_check: 3 },
      };
      expect(routeFromSource(exhaustedState, meta)).toBe('__end__');
    });

    it('withLoopCounter 应该自增 loop_counters', async () => {
      const baseAction = async () => ({ results: [] });
      const wrapped = withLoopCounter(baseAction, 'compile_check');

      const state = { loop_counters: { compile_check: 2 } };
      const result = await wrapped(state, {});

      expect(result.loop_counters.compile_check).toBe(3);
    });
  });

  describe('buildTopGraph / buildSubGraph', () => {
    it('buildTopGraph 应该能构建顶层图', () => {
      const def: GraphDef = {
        name: 'test-top',
        plugin_id: 'test',
        nodes: [
          { id: 'a', type: 'command', command: 'echo hello' },
          { id: 'b', type: 'command', command: 'echo world' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b' }],
        loops: [],
        subgraphs: [],
        version: 1,
      };

      const compiled = buildTopGraph(def);
      expect(compiled).toBeTruthy();
    });

    it('buildSubGraph 应该能构建子图', () => {
      const def: GraphDef = {
        name: 'test-sub',
        plugin_id: 'test',
        nodes: [
          { id: 'develop', type: 'command', command: 'echo dev' },
          { id: 'compile_check', type: 'command', command: 'echo build' },
          { id: 'testing', type: 'command', command: 'echo test' },
          { id: 'bug_fix', type: 'command', command: 'echo fix' },
        ],
        edges: [
          { id: 'e1', source: 'develop', target: 'compile_check' },
          { id: 'e2', source: 'compile_check', target: 'testing' },
          { id: 'e3', source: 'compile_check', target: 'bug_fix' },
          { id: 'e4', source: 'bug_fix', target: 'compile_check' },
          { id: 'e5', source: 'testing', target: 'bug_fix' },
        ],
        loops: [],
        subgraphs: [],
        version: 1,
      };

      const compiled = buildSubGraph(def);
      expect(compiled).toBeTruthy();
    });
  });
});
