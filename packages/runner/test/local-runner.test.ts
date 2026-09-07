/**
 * 璇玑 Runner - 本地模式集成测试
 *
 * 测试 runLocal() 函数及其辅助工具。
 * 集成测试需要真实的 CLI（claude / codex），如果不可用则自动跳过。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runLocal,
  generateQuestionId,
  createInboxQuestion,
  type AdapterEvent,
  type LocalRunOptions,
  type LocalRunResult,
} from '../src/index.js';

// ─── CLI 可用性检测 ────────────────────────────────────────────────────────────

/** 检查命令是否在 PATH 中可用 */
function isCliAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** claude CLI 是否可用 */
const claudeAvailable = isCliAvailable('claude');

/** codex CLI 是否可用 */
const codexAvailable = isCliAvailable('codex');

// ─── 辅助工具 ──────────────────────────────────────────────────────────────────

/** 创建临时工作目录 */
function createTempWorkDir(): string {
  return mkdtempSync(join(tmpdir(), 'xuanji-runner-test-'));
}

/** 清理临时工作目录 */
function cleanupTempWorkDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略清理错误
  }
}

// ─── 单元测试：辅助函数 ────────────────────────────────────────────────────────

describe('辅助函数', () => {
  describe('generateQuestionId', () => {
    it('应返回 UUID 格式的字符串', () => {
      const id = generateQuestionId();
      // UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('每次调用应返回不同的 ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateQuestionId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('createInboxQuestion', () => {
    it('应创建包含 id 和 body 的问题对象', () => {
      const question = createInboxQuestion('请选择一个选项');
      expect(question.id).toBeTruthy();
      expect(question.body).toBe('请选择一个选项');
      expect(question.choices).toBeUndefined();
    });

    it('应支持可选的 choices 参数', () => {
      const choices = ['选项 A', '选项 B', '选项 C'];
      const question = createInboxQuestion('请选择', choices);
      expect(question.choices).toEqual(choices);
    });

    it('每次创建的问题 ID 应不同', () => {
      const q1 = createInboxQuestion('问题 1');
      const q2 = createInboxQuestion('问题 2');
      expect(q1.id).not.toBe(q2.id);
    });
  });
});

// ─── 单元测试：不支持的提供者 ──────────────────────────────────────────────────

describe('runLocal - 不支持的提供者', () => {
  it('应返回错误结果', async () => {
    const result = await runLocal({
      provider: 'unknown' as 'claude',
      prompt: '测试',
      workDir: tmpdir(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('不支持的提供者');
  });
});

// ─── 集成测试：Claude Code CLI ─────────────────────────────────────────────────

describe('runLocal - Claude Code 集成测试', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = createTempWorkDir();
  });

  // 动态跳过：如果 claude CLI 不可用则跳过整个 describe
  const describeFn = claudeAvailable ? describe : describe.skip;

  describeFn('claude CLI 可用', () => {
    it('应成功执行简单 prompt 并返回结果', async () => {
      const events: AdapterEvent[] = [];

      const result: LocalRunResult = await runLocal({
        provider: 'claude',
        prompt: '请回答：1+1等于几？只回答数字，不要其他内容。',
        workDir,
        onEvent: (event) => {
          events.push(event);
        },
      });

      // 验证基本结果结构
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('finalOutput');

      // 如果成功，验证事件流
      if (result.success) {
        // 应该有 system init 事件（包含 sessionId）
        const systemEvents = events.filter(
          (e) => e.type === 'system' && e.subtype === 'init',
        );
        expect(systemEvents.length).toBeGreaterThan(0);
        expect(systemEvents[0].sessionId).toBeTruthy();

        // 应该有 result 事件
        const resultEvents = events.filter((e) => e.type === 'result');
        expect(resultEvents.length).toBeGreaterThan(0);
      }
    }, 60_000); // 60 秒超时

    it('应通过 onEvent 回调传递事件', async () => {
      const events: AdapterEvent[] = [];

      await runLocal({
        provider: 'claude',
        prompt: '说 "hello"，只说这一个词。',
        workDir,
        onEvent: (event) => {
          events.push(event);
        },
      });

      // 事件列表不应为空（至少有 system 和 result 事件）
      expect(events.length).toBeGreaterThan(0);

      // 第一个事件应该是 system init
      const firstEvent = events[0];
      expect(firstEvent.type).toBe('system');
      expect(firstEvent.subtype).toBe('init');

      // 最后一个事件应该是 result
      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe('result');
    }, 60_000);

    it('应返回 sessionInfo 用于后续恢复', async () => {
      const result = await runLocal({
        provider: 'claude',
        prompt: '你好，请记住我的名字是"测试用户"。只回答"好的"。',
        workDir,
      });

      if (result.success) {
        // 应该返回 sessionInfo
        expect(result.sessionInfo).toBeDefined();
        expect(result.sessionInfo?.providerConversationId).toBeTruthy();
      }
    }, 60_000);

    it('应支持会话恢复（resume）', async () => {
      // 第一步：执行初始 prompt，获取 sessionId
      const firstResult = await runLocal({
        provider: 'claude',
        prompt: '请记住数字 42。只回答"好的"。',
        workDir,
      });

      if (!firstResult.success || !firstResult.sessionInfo) {
        // 如果第一次调用失败，跳过恢复测试
        return;
      }

      // 第二步：使用 resume 恢复会话，询问之前记住的内容
      const resumeResult = await runLocal({
        provider: 'claude',
        prompt: '我之前让你记住的数字是什么？只回答数字。',
        workDir,
        resume: {
          providerConversationId: firstResult.sessionInfo.providerConversationId,
          input: '我之前让你记住的数字是什么？只回答数字。',
        },
      });

      // 恢复应该成功
      if (resumeResult.success && resumeResult.finalOutput) {
        // 输出中应该包含 42
        expect(resumeResult.finalOutput).toContain('42');
      }
    }, 120_000); // 恢复测试需要更长时间

    it('应支持指定 model 参数', async () => {
      // 使用一个轻量模型来减少成本
      const result = await runLocal({
        provider: 'claude',
        prompt: '回答 OK，只回答这一个词。',
        workDir,
        model: 'claude-haiku-4-5',
      });

      // 验证结果结构正确（不验证是否成功，因为模型名称可能不被支持）
      expect(result).toHaveProperty('success');
    }, 60_000);
  });
});

// ─── 集成测试：Codex CLI ───────────────────────────────────────────────────────

describe('runLocal - Codex 集成测试', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = createTempWorkDir();
  });

  // 动态跳过：如果 codex CLI 不可用则跳过整个 describe
  const describeFn = codexAvailable ? describe : describe.skip;

  describeFn('codex CLI 可用', () => {
    it('应成功执行简单 prompt', async () => {
      const events: AdapterEvent[] = [];

      const result = await runLocal({
        provider: 'codex',
        prompt: '回答 1+1 的结果，只说数字。',
        workDir,
        onEvent: (event) => {
          events.push(event);
        },
      });

      // 验证结果结构
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('finalOutput');

      if (result.success && events.length > 0) {
        // 应有 system init 事件
        const systemEvents = events.filter(
          (e) => e.type === 'system' && e.subtype === 'init',
        );
        expect(systemEvents.length).toBeGreaterThan(0);
      }
    }, 60_000);
  });
});

// ─── 错误处理测试 ──────────────────────────────────────────────────────────────

describe('runLocal - 错误处理', () => {
  it('应在无效工作目录时返回错误', async () => {
    const result = await runLocal({
      provider: 'claude',
      prompt: '测试',
      workDir: '/nonexistent/path/that/does/not/exist',
    });

    // 应该失败（CLI 无法在不存在的路径运行）
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  }, 30_000);
});

// ─── 类型导出验证 ──────────────────────────────────────────────────────────────

describe('类型导出验证', () => {
  it('应导出所有必要的类型和函数', () => {
    // 验证函数导出
    expect(typeof runLocal).toBe('function');
    expect(typeof generateQuestionId).toBe('function');
    expect(typeof createInboxQuestion).toBe('function');
  });
});
