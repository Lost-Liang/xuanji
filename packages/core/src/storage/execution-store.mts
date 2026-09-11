// packages/core/src/storage/execution-store.mts
// 执行实例 + 租约管理 —— 璇玑 V4 Storage 层
// 租约机制是并发控制的核心，使用 workerId + leaseToken + fencingToken 三元组保证原子性

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { task_executions } from '@prisma/client';

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
   * @param status 默认 'draft'（需求拆分后不自动执行），设为 'pending' 则调度器会自动拾取
   */
  async create(data: {
    subjectType: 'task' | 'requirement';
    subjectId: string;
    taskId?: string;
    requirementId?: string;
    targetProjectId: string;
    targetRepoPath: string;
    status?: string;  // 默认 'draft'
  }): Promise<task_executions> {
    return db.task_executions.create({
      data: {
        execution_id: randomUUID(),
        subject_type: data.subjectType,
        subject_id: data.subjectId,
        task_id: data.taskId,
        requirement_id: data.requirementId,
        target_project_id: data.targetProjectId,
        target_repo_path: data.targetRepoPath,
        status: data.status ?? 'draft',
      },
    });
  },

  /**
   * 根据执行 ID 查询执行实例
   */
  async get(executionId: string): Promise<task_executions | null> {
    return db.task_executions.findUnique({
      where: { execution_id: executionId },
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
    const result = await db.task_executions.updateMany({
      where: {
        execution_id: executionId,
        status: { in: ['pending', 'rate_limited'] },
        worker_id: null,
      },
      data: {
        status: 'running',
        worker_id: workerId,
        lease_token: leaseToken,
        fencing_token: { increment: 1 }, // 防护令牌递增，使旧租约失效
        lease_expires_at: leaseExpiresAt,
        heartbeat_at: new Date(),
        started_at: new Date(),
      },
    });

    // count === 0 表示条件不满足（已被占用或状态不符）
    if (result.count === 0) return null;

    // 回读已更新的记录，返回租约信息
    const execution = await db.task_executions.findUnique({
      where: { execution_id: executionId },
    });
    if (!execution) return null;

    return {
      workerId: execution.worker_id!,
      leaseToken: execution.lease_token!,
      fencingToken: execution.fencing_token,
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
    const result = await db.task_executions.updateMany({
      where: {
        execution_id: executionId,
        worker_id: lease.workerId,
        lease_token: lease.leaseToken,
        fencing_token: lease.fencingToken,
      },
      data: { heartbeat_at: new Date() },
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
    await db.task_executions.updateMany({
      where: {
        execution_id: executionId,
        worker_id: lease.workerId,
        lease_token: lease.leaseToken,
      },
      data: {
        worker_id: null,
        lease_token: null,
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
    await db.task_executions.updateMany({
      where: {
        execution_id: executionId,
        worker_id: lease.workerId,
        lease_token: lease.leaseToken,
      },
      data: {
        worker_id: null,
        lease_token: null,
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
    await db.task_executions.update({
      where: { execution_id: executionId },
      data: {
        status: 'completed',
        final_output: finalOutput,
        completed_at: new Date(),
        worker_id: null,
        lease_token: null,
        lease_expires_at: null,
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
    await db.task_executions.update({
      where: { execution_id: executionId },
      data: {
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date(),
        worker_id: null,
        lease_token: null,
        lease_expires_at: null,
      },
    });
  },

  /**
   * 标记执行失败并同时写入 execution_events
   *
   * 这是推荐的失败标记方法，确保所有失败都有事件记录。
   * 用于替代 fail() 方法，解决"系统里没有记录"的问题。
   *
   * @param executionId 执行实例 ID
   * @param message 错误消息
   * @param details 可选的错误详情（node、visits、errorType）
   */
  async failWithEvent(
    executionId: string,
    message: string,
    details?: { node?: string; visits?: number; errorType?: string }
  ): Promise<void> {
    await db.$transaction([
      // 1. 更新执行实例状态
      db.task_executions.update({
        where: { execution_id: executionId },
        data: {
          status: 'failed',
          error_message: message,
          completed_at: new Date(),
          worker_id: null,
          lease_token: null,
          lease_expires_at: null,
        },
      }),
      // 2. 写入失败事件
      db.execution_events.create({
        data: {
          execution_id: executionId,
          event_type: 'failed',
          from_status: 'running',
          to_status: 'failed',
          message,
          details: details ? JSON.stringify(details) : null,
          created_at: new Date(),
        },
      }),
    ]);
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
    await db.task_executions.update({
      where: { execution_id: executionId },
      data: {
        rate_limit_count: { increment: 1 },
        retry_at: retryAt,
        error_message: errorMessage,
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
  async findZombies(timeoutMinutes: number = 10): Promise<task_executions[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    return db.task_executions.findMany({
      where: {
        status: 'running',
        OR: [
          { heartbeat_at: { lt: cutoff } },  // 心跳超时
          {
            heartbeat_at: null,
            started_at: { lt: cutoff },  // 启动超过 timeoutMinutes 且无心跳
          },
        ],
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
    const result = await db.task_executions.updateMany({
      where: {
        execution_id: executionId,
        status: 'running',
      },
      data: {
        status: 'pending',
        worker_id: null,
        lease_token: null,
        lease_expires_at: null,
        heartbeat_at: null,
      },
    });
    return result.count > 0;
  },

  /**
   * 递增 Agent 调用次数
   *
   * 在 agent-node.mts 每次调用 runLocal() 前调用，
   * 供调度层 budget 检查（checkBudget）读取。
   * 使用 increment 操作保证并发安全。
   */
  async incrementAgentInvocations(executionId: string): Promise<void> {
    await db.task_executions.update({
      where: { execution_id: executionId },
      data: { agent_invocations: { increment: 1 } },
    });
  },
};
