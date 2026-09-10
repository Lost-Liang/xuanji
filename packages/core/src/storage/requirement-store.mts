// packages/core/src/storage/requirement-store.mts
// 需求 CRUD 操作 —— 璇玑 V4 Storage 层

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { requirements } from '@prisma/client';

export const requirementStore = {
  /**
   * 创建新需求
   */
  async create(data: {
    title: string;
    description?: string;
    targetProjectId: string;
    targetRepoPath: string;
  }): Promise<requirements> {
    return db.requirements.create({
      data: {
        id: randomUUID(),
        title: data.title,
        description: data.description,
        target_project_id: data.targetProjectId,
        target_repo_path: data.targetRepoPath,
        status: 'pending',
      },
    });
  },

  /**
   * 根据 ID 查询需求
   */
  async getById(id: string): Promise<requirements | null> {
    return db.requirements.findUnique({ where: { id } });
  },

  /**
   * 列出所有需求（按创建时间降序）
   */
  async list(): Promise<requirements[]> {
    return db.requirements.findMany({
      orderBy: { created_at: 'desc' },
    });
  },

  /**
   * 更新需求状态
   */
  async updateStatus(id: string, status: string): Promise<requirements> {
    return db.requirements.update({
      where: { id },
      data: { status },
    });
  },
};