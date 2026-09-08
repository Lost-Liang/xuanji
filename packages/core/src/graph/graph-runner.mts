// packages/core/src/graph/graph-runner.mts
// 流程执行运行时 —— 璇玑 V4 核心
//
// 职责：
// 1. 加载 workflow YAML 或 DB 用户流 → 编译成 LangGraph 图
// 2. invoke() 执行图，每个节点 = agent | command | gate
// 3. 处理 GraphInterrupt（gate 暂停等待人审）
// 4. 支持 resume（从 checkpoint 恢复）
// 5. 心跳 + controlStatus 检查（取消/暂停）
//
// 这是 M1.2 的核心实现，让执行真正按节点跑

import { Command } from '@langchain/langgraph';
import { buildGraphFromDef } from './builder.mjs';
import { loadWorkflowFromYaml, loadWorkflowFromFile, mapYamlToGraphDef } from './yaml-loader.mjs';
import { executionStore } from '../storage/execution-store.mjs';
import { db } from '../db.mjs';
import { randomUUID } from 'node:crypto';
import { HEARTBEAT_INTERVAL_MS } from '../timing-constants.mjs';
import type { GraphDef, WorkflowDef } from './types.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

export interface StartExecutionOpts {
  executionId: string;
  flowId: string;              // workflow id（如 'requirement-decomposition'）
  input: string;               // 输入文本（需求文本/任务描述）
  task?: any;                  // 任务对象（任务执行时传入）
  requirementId?: string;      // 需求 ID（需求执行时传入）
}

export interface ResumeExecutionOpts {
  executionId: string;
  decision: 'approve' | 'reject';
  comments?: string;
}

// ─── 图加载 ────────────────────────────────────────────────────────────────────

/**
 * 加载流程定义
 * - preset: 从 workflows/*.yaml 加载
 * - user: 从 DB graph_definitions 加载
 * 返回 { yamlContent, graphDef } 或 null
 */
export async function loadFlow(flowId: string): Promise<{ yamlContent: string; graphDef: GraphDef } | null> {
  // 先尝试作为 preset 加载
  const presetPath = join(process.cwd(), 'workflows', `${flowId}.yaml`);
  if (existsSync(presetPath)) {
    try {
      const yamlContent = readFileSync(presetPath, 'utf-8');
      const workflowDef = loadWorkflowFromYaml(yamlContent);
      const graphDef = mapYamlToGraphDef(workflowDef);
      return { yamlContent, graphDef };
    } catch (err) {
      console.warn(`[graph-runner] 加载 preset 失败: ${flowId}`, err);
    }
  }

  // 从 DB 加载用户流
  try {
    const row = await db.graphDefinition.findUnique({
      where: { id: flowId },
    });
    if (row?.definitionJson) {
      // 用户流没有 YAML，构造一个 YAML 字符串供 buildGraphFromDef 使用
      // 这里简化处理，实际需要将 definitionJson 转回 YAML
      // TODO: 支持 DB 用户流执行
      console.warn(`[graph-runner] DB 用户流执行暂不支持: ${flowId}`);
      return null;
    }
  } catch {
    // ignore
  }

  console.warn(`[graph-runner] 流程定义不存在: ${flowId}`);
  return null;
}

// ─── 状态检查辅助函数 ────────────────────────────────────────────────────────

/**
 * 检查执行是否有待回答的问题
 */
async function checkPendingQuestions(executionId: string): Promise<boolean> {
  const count = await db.inboxQuestion.count({
    where: { executionId, status: 'pending' },
  });
  return count > 0;
}

// ─── 执行引擎 ──────────────────────────────────────────────────────────────────

/**
 * 启动流程执行
 *
 * 流程：
 * 1. 加载流程定义 → 编译成 LangGraph 图
 * 2. 创建 thread_id（checkpoint key）
 * 3. 初始化 state
 * 4. invoke() 执行图
 * 5. 处理中断（gate）
 * 6. 完成后回调
 */
