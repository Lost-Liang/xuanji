// packages/core/src/__tests__/e2e-loop-recovery.test.ts
// Task 7：端到端验证 —— 回归 4d2d1401 事故场景
//
// 事故（4d2d1401）的现象：
//   测试失败后回到 develop 重做，但 develop 复用了上一次的 session，
//   AI 只是复述旧答案（甚至空转），流程无法收敛，最终超时。
//
// 本次端到端验证的场景（全部走真实编排层，只把 CLI 进程边界 runLocal 换成打桩）：
//   write_tests → develop → test(失败) → develop(真正的重做) → test(通过) → code_review
//
// 断言：
//   1. 节点执行序列正确
//   2. agent 调用次数 = 6（回环部分 4 次：develop×2 + test×2）
//   3. 第 2 次 develop 是真正的重做：新 session、attempt=2、绝不复用事故遗留 session
//   4. 第 2 次 develop 的 prompt 携带测试失败报告（inputs: [task, test] 生效）
//   5. loop_counters 是节点已完成次数的唯一真相来源

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 打桩状态（vi.hoisted：vi.mock 工厂会被提升，必须用 hoisted 共享状态）──────

interface RunnerCall {
  prompt: string;
  resume: any;
  node: string;
}

const h = vi.hoisted(() => ({
  runnerCalls: [] as RunnerCall[],
  agentInvocations: 0,
  phaseRows: [] as any[],
  nodeRunCounts: {} as Record<string, number>,
}));

// ─── 打桩：CLI 进程边界（唯一的外部副作用）─────────────────────────────────────

vi.mock('@xuanji/runner', () => {
  /**
   * 从 prompt 的「输出格式要求」中识别当前是哪个节点。
   * 只看最后一段输出格式要求 —— 上游节点的产出会原样拼进 prompt，
   * 若在整段 prompt 里搜关键词，会把 test 误判成 develop（它引用了 develop 的输出）。
   */
  function detectNode(prompt: string): string {
    const fmtIdx = prompt.lastIndexOf('## 输出格式要求');
    const fmt = fmtIdx >= 0 ? prompt.slice(fmtIdx) : prompt;
    if (fmt.includes('"test_files"')) return 'write_tests';
    if (fmt.includes('"files_created"')) return 'develop';
    if (fmt.includes('"passed_count"')) return 'test';
    if (fmt.includes('"approved"')) return 'code_review';
    if (fmt.includes('"issues_resolved"')) return 'code_fix';
    return 'unknown';
  }

  /** 依据节点与第几次执行，产出确定性的 agent 输出 */
  function buildOutput(node: string, runIndex: number): string {
    if (node === 'write_tests') {
      return JSON.stringify({ ok: true, summary: '测试已编写', test_files: ['login.test.ts'], test_count: 3 });
    }
    if (node === 'develop') {
      return runIndex === 1
        ? JSON.stringify({ ok: true, summary: '开发完成 v1', files_created: ['login.ts'], compilation_ok: true })
        : JSON.stringify({ ok: true, summary: '按测试失败报告重做 v2', files_created: ['login.ts'], compilation_ok: true });
    }
    if (node === 'test') {
      return runIndex === 1
        ? JSON.stringify({ ok: false, summary: '1 个测试失败', passed: false, passed_count: 2, total_count: 3 })
        : JSON.stringify({ ok: true, summary: '全部测试通过', passed: true, passed_count: 3, total_count: 3 });
    }
    if (node === 'code_review') {
      return JSON.stringify({ ok: true, summary: '审查通过', approved: true, issues: [] });
    }
    return JSON.stringify({ ok: true, summary: 'unknown' });
  }

  return {
    runLocal: async (opts: any) => {
      const node = detectNode(opts.prompt);
      h.nodeRunCounts[node] = (h.nodeRunCounts[node] ?? 0) + 1;
      const runIndex = h.nodeRunCounts[node];
      const sessionId = `session-${h.runnerCalls.length + 1}`;
      h.runnerCalls.push({ prompt: opts.prompt, resume: opts.resume, node });

      if (opts.onEvent) await opts.onEvent({ type: 'system', subtype: 'init', sessionId });
      const output = buildOutput(node, runIndex);
      if (opts.onEvent) await opts.onEvent({ type: 'result', subtype: 'success', output });

      return {
        success: true,
        finalOutput: output,
        sessionInfo: { providerConversationId: sessionId },
      };
    },
  };
});

