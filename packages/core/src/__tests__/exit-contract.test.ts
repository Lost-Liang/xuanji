// packages/core/src/__tests__/exit-contract.test.ts
// Task 4: 准出契约测试

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { verifyContract } from '../graph/contract-verifier.mjs';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Exit Contract', () => {
  let testDir: string;

  beforeAll(() => {
    // 创建临时测试目录
    testDir = join(tmpdir(), `exit-contract-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // 清理临时目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Schema 校验', () => {
    it('应该通过 schema 校验（字段存在且类型正确）', async () => {
      const output = JSON.stringify({
        ok: true,
        summary: '测试通过',
        test_count: 5,
      });
      const contract = {
        schema: {
          ok: 'boolean' as const,
          summary: 'string' as const,
          test_count: 'number' as const,
        },
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('应该失败：缺少字段', async () => {
      const output = JSON.stringify({ ok: true });
      const contract = {
        schema: {
          ok: 'boolean' as const,
          summary: 'string' as const,
        },
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].type).toBe('schema');
      expect(result.failures[0].field).toBe('summary');
    });

    it('应该失败：字段类型错误', async () => {
      const output = JSON.stringify({ ok: 'yes', test_count: 'five' });
      const contract = {
        schema: {
          ok: 'boolean' as const,
          test_count: 'number' as const,
        },
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures).toHaveLength(2);
      expect(result.failures.map(f => f.field)).toEqual(
        expect.arrayContaining(['ok', 'test_count']),
      );
    });

    it('应该支持数组类型校验', async () => {
      const output = JSON.stringify({
        ok: true,
        test_files: ['file1.test.ts', 'file2.test.ts'],
      });
      const contract = {
        schema: {
          test_files: 'string[]' as const,
        },
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该失败：数组字段不是数组', async () => {
      const output = JSON.stringify({ test_files: 'not-an-array' });
      const contract = {
        schema: {
          test_files: 'string[]' as const,
        },
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures[0].type).toBe('schema');
    });
  });

  describe('Requires 断言', () => {
    it('应该通过：文件存在断言', async () => {
      const filePath = join(testDir, 'exists.txt');
      writeFileSync(filePath, 'test content');

      const contract = {
        requires: [{ type: 'file_exists' as const, path: filePath }],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该失败：文件不存在断言', async () => {
      const contract = {
        requires: [
          { type: 'file_exists' as const, path: join(testDir, 'nonexistent.txt') },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures[0].type).toBe('assertion');
    });

    it('应该通过：文件不存在断言', async () => {
      const contract = {
        requires: [
          {
            type: 'file_not_exists' as const,
            path: join(testDir, 'nonexistent.txt'),
          },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该失败：文件存在但期望不存在', async () => {
      const filePath = join(testDir, 'exists.txt');
      writeFileSync(filePath, 'test content');

      const contract = {
        requires: [{ type: 'file_not_exists' as const, path: filePath }],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(false);
    });

    it('应该通过：命令执行断言（退出码 0）', async () => {
      const contract = {
        requires: [
          {
            type: 'command' as const,
            run: 'echo hello',
            expect_exit: 0,
          },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该失败：命令执行断言（退出码不匹配）', async () => {
      const contract = {
        requires: [
          {
            type: 'command' as const,
            run: 'exit 1',
            expect_exit: 0,
          },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures[0].detail).toContain('退出码');
    });

    it('应该通过：grep 断言（内容存在）', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'Hello World\nTest Line');

      const contract = {
        requires: [
          {
            type: 'grep' as const,
            path: filePath,
            pattern: 'World',
            expect: 'present' as const,
          },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该失败：grep 断言（内容不存在）', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'Hello World');

      const contract = {
        requires: [
          {
            type: 'grep' as const,
            path: filePath,
            pattern: 'NotFound',
            expect: 'present' as const,
          },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(false);
    });

    it('应该支持命令超时', async () => {
      const contract = {
        requires: [
          {
            type: 'command' as const,
            run: 'sleep 10',
            timeout_seconds: 1,
          },
        ],
      };
      const result = await verifyContract('test', '{}', contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures[0].detail).toContain('超时');
    }, 5000);
  });

  describe('混合场景', () => {
    it('应该同时执行 schema 和 requires', async () => {
      const filePath = join(testDir, 'mixed.txt');
      writeFileSync(filePath, 'test');

      const output = JSON.stringify({ ok: true, summary: '完成' });
      const contract = {
        schema: { ok: 'boolean' as const, summary: 'string' as const },
        requires: [{ type: 'file_exists' as const, path: filePath }],
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该累积所有失败', async () => {
      const output = JSON.stringify({ ok: 'wrong' }); // 类型错误
      const contract = {
        schema: { ok: 'boolean' as const, summary: 'string' as const }, // 缺少 summary
        requires: [
          { type: 'file_exists' as const, path: join(testDir, 'missing.txt') },
        ],
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('边界情况', () => {
    it('应该处理空 contract', async () => {
      const output = JSON.stringify({ ok: true });
      const contract = {};
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该处理空 schema', async () => {
      const output = JSON.stringify({ ok: true });
      const contract = { schema: {} };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该处理空 requires', async () => {
      const output = JSON.stringify({ ok: true });
      const contract = { requires: [] };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(true);
    });

    it('应该处理非 JSON 输出', async () => {
      const output = 'This is not JSON';
      const contract = {
        schema: { ok: 'boolean' as const },
      };
      const result = await verifyContract('test', output, contract, testDir);
      expect(result.ok).toBe(false);
      expect(result.failures[0].type).toBe('schema');
    });
  });
});