export async function startExecution(opts: StartExecutionOpts): Promise<void> {
  const { executionId, flowId, input, task, requirementId } = opts;

  console.log(`[graph-runner] 启动执行: ${executionId}, 流程: ${flowId}`);

  // 1. 加载流程定义
  const flow = await loadFlow(flowId);
  if (!flow) {
    await executionStore.fail(executionId, `流程定义不存在: ${flowId}`);
    return;
  }

  // 2. 更新执行记录：设置 graphDefinitionId
  const threadId = randomUUID();
  await db.taskExecution.update({
    where: { executionId },
    data: {
      graphDefinitionId: flowId,
      threadId,
      status: 'running',
      startedAt: new Date(),
    },
  });

  // 3. 编译成 LangGraph 图
  let graph: ReturnType<typeof buildGraphFromDef>;
  try {
    graph = buildGraphFromDef(flow.yamlContent);
  } catch (err) {
    console.error(`[graph-runner] 编译图失败:`, err);
    await executionStore.fail(executionId, `编译流程图失败: ${(err as Error).message}`);
    return;
  }

  // 4. 初始化 state
  const initialState: Record<string, any> = {
    input,
    task: task || null,
    requirement_id: requirementId || null,
  };

  // 5. 启动心跳循环
  const WORKER_ID = 'graph-runner';
  let cancelled = false;

  const heartbeatInterval = setInterval(async () => {
    try {
      const exec = await db.taskExecution.findUnique({
        where: { executionId },
        select: { leaseToken: true, controlStatus: true },
      });

      if (!exec || exec.leaseToken !== WORKER_ID) {
        console.warn(`[graph-runner] 租约已失效: ${executionId}`);
        cancelled = true;
        return;
      }

      // 续约
      await db.taskExecution.update({
        where: { executionId },
        data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
      });

      // 检查控制状态
      if (exec.controlStatus === 'cancel_requested') {
        console.log(`[graph-runner] 收到取消请求: ${executionId}`);
        cancelled = true;
      }
    } catch (err) {
      console.error(`[graph-runner] 心跳循环出错:`, err);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref();

  // 获取租约
  await db.taskExecution.update({
    where: { executionId },
    data: {
      leaseToken: WORKER_ID,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });

  try {
    // 6. 执行图
    const config = {
      configurable: {
        thread_id: threadId,
        execution_id: executionId,
        exec_shortid: executionId.slice(0, 8),
      },
    };

    const result = await graph.invoke(initialState, config);

    // 7. 检查是否被取消
    if (cancelled) {
      await executionStore.fail(executionId, '执行已被取消');
      return;
    }

    // 8. 执行完成
    console.log(`[graph-runner] 执行完成: ${executionId}`);

    // 根据流程类型执行完成回调
    await onFlowComplete(flowId, executionId, result, requirementId);

    // 在标记完成前检查是否有 pending 问题
    if (await checkPendingQuestions(executionId)) {
      // 有待回答的问题，不标记为 completed
      await db.taskExecution.update({
        where: { executionId },
        data: { status: 'waiting' },
      });
      console.log(`[graph-runner] 执行 ${executionId} 有待回答问题，状态更新为 waiting`);
    } else {
      await executionStore.complete(executionId, '流程执行完成');
    }

  } catch (err: any) {
    // 检查是否为 gate 中断
    if (err?.name === 'GraphInterrupt') {
      console.log(`[graph-runner] Gate 中断，等待人工审核: ${executionId}`);

      // 更新状态为 paused
      await db.taskExecution.update({
        where: { executionId },
        data: {
          status: 'paused',
          stage: err.nodeId || 'gate',
        },
      });

      // 创建 inbox_question 供 Dashboard 展示
      await db.inboxQuestion.create({
        data: {
          id: randomUUID(),
          executionId,
          body: '请审核当前阶段的输出',
          choices: JSON.stringify({ flowId, nodeId: err.nodeId }),
          status: 'pending',
          createdAt: new Date(),
        },
      });

      return;
    }

    // 其他错误
    console.error(`[graph-runner] 执行出错:`, err);
    await executionStore.fail(executionId, err?.message || '执行失败');
  } finally {
    clearInterval(heartbeatInterval);
  }
}

/**
 * 恢复执行（gate 通过后）
 */
export async function resumeExecution(opts: ResumeExecutionOpts): Promise<void> {
  const { executionId, decision, comments } = opts;

  console.log(`[graph-runner] 恢复执行: ${executionId}, decision: ${decision}`);

  // 1. 获取执行记录
  const exec = await db.taskExecution.findUnique({
    where: { executionId },
    select: { threadId: true, graphDefinitionId: true, status: true },
  });

  if (!exec || !exec.threadId || !exec.graphDefinitionId) {
    throw new Error('执行记录不存在或状态不正确');
  }

  if (exec.status !== 'paused') {
    throw new Error(`执行状态不是 paused，当前: ${exec.status}`);
  }

  // 2. 更新状态为 running
  await db.taskExecution.update({
    where: { executionId },
    data: { status: 'running' },
  });

  // 3. 加载流程图
  const flow = await loadFlow(exec.graphDefinitionId);
  if (!flow) {
    await executionStore.fail(executionId, `流程定义不存在: ${exec.graphDefinitionId}`);
    return;
  }

  const graph = buildGraphFromDef(flow.yamlContent);

  // 4. 构建恢复命令
  const resumeCommand = new Command({
    resume: { decision, comments },
  });

  // 5. 继续执行
  const config = {
    configurable: {
      thread_id: exec.threadId,
      execution_id: executionId,
      exec_shortid: executionId.slice(0, 8),
    },
  };

  try {
    const result = await graph.invoke(resumeCommand, config);

    // 执行完成
    console.log(`[graph-runner] 恢复执行完成: ${executionId}`);
    await executionStore.complete(executionId, '流程执行完成');

  } catch (err: any) {
    // 再次遇到 gate 中断
    if (err?.name === 'GraphInterrupt') {
      console.log(`[graph-runner] 再次遇到 Gate 中断: ${executionId}`);
      await db.taskExecution.update({
        where: { executionId },
        data: {
          status: 'paused',
          stage: err.nodeId || 'gate',
        },
      });
      return;
    }

    console.error(`[graph-runner] 恢复执行出错:`, err);
    await executionStore.fail(executionId, err?.message || '执行失败');
  }
}

// ─── 完成回调 ──────────────────────────────────────────────────────────────────

/**
 * 流程完成后的回调
 * - requirement-decomposition: 创建任务树
 * - default-dev-flow: 不需要额外处理
 */
async function onFlowComplete(
  flowId: string,
  executionId: string,
  result: Record<string, any>,
  requirementId?: string,
): Promise<void> {
  if (flowId === 'requirement-decomposition' && requirementId) {
    // 从 result 中提取任务树
    const spec = result.spec || '';
    const tasks = result.tasks || [];

    if (tasks.length > 0) {
      console.log(`[graph-runner] 创建任务树，收到 ${tasks.length} 个解析结果`);

      // 解析任务树格式并创建记录
      await createTaskTreeFromBreakdown(requirementId, executionId, tasks);
    } else {
      console.warn(`[graph-runner] 没有任务数据，尝试从 phase_outputs 读取`);
      // 回退：从 phase_outputs 读取
      await createTaskTreeFromPhaseOutputs(requirementId, executionId);
    }
  }
}

/**
 * 从 phase_outputs 表读取任务数据并创建任务树
 */
async function createTaskTreeFromPhaseOutputs(
  requirementId: string,
  executionId: string,
): Promise<void> {
  const requirement = await db.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return;

  // 查找 task_breakdown 节点的输出
  const phaseOutput = await db.phaseOutput.findFirst({
    where: {
      key: 'tasks',
      phaseInstance: {
        executionId,
        phaseId: 'task_breakdown',
      },
    },
  });

  if (!phaseOutput?.value) {
    console.warn(`[graph-runner] 未找到 task_breakdown 的输出`);
    return;
  }

  // 解析 JSON
  let parsed: any = null;
  const output = phaseOutput.value;

  // 尝试从 markdown 代码块提取
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error(`[graph-runner] JSON 解析失败:`, e);
      return;
    }
  }

  if (!parsed) {
    console.warn(`[graph-runner] 无法解析任务数据`);
    return;
  }

  await createTaskTreeFromParsed(requirement, parsed);
}

/**
 * 从解析后的数据创建任务树
 */
async function createTaskTreeFromParsed(
  requirement: any,
  parsed: any,
): Promise<void> {
  const { user_stories = [], tasks = [] } = parsed;

  // 1. 提取并创建 Epics
  const epicMap = new Map<string, string>(); // 临时ID -> 真实ID
  const epics = new Map<string, any>();

  // 从 user_stories 提取 epics
  for (const us of user_stories) {
    if (us.epic_id && !epics.has(us.epic_id)) {
      epics.set(us.epic_id, { id: us.epic_id, module: us.module });
    }
  }

  // 创建 Epics
  for (const [tempId, epicData] of epics) {
    const epicId = randomUUID();
    epicMap.set(tempId, epicId);

    await db.epic.create({
      data: {
        id: epicId,
        requirementId: requirement.id,
        title: epicData.module || `Epic ${tempId}`,
        status: 'pending',
      },
    });
  }

  // 2. 提取并创建 Features
  const featureMap = new Map<string, string>();
  const features = new Map<string, any>();

  for (const us of user_stories) {
    if (us.feature_id && !features.has(us.feature_id)) {
      features.set(us.feature_id, { id: us.feature_id, epic_id: us.epic_id });
    }
  }

  for (const [tempId, featureData] of features) {
    const featureId = randomUUID();
    featureMap.set(tempId, featureId);

    const epicRealId = epicMap.get(featureData.epic_id);

    await db.feature.create({
      data: {
        id: featureId,
        epicId: epicRealId || null,
        title: `Feature ${tempId}`,
        status: 'pending',
      },
    });
  }

  // 3. 创建 User Stories 和 Tasks
  let taskSequence = 0;

  for (const us of user_stories) {
    const usId = randomUUID();
    const epicRealId = epicMap.get(us.epic_id);
    const featureRealId = featureMap.get(us.feature_id);

    await db.userStory.create({
      data: {
        id: usId,
        epicId: epicRealId || null,
        featureId: featureRealId || null,
        title: us.title || '',
        asA: us.as_a || null,
        iWant: us.i_want || null,
        soThat: us.so_that || null,
        acceptanceText: us.acceptance_text || null,
        priority: us.priority || 'P2',
        status: 'pending',
      },
    });

    // 创建该 user story 下的 tasks
    if (us.tasks && Array.isArray(us.tasks)) {
      for (const taskData of us.tasks) {
        if (!taskData.title) continue;

        taskSequence++;
        const taskId = randomUUID();

        await db.task.create({
          data: {
            id: taskId,
            userStoryId: usId,
            epicId: epicRealId || null,
            title: taskData.title,
            description: taskData.description || null,
            acceptanceCriteria: taskData.acceptance_criteria || null,
            techConstraints: taskData.tech_constraints || null,
            taskType: taskData.task_type || null,
            estimatedHours: taskData.estimated_hours || null,
            targetProjectId: requirement.targetProjectId,
            targetRepoPath: requirement.targetRepoPath,
            sequence: taskSequence,
            status: 'pending',
          },
        });

        // 创建任务执行实例
        await executionStore.create({
          subjectType: 'task',
          subjectId: taskId,
          taskId,
          requirementId: requirement.id,
          targetProjectId: requirement.targetProjectId,
          targetRepoPath: requirement.targetRepoPath,
        });
      }
    }
  }

  // 4. 创建顶级 tasks（不属于任何 user story）
  for (const taskData of tasks) {
    if (!taskData.title) continue;

    taskSequence++;
    const taskId = randomUUID();

    // 尝试找到关联的 epic
    const epicRealId = taskData.epic_id ? epicMap.get(taskData.epic_id) : null;

    await db.task.create({
      data: {
        id: taskId,
        epicId: epicRealId || null,
        title: taskData.title,
        description: taskData.description || null,
        acceptanceCriteria: taskData.acceptance_criteria || null,
        techConstraints: taskData.tech_constraints || null,
        taskType: taskData.task_type || null,
        estimatedHours: taskData.estimated_hours || null,
        targetProjectId: requirement.targetProjectId,
        targetRepoPath: requirement.targetRepoPath,
        sequence: taskSequence,
        status: 'pending',
      },
    });

    // 创建任务执行实例
    await executionStore.create({
      subjectType: 'task',
      subjectId: taskId,
      taskId,
      requirementId: requirement.id,
      targetProjectId: requirement.targetProjectId,
      targetRepoPath: requirement.targetRepoPath,
    });
  }

  console.log(`[graph-runner] 创建了 ${epicMap.size} 个 Epic, ${featureMap.size} 个 Feature, ${user_stories.length} 个 UserStory, ${taskSequence} 个 Task`);
}

/**
 * 从 breakdown 结果创建任务树
 */
async function createTaskTreeFromBreakdown(
  requirementId: string,
  requirementExecutionId: string,
  tasksData: any[],
): Promise<void> {
  const requirement = await db.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return;

  // tasksData 现在是 [{ user_stories: [...], tasks: [...] }]
  for (const data of tasksData) {
    if (data.user_stories || data.tasks) {
      await createTaskTreeFromParsed(requirement, data);
    }
  }
}

// ─── 导出单例接口 ──────────────────────────────────────────────────────────────

export const graphRunner = {
  startExecution,
  resumeExecution,
  loadFlow,
};