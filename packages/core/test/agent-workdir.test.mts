// packages/core/test/agent-workdir.test.mts
// resolveAgentWorkDir 单元测试 —— 纯逻辑，不连数据库、不建 worktree
//
// 回归背景（2026-09-10 事故）：
// agent-node 读的是 task.targetRepoPath（camelCase），而 Prisma 返回的是
// task.target_repo_path（snake_case）——判断恒不成立，workDir 静默落到
// process.cwd()，也就是 core 服务自己的 packages/core。于是被调度的 agent
// 带着全工具权限在璇玑的源码目录里执行，改坏了正在开发的代码。
//
// 这里锁死三件事：
//   1. 读对字段名（snake_case）
//   2. 需求级执行（state.task 为 null）走执行实例自己的 target_repo_path
//   3. 三条路径都拿不到时**报错**，绝不降级到 process.cwd()

import { describe, it, expect } from 'vitest';
import { resolveAgentWorkDir } from '../src/graph/agent-node.mjs';

/** 构造一个假的"执行实例路径查询" */
const execPath = (p: string | null) => async () => p;

describe('resolveAgentWorkDir', () => {
  it('读 task.target_repo_path（Prisma 的 snake_case 字段）', async () => {
    const dir = await resolveAgentWorkDir({
      task: { id: 't1', target_repo_path: '/repo/target' },
      executionId: 'exec-1',
      nodeId: 'develop',
      lookupExecRepoPath: execPath(null),
    });
    expect(dir).toBe('/repo/target');
  });

  it('回归：只有 snake_case 的真实 Prisma 行不会被漏读而落到 cwd', async () => {
    // 这行的形状就是 db.tasks.findFirst() 实际返回的形状
    const prismaRow = {
      id: 't1',
      title: '图书添加接口',
      target_repo_path: '/repo/ruoyi',
    } as any;

    const dir = await resolveAgentWorkDir({
      task: prismaRow,
      executionId: 'exec-1',
      nodeId: 'develop',
      lookupExecRepoPath: execPath('/should-not-be-used'),
    });

    expect(dir).toBe('/repo/ruoyi');
  });

  it('需求级执行（state.task 为 null）走执行实例自己的 target_repo_path', async () => {
    const dir = await resolveAgentWorkDir({
      task: null,
      executionId: 'exec-2',
      nodeId: 'requirement_analysis',
      lookupExecRepoPath: execPath('/repo/requirement'),
    });
    expect(dir).toBe('/repo/requirement');
  });

  it('子图节点用该任务独立的 worktree', async () => {
    const dir = await resolveAgentWorkDir({
      task: { id: 'task-uuid-1' },
      isSubgraph: true,
      execShortid: 'abcd1234',
      executionId: 'exec-3',
      nodeId: 'develop',
      lookupExecRepoPath: execPath('/fallback'),
      createWorktree: async (taskShortid, execShortid) => `/worktrees/task-${taskShortid}`,
    });
    expect(dir).toBe('/worktrees/task-task-uuid-1');
  });

  it('三条路径都拿不到时报错，绝不降级到 process.cwd()', async () => {
    await expect(
      resolveAgentWorkDir({
        task: { id: 't1' }, // 没有 target_repo_path
        executionId: 'exec-4',
        nodeId: 'develop',
        lookupExecRepoPath: execPath(null),
      }),
    ).rejects.toThrow(/工作目录/);
  });
});
