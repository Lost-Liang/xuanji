// packages/core/src/graph/contract-verifier.mts
// Task 4: 准出契约校验器
//
// 职责：
// 1. schema 校验：检查 AI 输出字段类型
// 2. requires 断言：文件存在/命令执行/文件内容检查
// 3. 契约失败不抛错，合成 failures 数组

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { ExitContract, ContractFailure, RequireAssertion } from './types.mjs';

/**
 * 校验契约
 *
 * @param nodeId 节点 ID
 * @param output AI 输出字符串
 * @param contract 契约定义
 * @param workDir 工作目录（命令执行的工作目录）
 * @returns 校验结果：ok=true 表示通过，failures 包含所有失败项
 */
export async function verifyContract(
  nodeId: string,
  output: string,
  contract: ExitContract,
  workDir: string,
): Promise<{ ok: boolean; failures: ContractFailure[] }> {
  const failures: ContractFailure[] = [];

  // 1. Schema 校验
  if (contract.schema) {
    const schemaFailures = verifySchema(output, contract.schema);
    failures.push(...schemaFailures);
  }

  // 2. Requires 断言
  if (contract.requires && contract.requires.length > 0) {
    for (const req of contract.requires) {
      const result = await executeAssertion(req, workDir);
      if (!result.passed) {
        failures.push({
          type: 'assertion',
          assertion: req,
          detail: result.detail,
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

/**
 * Schema 校验：检查字段存在性和类型
 */
function verifySchema(
  output: string,
  schema: Record<string, 'string' | 'number' | 'boolean' | 'string[]'>,
): ContractFailure[] {
  const failures: ContractFailure[] = [];

  // 解析 JSON
  let parsed: any;
  try {
    parsed = JSON.parse(output);
  } catch {
    // JSON 解析失败，所有字段都缺失
    for (const [field] of Object.entries(schema)) {
      failures.push({
        type: 'schema',
        field,
        detail: `无法解析输出为 JSON，缺少字段 ${field}`,
      });
    }
    return failures;
  }

  // 检查每个字段
  for (const [field, expectedType] of Object.entries(schema)) {
    if (!(field in parsed)) {
      failures.push({
        type: 'schema',
        field,
        detail: `缺少字段 ${field}`,
      });
      continue;
    }

    const value = parsed[field];
    const actualType = typeof value;

    // 类型检查
    if (expectedType === 'string[]') {
      // 数组类型检查
      if (!Array.isArray(value)) {
        failures.push({
          type: 'schema',
          field,
          detail: `字段 ${field} 应为 string[] 类型，实际为 ${actualType}`,
        });
      } else if (value.some((item) => typeof item !== 'string')) {
        failures.push({
          type: 'schema',
          field,
          detail: `字段 ${field} 数组包含非字符串元素`,
        });
      }
    } else if (actualType !== expectedType) {
      failures.push({
        type: 'schema',
        field,
        detail: `字段 ${field} 应为 ${expectedType} 类型，实际为 ${actualType}`,
      });
    }
  }

  return failures;
}

/**
 * 执行断言
 */
async function executeAssertion(
  assertion: RequireAssertion,
  workDir: string,
): Promise<{ passed: boolean; detail: string }> {
  switch (assertion.type) {
    case 'file_exists':
      return await checkFileExists(assertion.path!, true);

    case 'file_not_exists':
      return await checkFileExists(assertion.path!, false);

    case 'command':
      return await runCommand(assertion, workDir);

    case 'grep':
      return await runGrep(assertion);

    default:
      return {
        passed: false,
        detail: `未知的断言类型: ${(assertion as any).type}`,
      };
  }
}

/**
 * 文件存在性检查
 */
async function checkFileExists(
  path: string,
  shouldExist: boolean,
): Promise<{ passed: boolean; detail: string }> {
  const exists = existsSync(path);

  if (shouldExist) {
    return {
      passed: exists,
      detail: exists ? '文件存在' : `文件不存在: ${path}`,
    };
  } else {
    return {
      passed: !exists,
      detail: !exists ? '文件不存在' : `文件存在（期望不存在）: ${path}`,
    };
  }
}

/**
 * 命令执行断言
 */
async function runCommand(
  assertion: RequireAssertion,
  workDir: string,
): Promise<{ passed: boolean; detail: string }> {
  const { run, expect_exit = 0, timeout_seconds = 60 } = assertion;

  try {
    execSync(run!, {
      cwd: workDir,
      timeout: timeout_seconds * 1000,
      stdio: 'pipe', // 不输出到控制台
    });

    // 成功退出（退出码 0）
    return {
      passed: expect_exit === 0,
      detail:
        expect_exit === 0
          ? '命令执行成功'
          : `命令退出码为 0，期望 ${expect_exit}`,
    };
  } catch (error: any) {
    // 超时
    if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
      return {
        passed: false,
        detail: `命令执行超时（${timeout_seconds}秒）`,
      };
    }

    // 退出码检查
    const actualExit = error.status ?? 1;
    return {
      passed: actualExit === expect_exit,
      detail:
        actualExit === expect_exit
          ? `命令退出码符合预期: ${expect_exit}`
          : `命令退出码为 ${actualExit}，期望 ${expect_exit}`,
    };
  }
}

/**
 * Grep 断言：检查文件内容
 */
async function runGrep(
  assertion: RequireAssertion,
): Promise<{ passed: boolean; detail: string }> {
  const { path, pattern, expect = 'present' } = assertion;

  // 检查文件存在
  if (!existsSync(path!)) {
    return {
      passed: false,
      detail: `文件不存在: ${path}`,
    };
  }

  // 读取文件内容
  const content = readFileSync(path!, 'utf-8');

  // 正则匹配
  const regex = new RegExp(pattern!, 'm');
  const found = regex.test(content);

  const shouldPresent = expect === 'present';

  return {
    passed: shouldPresent ? found : !found,
    detail:
      shouldPresent
        ? found
          ? `找到匹配内容: ${pattern}`
          : `未找到匹配内容: ${pattern}`
        : found
          ? `找到匹配内容（期望不存在）: ${pattern}`
          : `未找到匹配内容，符合预期`,
  };
}