// ─── 打桩：持久化边界（本测试只关心编排行为，不写真实数据库）────────────────────

vi.mock('../db.mjs', () => ({
  db: {
    phase_instances: {
      findFirst: async (args: any) => {
        const w = args?.where ?? {};
        return (
          h.phaseRows.find(
            (r) =>
              r.execution_id === w.execution_id &&
              r.phase_id === w.phase_id &&
              r.attempt === w.attempt,
          ) ?? null
        );
      },
      create: async (args: any) => {
        const row = { ...args.data };
        h.phaseRows.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = h.phaseRows.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
    },
    phase_outputs: {
      create: async (args: any) => args.data,
    },
  },
}));

vi.mock('../storage/conversation-store.mjs', () => ({
  conversationStore: { saveEvent: async () => {} },
}));

vi.mock('../storage/execution-store.mjs', () => ({
  executionStore: {
    incrementAgentInvocations: async () => {
      h.agentInvocations += 1;
    },
    complete: async () => {},
    fail: async () => {},
    failWithEvent: async () => {},
  },
}));

vi.mock('../storage/agent-binding-store.mjs', () => ({
  getByRole: async (roles: string[]) => [
    {
      id: `binding-${roles?.[0] ?? 'default'}`,
      role: roles?.[0] ?? 'default',
      prompt_content: `你是 ${roles?.[0] ?? 'agent'}。`,
      harness: 'claude',
      model: null,
      skill_id: null,
      triggers: {},
    },
  ],
}));

vi.mock('../lib/skill-content.mjs', () => ({
  readSkillContent: () => null,
  extractSkillBody: (s: string) => s,
}));

vi.mock('../graph/shared-agent-utils.mjs', () => ({
  mapAdapterEvent: () => null,
  handleInboxAsk: async () => ({}),
}));

// ─── 被测模块 ──────────────────────────────────────────────────────────────────

import { buildGraphFromDef } from '../graph/builder.mjs';
import { loadWorkflowFromYaml } from '../graph/yaml-loader.mjs';
import { initDefaultConditions } from '../graph/conditions/default-conditions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'workflows');

const SHIPPED_WORKFLOWS = [
  'ruoyi-dev-flow.yaml',
  'default-dev-flow.yaml',
  'requirement-decomposition.yaml',
];

describe('E2E: Workflow Migration (存量流程升级到新 schema)', () => {
  it('三个存量流程都能通过加载校验', async () => {
    for (const file of SHIPPED_WORKFLOWS) {
      const yamlContent = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8');
      // loadWorkflowFromYaml 是 hard fail：缺 source 会直接抛错
      expect(() => loadWorkflowFromYaml(yamlContent), file).not.toThrow();
    }
  });

  it('所有 function 条件边都声明了 source', async () => {
    for (const file of SHIPPED_WORKFLOWS) {
      const yamlContent = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const def = loadWorkflowFromYaml(yamlContent);
      for (const edge of def.edges) {
        if (edge.condition?.type === 'function') {
          expect(edge.condition.config.source, `${file}: ${edge.from}→${edge.to}`).toBeTruthy();
        }
      }
    }
  });

  it('所有流程都声明了 budget', async () => {
    for (const file of SHIPPED_WORKFLOWS) {
      const yamlContent = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const def = loadWorkflowFromYaml(yamlContent);
      expect(def.budget, file).toBeTruthy();
      expect(def.budget?.max_agent_invocations, file).toBeGreaterThan(0);
      expect(def.budget?.max_wall_clock_minutes, file).toBeGreaterThan(0);
      expect(def.budget?.max_node_visits, file).toBeGreaterThan(0);
    }
  });

  it('ruoyi-dev-flow 的 develop 声明 inputs: [task, test]（回环重入携带失败原因）', async () => {
    const yamlContent = await fs.readFile(path.join(WORKFLOWS_DIR, 'ruoyi-dev-flow.yaml'), 'utf-8');
    const def = loadWorkflowFromYaml(yamlContent);
    const develop = def.nodes.find((n) => n.id === 'develop');
    expect(develop?.inputs).toEqual(['task', 'test']);
  });

  it('ruoyi-dev-flow 可构建为可执行图', async () => {
    initDefaultConditions();
    const yamlContent = await fs.readFile(path.join(WORKFLOWS_DIR, 'ruoyi-dev-flow.yaml'), 'utf-8');
    expect(() => buildGraphFromDef(yamlContent)).not.toThrow();
  });
});

describe('E2E: Loop Recovery (4d2d1401 regression)', () => {
  beforeAll(() => {
    initDefaultConditions();
  });

  beforeEach(() => {
    h.runnerCalls.length = 0;
    h.agentInvocations = 0;
    h.phaseRows.length = 0;
    for (const k of Object.keys(h.nodeRunCounts)) delete h.nodeRunCounts[k];
  });

  it('test 失败 → develop 重做（新会话）→ test 通过 → code_review', async () => {
    const yamlContent = await fs.readFile(
      path.join(WORKFLOWS_DIR, 'ruoyi-dev-flow.yaml'),
      'utf-8',
    );

    const executionId = 'e2e-exec-1';
    const threadId = 'e2e-thread-1';

    // 事故现场预置：上一次执行遗留在 attempt=2 的 develop 会话。
    // 若回环重入被误判为「串行续跑」，develop 会复用这个 session 而复述旧答案。
    h.phaseRows.push({
      id: 'stale-develop-attempt-2',
      execution_id: executionId,
      phase_id: 'develop',
      attempt: 2,
      status: 'failed',
      session_id: 'stale-session-from-incident',
    });

    const graph = buildGraphFromDef(yamlContent);
    const config = {
      configurable: { thread_id: threadId, execution_id: executionId, exec_shortid: 'e2eexec1' },
    };

    let result: any = null;
    let interrupted = false;
    try {
      result = await graph.invoke(
        {
          task: {
            id: 'task-1',
            title: '实现登录接口',
            description: '用户名密码登录',
            target_repo_path: '/tmp/e2e-repo',
          },
        },
        config,
      );
    } catch (err: any) {
      // code_review 之后是 final_review（人审 gate），会挂起等待人工 —— 这是预期行为
      if (err?.name === 'GraphInterrupt' || String(err?.message ?? '').includes('interrupt')) {
        interrupted = true;
      } else {
        throw err;
      }
    }

    // 断言 1：节点执行序列
    expect(h.runnerCalls.map((c) => c.node)).toEqual([
      'write_tests',
      'develop',
      'test',
      'develop',
      'test',
      'code_review',
    ]);

    // 断言 2：agent 调用次数 = 6，其中回环部分 4 次（develop×2 + test×2）
    expect(h.agentInvocations).toBe(6);
    const loopCalls = h.runnerCalls.filter((c) => c.node === 'develop' || c.node === 'test');
    expect(loopCalls.length).toBe(4);

    // 断言 3：第 2 次 develop 是真正的重做 —— 新 session，绝不复用事故遗留 session
    const develops = h.runnerCalls.filter((c) => c.node === 'develop');
    expect(develops.length).toBe(2);
    expect(develops[0].resume).toBeUndefined();
    expect(develops[1].resume).toBeUndefined();

    const developPhases = h.phaseRows
      .filter((r) => r.phase_id === 'develop')
      .sort((a, b) => a.attempt - b.attempt);
    expect(developPhases.map((r) => r.attempt)).toEqual([1, 2]);
    expect(developPhases[0].session_id).toBeTruthy();
    expect(developPhases[1].session_id).toBeTruthy();
    expect(developPhases[1].session_id).not.toBe('stale-session-from-incident');
    expect(developPhases[1].session_id).not.toBe(developPhases[0].session_id);

    // 断言 4：第 2 次 develop 的 prompt 携带测试失败报告（inputs: [task, test] 生效）
    expect(develops[1].prompt).toContain('上游阶段产出：test');
    expect(develops[1].prompt).toContain('1 个测试失败');
    // 首次进入 develop 时 test 还没跑过，不应硬塞一个不存在的上游
    expect(develops[0].prompt).not.toContain('上游阶段产出：test');

    // 断言 5：loop_counters 是节点已完成次数的唯一真相来源
    const loopCounters = result?.loop_counters ?? (await readLoopCounters(graph, config));
    expect(loopCounters).toMatchObject({
      write_tests: 1,
      develop: 2,
      test: 2,
      code_review: 1,
    });

    // 场景终点：已经走到 code_review（随后被人审 gate 挂起）
    expect(interrupted || result).toBeTruthy();
  });
});

/** gate 挂起后从 checkpointer 读回最终 state（invoke 抛 GraphInterrupt 时 result 为 null） */
async function readLoopCounters(graph: any, config: any): Promise<Record<string, number>> {
  try {
    const snapshot = await graph.getState(config);
    return snapshot?.values?.loop_counters ?? {};
  } catch {
    return {};
  }
}
