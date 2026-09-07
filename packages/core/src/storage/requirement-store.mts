// packages/core/src/storage/requirement-store.mts
// 需求 CRUD 操作 —— 璇玑 V4 Storage 层

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { Requirement } from '@prisma/client';

export const requirementStore = {
  /**
   * 创建新需求
   */
  async create(data: {
    title: string;
    description?: string;
    targetProjectId: string;
    targetRepoPath: string;
  }): Promise<Requirement> {
    return db.requirement.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    });
  },

  /**
   * 根据 ID 查询需求
   */
  async getById(id: string): Promise<Requirement | null> {
    return db.requirement.findUnique({ where: { id } });
  },

  /**
   * 列出所有需求（按创建时间降序）
   */
  async list(): Promise<Requirement[]> {
    return db.requirement.findMany({
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * 更新需求状态
   */
  async updateStatus(id: string, status: string): Promise<Requirement> {
    return db.requirement.update({
      where: { id },
      data: { status },
    });
  },
};
