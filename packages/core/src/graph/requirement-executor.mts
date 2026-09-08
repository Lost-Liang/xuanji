// packages/core/src/graph/requirement-executor.mts
// 需求执行器 —— 璇玑 V4
//
// 职责：
// 1. 获取执行实例的 CAS 租约
// 2. 调用 runLocal() 让 Agent 分析需求并拆分任务
// 3. 解析 Agent 输出 → 创建 Epic/Feature/UserStory/Task 记录
// 4. 为每个 Task 创建 TaskExecution（status='pending'）
// 5. 完成需求执行
//
// 与 worker-graph.mts 的关系：
// - worker-graph.mts 执行单个任务（task 级别）
// - requirement-executor.mts 执行需求分析（requirement 级别）
// - 两者共享 runLocal + conversationStore + handleInboxAsk
// - 需求执行器创建任务后，由 scheduler-graph 拾取执行

import { randomUUID } from 'node:crypto';
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import { executionStore } from '../storage/execution-store.mjs';
import { conversationStore } from '../storage/conversation-store.mjs';
import { mapAdapterEvent, handleInboxAsk } from './shared-agent-utils.mjs';
import { buildRequirementAnalysisPrompt } from './requirement-prompts.mjs';
import { HEARTBEAT_INTERVAL_MS } from '../timing-constants.mjs';
import type { LeaseInfo } from '../storage/execution-store.mjs';
import { db } from '../db.mjs';
import { Prisma } from '@prisma/client';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** Worker 标识（与 worker-graph.mts 共享） */
const WORKER_ID = 'worker-1';

// ─── 核心函数 ──────────────────────────────────────────────────────────────────

/**
 * 执行需求分析
 *
 * 完整流程：
 * 1. 获取 CAS 租约
 * 2. 调用 Claude CLI 分析需求
 * 3. 解析输出 JSON
 * 4. 创建 Epic/Feature/UserStory/Task 记录
 * 5. 为每个 Task 创建 TaskExecution
 * 6. 标记需求执行完成
 *
 * @param executionId - 需求级 TaskExecution 的 ID
 * @param requirementId - 需求的 ID
 * @param inputText - 需求文本
 * @param targetRepoPath - 目标仓库路径
 */
