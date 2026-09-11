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
  buildAgentContext,
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
      // __end__ 边在 GraphDef 中保留（LangGraph END 节点）
      expect(graphDef.edges.length).toBe(workflowDef.edges.length);

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
      // loop_max 未设置，使用 DEFAULT_MAX=3
      // visits <= 3 回环，visits > 3 耗尽
      const exhaustedState = {
        node_outputs: { compile_check: [JSON.stringify({ ok: false })] },
        loop_counters: { compile_check: 4 },
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

  describe('buildAgentContext', () => {
    it('should read state.spec when context=spec', () => {
      const state = {
        spec: JSON.stringify({
          business_goal: '业务目标',
          scope: { in_scope: ['功能1'] },
        }),
      };

      const result = buildAgentContext(state, 'spec');

      expect(result).toContain('基于以下需求规格进行任务拆解');
      expect(result).toContain('业务目标');
      expect(result).toContain('scope');
    });

    it('should read state.input when context=input (default)', () => {
      const state = {
        input: '原始需求文本',
      };

      const result = buildAgentContext(state, 'input');

      expect(result).toBe('原始需求文本');
    });

    it('should fallback to input when spec is invalid JSON', () => {
      const state = {
        spec: 'invalid json',
        input: 'fallback text',
      };

      const result = buildAgentContext(state, 'spec');

      expect(result).toBe('fallback text');
    });

    it('should handle spec as an object (not string)', () => {
      const state = {
        spec: { business_goal: '直接对象' },
      };

      const result = buildAgentContext(state, 'spec');

      expect(result).toContain('基于以下需求规格进行任务拆解');
      expect(result).toContain('直接对象');
    });

    it('should fallback to task.title then task.description', () => {
      const stateWithTaskTitle = { task: { title: '任务标题', description: '任务描述' } };
      expect(buildAgentContext(stateWithTaskTitle, 'input')).toBe('任务标题');

      const stateWithTaskDesc = { task: { description: '任务描述' } };
      expect(buildAgentContext(stateWithTaskDesc, 'input')).toBe('任务描述');
    });

    it('should return empty string when no data available', () => {
      const state = {};
      expect(buildAgentContext(state, 'input')).toBe('');
    });
  });

  describe('yaml-loader context field', () => {
    it('should preserve context field in GraphNode', () => {
      const yaml = `
version: "1"
id: test
name: 测试
nodes:
  - id: node1
    type: agent
    agent_binding_ids: [agent1]
    context: spec
edges: []
start:
  - node1
`;
      const workflow = loadWorkflowFromYaml(yaml);
      const graphDef = mapYamlToGraphDef(workflow);

      expect(graphDef.nodes[0].context).toBe('spec');
    });

    it('should default context to undefined when not specified', () => {
      const yaml = `
version: "1"
id: test
name: 测试
nodes:
  - id: node1
    type: agent
    agent_binding_ids: [agent1]
edges: []
start:
  - node1
`;
      const workflow = loadWorkflowFromYaml(yaml);
      const graphDef = mapYamlToGraphDef(workflow);

      expect(graphDef.nodes[0].context).toBeUndefined();
    });

    it('should preserve context in WorkflowNode type', () => {
      const yaml = `
version: "1"
id: test
name: 测试
nodes:
  - id: node1
    type: agent
    agent_binding_ids: [agent1]
    context: tasks
edges: []
start:
  - node1
`;
      const workflow = loadWorkflowFromYaml(yaml);

      expect(workflow.nodes[0].context).toBe('tasks');
    });
  });
});
