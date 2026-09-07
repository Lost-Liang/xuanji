// packages/core/src/storage/execution-store.mts
// 执行实例 + 租约管理 —— 璇玑 V4 Storage 层
// 租约机制是并发控制的核心，使用 workerId + leaseToken + fencingToken 三元组保证原子性

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { TaskExecution } from '@prisma/client';

/**
 * 租约信息 —— Worker 持有此对象证明其对执行实例的所有权
 * - workerId:     工作者标识
 * - leaseToken:   租约令牌（每次 acquire 重新生成）
 * - fencingToken: 防护令牌（单调递增，防止过期 Worker 操作资源）
 */
export interface LeaseInfo {
  workerId: string;
  leaseToken: string;
  fencingToken: number;
}

export const executionStore = {
  /**
   * 创建执行实例
   */
  async create(data: {
    subjectType: 'task' | 'requirement';
    subjectId: string;
    taskId?: string;
    requirementId?: string;
    targetProjectId: string;
    targetRepoPath: string;
  }): Promise<TaskExecution> {
    return db.taskExecution.create({
      data: {
        executionId: randomUUID(),
        ...data,
        status: 'pending',
      },
    });
  },

  /**
   * 根据执行 ID 查询执行实例
   */
  async get(executionId: string): Promise<TaskExecution | null> {
    return db.taskExecution.findUnique({
      where: { executionId },
    });
  },

  /**
   * 获取租约 —— 原子性 CAS 操作
   *
   * 通过 updateMany + 条件 WHERE 实现：
   * - 仅当 status='pending' 或 'rate_limited'（retryAt 已到期）且 workerId=null 时才能获取
   * - 保证只有一个 Worker 能成功获取租约
   * - 失败时返回 null（已被其他 Worker 获取或状态不符）
   */
  async acquireLease(
    executionId: string,
    workerId: string
  ): Promise<LeaseInfo | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 分钟有效期

    // 原子更新：仅当执行实例处于 pending/rate_limited 且无 Worker 占用时生效
    // rate_limited 状态由 releaseLeaseKeepStatus 保留，调度器在 retryAt 到期后重新获取
    const result = await db.taskExecution.updateMany({
      where: {
        executionId,
        status: { in: ['pending', 'rate_limited'] },
        workerId: null,
      },
      data: {
        status: 'running',
        workerId,
        leaseToken,
        fencingToken: { increment: 1 }, // 防护令牌递增，使旧租约失效
        leaseExpiresAt,
        heartbeatAt: new Date(),
        startedAt: new Date(),
      },
    });

    // count === 0 表示条件不满足（已被占用或状态不符）
    if (result.count === 0) return null;

    // 回读已更新的记录，返回租约信息
    const execution = await db.taskExecution.findUnique({
      where: { executionId },
    });
    if (!execution) return null;

    return {
      workerId: execution.workerId!,
      leaseToken: execution.leaseToken!,
      fencingToken: execution.fencingToken,
    };
  },

  /**
   * 续期心跳 —— 刷新 heartbeatAt 时间戳
   *
   * 使用完整的租约三元组校验，确保持有者身份合法。
   * 返回 false 表示租约已失效（可能被回收或已被其他 Worker 抢占）。
   */
  async renewHeartbeat(
    executionId: string,
    lease: LeaseInfo
  ): Promise<boolean> {
    const result = await db.taskExecution.updateMany({
      where: {
        executionId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
      },
      data: { heartbeatAt: new Date() },
    });
    return result.count > 0;
  },

  /**
   * 释放租约 —— Worker 主动放弃执行权
   *
   * 将执行实例重置为 pending 状态，允许其他 Worker 重新获取。
   * 仅需 workerId + leaseToken 校验（释放操作无需 fencingToken）。
   */
  async releaseLease(executionId: string, lease: LeaseInfo): Promise<void> {
    await db.taskExecution.updateMany({
      where: {
        executionId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
      },
      data: {
        workerId: null,
        leaseToken: null,
        status: 'pending',
      },
    });
  },

  /**
   * 释放租约但保留当前状态 —— 用于 429 限流场景
   *
   * 与 releaseLease 的区别：不重置 status 字段。
   * 调用方（setRateLimited）已将 status 设为 'rate_limited'，
   * 此处仅清理租约字段（workerId/leaseToken），让调度器在 retryAt 到期后重新获取。
   *
   * 如果同时重置 status='pending'，调度器会在 retryAt 到期前就拾取该任务，
   * 导致限流退避策略完全失效。
   */
  async releaseLeaseKeepStatus(executionId: string, lease: LeaseInfo): Promise<void> {
    await db.taskExecution.updateMany({
      where: {
        executionId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
      },
      data: {
        workerId: null,
        leaseToken: null,
        // 不重置 status —— 保持 'rate_limited' 状态
        // 调度器查询 status='pending'，只有 retryAt 到期后才会被拾取
      },
    });
  },

  /**
   * 标记执行完成
   *
   * 同时清理租约字段（workerId/leaseToken/leaseExpiresAt），
   * 避免数据库中残留脏租约信息。
   */
  async complete(executionId: string, finalOutput: string): Promise<void> {
    await db.taskExecution.update({
      where: { executionId },
      data: {
        status: 'completed',
        finalOutput,
        completedAt: new Date(),
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  },

  /**
   * 标记执行失败
   *
   * 同时清理租约字段（workerId/leaseToken/leaseExpiresAt），
   * 避免数据库中残留脏租约信息。
   */
  async fail(executionId: string, errorMessage: string): Promise<void> {
    await db.taskExecution.update({
      where: { executionId },
      data: {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  },

  /**
   * 标记限流（429）—— 设置重试时间和递增限流计数
   *
   * 退避策略：5分钟 → 10分钟 → 30分钟 → 60分钟
   * 最大重试 4 次（由调用方控制）
   */
  async setRateLimited(
    executionId: string,
    retryAt: Date,
    errorMessage: string
  ): Promise<void> {
    await db.taskExecution.update({
      where: { executionId },
      data: {
        rateLimitCount: { increment: 1 },
        retryAt,
        errorMessage,
        status: 'rate_limited',
      },
    });
  },

  /**
   * 僵尸检测 —— 查找心跳超时的执行实例
   *
   * 默认超时 10 分钟。用于调度器的恢复机制：
   * 发现僵尸后，调度器可强制释放租约并重新调度。
   */
  async findZombies(timeoutMinutes: number = 10): Promise<TaskExecution[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    return db.taskExecution.findMany({
      where: {
        status: 'running',
        heartbeatAt: { lt: cutoff },
      },
    });
  },

  /**
   * 强制释放僵尸租约 —— 由 recovery-worker 调用
   *
   * 与 releaseLease 的区别：
   * - 无需 workerId/leaseToken 校验（僵尸进程的 Worker 已失联）
   * - 同时清理 leaseExpiresAt/heartbeatAt，避免残留脏租约
   * - 将 status 重置为 'pending'，让调度器重新拾取
   *
   * 条件 WHERE 仍限定 status='running'，避免误覆盖其他 Worker 已完成的执行
   */
  async forceReleaseZombie(executionId: string): Promise<boolean> {
    const result = await db.taskExecution.updateMany({
      where: {
        executionId,
        status: 'running',
      },
      data: {
        status: 'pending',
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    return result.count > 0;
  },
};
