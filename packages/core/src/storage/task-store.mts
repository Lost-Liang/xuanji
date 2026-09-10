// packages/core/src/storage/task-store.mts
// 任务 CRUD 操作 —— 璇玑 V4 Storage 层

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { tasks } from '@prisma/client';

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
    acceptanceSteps?: string[];
    techConstraints?: any;
    sequence?: number;
    estimatedHours?: number;
    taskType?: string;
    priority?: string;
  }): Promise<tasks> {
    return db.tasks.create({
      data: {
        id: randomUUID(),
        title: data.title,
        description: data.description,
        user_story_id: data.userStoryId,
        epic_id: data.epicId,
        parent_task_id: data.parentTaskId,
        target_project_id: data.targetProjectId,
        target_repo_path: data.targetRepoPath,
        acceptance_criteria: data.acceptanceCriteria,
        acceptance_steps: data.acceptanceSteps,
        tech_constraints: data.techConstraints,
        sequence: data.sequence ?? 0,
        estimated_hours: data.estimatedHours,
        task_type: data.taskType,
        priority: data.priority,
        status: 'draft',
      },
    });
  },

  /**
   * 根据 ID 查询任务
   */
  async getById(id: string): Promise<tasks | null> {
    return db.tasks.findUnique({ where: { id } });
  },

  /**
   * 更新任务状态（自动维护 started_at / completed_at 时间戳）
   */
  async updateStatus(id: string, status: string): Promise<tasks> {
    return db.tasks.update({
      where: { id },
      data: {
        status,
        // 状态变为 running 时记录开始时间
        ...(status === 'running' ? { started_at: new Date() } : {}),
        // 状态变为终态时记录完成时间
        ...(status === 'completed' || status === 'failed'
          ? { completed_at: new Date() }
          : {}),
      },
    });
  },

  /**
   * 获取下一个待执行任务（按 sequence 升序）
   * 可选传入 sequenceAfter 跳过已调度的序号
   */
  async getNextPending(sequenceAfter?: number): Promise<tasks | null> {
    return db.tasks.findFirst({
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
   * 列出某需求下所有任务（通过 epic 或 user_story 关联）
   */
  async listByRequirement(requirementId: string): Promise<tasks[]> {
    return db.tasks.findMany({
      where: {
        OR: [
          { epics: { requirement_id: requirementId } },
          { user_stories: { epics: { requirement_id: requirementId } } },
        ],
      },
      orderBy: { sequence: 'asc' },
    });
  },
};