export async function executeRequirement(
  executionId: string,
  requirementId: string,
  inputText: string,
  targetRepoPath: string,
): Promise<void> {
  console.log(`[requirement-executor] 开始执行需求分析: ${executionId}`);

  // 1. 获取 CAS 租约
  const lease = await executionStore.acquireLease(executionId, WORKER_ID);
  if (!lease) {
    console.warn(`[requirement-executor] 获取租约失败（可能已被其他 worker 拾取）: ${executionId}`);
    return;
  }

  // 用于取消的 AbortController
  const abortController = new AbortController();
  let currentSessionId: string | null = null;
  let cancelled = false;

  // 2. 启动心跳循环
  const heartbeatInterval = setInterval(async () => {
    try {
      const ok = await executionStore.renewHeartbeat(executionId, lease);
      if (!ok) {
        console.warn(`[requirement-executor] 心跳续约失败（租约可能已失效）: ${executionId}`);
        abortController.abort();
        return;
      }

      // 检查 controlStatus（暂停/取消请求）
      const exec = await db.taskExecution.findUnique({
        where: { executionId },
        select: { controlStatus: true },
      });
      if (exec?.controlStatus === 'cancel_requested') {
        console.log(`[requirement-executor] 收到取消请求: ${executionId}`);
        abortController.abort();
        cancelled = true;
      }
    } catch (err) {
      console.error(`[requirement-executor] 心跳循环出错:`, err);
    }
  }, HEARTBEAT_INTERVAL_MS);
  // 不阻塞进程退出
  heartbeatInterval.unref();

  try {
    // 3. 构建 prompt
    const prompt = buildRequirementAnalysisPrompt(inputText);

    // 4. 调用 runLocal()
    console.log(`[requirement-executor] 调用 Claude CLI 分析需求...`);

    const result = await runLocal({
      provider: 'claude',
      prompt,
      workDir: targetRepoPath,
      executionId,
      abortSignal: abortController.signal,
      onEvent: async (event: AdapterEvent) => {
        // 提取 sessionId
        if (event.type === 'system' && event.subtype === 'init' && event.sessionId) {
          currentSessionId = event.sessionId;
        }
        // 保存对话事件
        try {
          const mapped = mapAdapterEvent(event);
          await conversationStore.saveEvent({
            executionId,
            sessionId: currentSessionId ?? undefined,
            eventType: mapped.eventType,
            role: mapped.role,
            payload: mapped.payload,
          });
        } catch (err) {
          console.warn('[requirement-executor] 保存对话事件失败:', err);
        }
      },
      onInboxAsk: (question) => handleInboxAsk(executionId, currentSessionId, question),
    });

    // 5. 检查是否被取消
    if (cancelled) {
      await executionStore.fail(executionId, '执行已被取消');
      return;
    }

    // 6. 保存 sessionId
    if (currentSessionId) {
      await db.taskExecution.update({
        where: { executionId },
        data: { sessionId: currentSessionId },
      });
    }

    // 7. 检查结果
    if (!result.success) {
      const errorMsg = result.error || 'Agent 执行失败（未知错误）';
      await executionStore.fail(executionId, errorMsg);
      console.error(`[requirement-executor] Agent 执行失败: ${errorMsg}`);
      return;
    }

    // 8. 解析输出 JSON → 创建任务树
    const output = result.finalOutput || '';
    console.log(`[requirement-executor] Agent 分析完成，输出长度: ${output.length}`);

    const parsed = parseRequirementOutput(output);
    await createTaskTree(requirementId, executionId, parsed, targetRepoPath);

    // 9. 完成需求执行
    const summary = `需求分析完成：${parsed.epics.length} 个史诗，${countTasks(parsed)} 个任务`;
    await executionStore.complete(executionId, summary);
    console.log(`[requirement-executor] ${summary}`);

  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[requirement-executor] 执行异常:`, err);

    // 检查是否为限流错误
    if (isRateLimitError(errorMsg) && lease) {
      const retryCount = await getRetryCount(executionId);
      if (retryCount < 4) {
        const retryAt = computeRetryAt(retryCount);
        await executionStore.setRateLimited(executionId, retryAt, errorMsg);
        await executionStore.releaseLeaseKeepStatus(executionId, lease);
        console.log(`[requirement-executor] 限流，${retryAt} 后重试（第 ${retryCount + 1} 次）`);
        return;
      }
    }

    await executionStore.fail(executionId, errorMsg);
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// ─── 输出解析 ──────────────────────────────────────────────────────────────────

interface ParsedRequirement {
  spec: string;
  epics: ParsedEpic[];
}

interface ParsedEpic {
  title: string;
  description?: string;
  module?: string;
  features: ParsedFeature[];
}

interface ParsedFeature {
  title: string;
  description?: string;
  user_stories: ParsedUserStory[];
}

interface ParsedUserStory {
  title: string;
  as_a?: string;
  i_want?: string;
  so_that?: string;
  acceptance_text?: string;
  tasks: ParsedTask[];
}

interface ParsedTask {
  title: string;
  description?: string;
  acceptance_criteria?: string;
}

/**
 * 解析 Agent 输出的 JSON
 *
 * 容错策略：
 * 1. 直接 JSON.parse
 * 2. 提取 ```json ... ``` 代码块
 * 3. 提取 { ... } 部分
 * 4. 回退到默认单任务
 */
function parseRequirementOutput(output: string): ParsedRequirement {
  // 尝试 1：直接解析
  try {
    const parsed = JSON.parse(output.trim());
    return normalizeRequirement(parsed);
  } catch { /* continue */ }

  // 尝试 2：提取 markdown 代码块
  const codeBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      return normalizeRequirement(parsed);
    } catch { /* continue */ }
  }

  // 尝试 3：提取 JSON 对象
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeRequirement(parsed);
    } catch { /* continue */ }
  }

  // 回退：默认单任务
  console.warn('[requirement-executor] 无法解析 Agent 输出，使用默认单任务');
  return {
    spec: output.substring(0, 500) || '需求分析输出无法解析',
    epics: [{
      title: '执行需求',
      description: '自动创建的默认史诗',
      module: 'default',
      features: [{
        title: '需求实现',
        description: '自动创建的默认特性',
        user_stories: [{
          title: '实现需求',
          as_a: '开发者',
          i_want: '实现需求功能',
          so_that: '满足用户需求',
          acceptance_text: '需求已实现并通过验证',
          tasks: [{
            title: '执行需求',
            description: output.substring(0, 1000) || '请根据需求描述执行开发任务',
            acceptance_criteria: '需求功能已实现',
          }],
        }],
      }],
    }],
  };
}

/**
 * 规范化需求结构（补全缺失字段）
 */
function normalizeRequirement(raw: any): ParsedRequirement {
  const spec = typeof raw.spec === 'string' ? raw.spec : '需求规格未提供';
  const epics = Array.isArray(raw.epics) ? raw.epics : [];

  return {
    spec,
    epics: epics.map((epic: any) => ({
      title: epic.title || '未命名史诗',
      description: epic.description || '',
      module: epic.module || null,
      features: Array.isArray(epic.features) ? epic.features.map((feat: any) => ({
        title: feat.title || '未命名特性',
        description: feat.description || '',
        user_stories: Array.isArray(feat.user_stories) ? feat.user_stories.map((us: any) => ({
          title: us.title || '未命名用户故事',
          as_a: us.as_a || '',
          i_want: us.i_want || '',
          so_that: us.so_that || '',
          acceptance_text: us.acceptance_text || '',
          tasks: Array.isArray(us.tasks) ? us.tasks.map((task: any) => ({
            title: task.title || '未命名任务',
            description: task.description || '',
            acceptance_criteria: task.acceptance_criteria || '',
          })) : [],
        })) : [],
      })) : [],
    })),
  };
}

/**
 * 计算任务总数
 */
function countTasks(req: ParsedRequirement): number {
  let count = 0;
  for (const epic of req.epics) {
    for (const feature of epic.features) {
      for (const us of feature.user_stories) {
        count += us.tasks.length;
      }
    }
  }
  return count;
}

// ─── 任务树创建 ────────────────────────────────────────────────────────────────

/**
 * 创建 Epic/Feature/UserStory/Task 记录 + TaskExecution
 */
async function createTaskTree(
  requirementId: string,
  requirementExecutionId: string,
  parsed: ParsedRequirement,
  targetRepoPath: string,
): Promise<void> {
  // 获取需求信息
  const requirement = await db.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) {
    throw new Error(`需求不存在: ${requirementId}`);
  }

  // 更新需求描述为 spec
  await db.requirement.update({
    where: { id: requirementId },
    data: { description: parsed.spec },
  });

  let taskSequence = 0;

  for (const epic of parsed.epics) {
    const epicId = randomUUID();
    await db.epic.create({
      data: {
        id: epicId,
        requirementId,
        title: epic.title,
        description: epic.description || null,
        module: epic.module || null,
        status: 'pending',
      },
    });

    for (const feature of epic.features) {
      const featureId = randomUUID();
      await db.feature.create({
        data: {
          id: featureId,
          epicId,
          title: feature.title,
          description: feature.description || null,
          status: 'pending',
        },
      });

      for (const us of feature.user_stories) {
        const userStoryId = randomUUID();
        await db.userStory.create({
          data: {
            id: userStoryId,
            epicId,
            featureId,
            title: us.title,
            asA: us.as_a || null,
            iWant: us.i_want || null,
            soThat: us.so_that || null,
            acceptanceText: us.acceptance_text || null,
            status: 'pending',
          },
        });

        for (const task of us.tasks) {
          taskSequence++;
          const taskId = randomUUID();
          await db.task.create({
            data: {
              id: taskId,
              userStoryId,
              epicId,
              title: task.title,
              description: task.description || null,
              acceptanceCriteria: task.acceptance_criteria || null,
              status: 'pending',
              targetProjectId: requirement.targetProjectId,
              targetRepoPath,
              sequence: taskSequence,
            },
          });

          // 为该任务创建执行实例
          const execution = await executionStore.create({
            subjectType: 'task',
            subjectId: taskId,
            taskId,
            requirementId,
            targetProjectId: requirement.targetProjectId,
            targetRepoPath,
          });

          console.log(`[requirement-executor] 创建任务执行: ${execution.executionId} → ${task.title}`);
        }
      }
    }
  }

  console.log(`[requirement-executor] 任务树创建完成: ${parsed.epics.length} epics, ${taskSequence} tasks`);
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return ['429', 'rate_limit', 'rate limit', 'throttl', 'too many requests'].some(
    keyword => lower.includes(keyword),
  );
}

async function getRetryCount(executionId: string): Promise<number> {
  const exec = await db.taskExecution.findUnique({
    where: { executionId },
    select: { rateLimitCount: true },
  });
  return exec?.rateLimitCount ?? 0;
}

/**
 * 计算重试时间（5m → 10m → 30m → 60m）
 */
function computeRetryAt(retryCount: number): Date {
  const delays = [5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000];
  const delay = delays[Math.min(retryCount, delays.length - 1)];
  return new Date(Date.now() + delay);
}
