// packages/core/src/storage/task-store.mts
// 任务 CRUD 操作 —— 璇玑 V4 Storage 层

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { Task } from '@prisma/client';

export const taskStore = {
  /**
   * 创建新任务
   */
  async create(data: {
    title: string;
    description?: string;
    userStoryId?: string;
    epicId?: string;
    parentTaskId?: string;
    targetProjectId: string;
    targetRepoPath: string;
    acceptanceCriteria?: string;
    sequence?: number;
  }): Promise<Task> {
    return db.task.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    });
  },

  /**
   * 根据 ID 查询任务
   */
  async getById(id: string): Promise<Task | null> {
    return db.task.findUnique({ where: { id } });
  },

  /**
   * 更新任务状态（自动维护 startedAt / completedAt 时间戳）
   */
  async updateStatus(id: string, status: string): Promise<Task> {
    return db.task.update({
      where: { id },
      data: {
        status,
        // 状态变为 running 时记录开始时间
        ...(status === 'running' ? { startedAt: new Date() } : {}),
        // 状态变为终态时记录完成时间
        ...(status === 'completed' || status === 'failed'
          ? { completedAt: new Date() }
          : {}),
      },
    });
  },

  /**
   * 获取下一个待执行任务（按 sequence 升序）
   * 可选传入 sequenceAfter 跳过已调度的序号
   */
  async getNextPending(sequenceAfter?: number): Promise<Task | null> {
    return db.task.findFirst({
      where: {
        status: 'pending',
        ...(sequenceAfter !== undefined
          ? { sequence: { gt: sequenceAfter } }
          : {}),
      },
      orderBy: { sequence: 'asc' },
    });
  },

  /**
   * 列出某需求下所有任务（通过 epic 或 userStory 关联）
   */
  async listByRequirement(requirementId: string): Promise<Task[]> {
    return db.task.findMany({
      where: {
        OR: [
          { epic: { requirementId } },
          { userStory: { epic: { requirementId } } },
        ],
      },
      orderBy: { sequence: 'asc' },
    });
  },
};
