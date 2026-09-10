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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { HEARTBEAT_INTERVAL_MS } from '../timing-constants.mjs';
import type { GraphDef, WorkflowDef } from './types.mjs';

// 获取当前文件所在目录（ESM 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// workflows 目录相对于当前文件的位置（src/graph -> ../../workflows）
const WORKFLOWS_DIR = join(__dirname, '../../workflows');

// ─── 全局状态 ────────────────────────────────────────────────────────────────

// A4: 维护 executionId → AbortController 映射，供取消响应使用
const activeAbortControllers = new Map<string, AbortController>();

/**
 * 获取指定执行的 AbortController（用于外部取消）
 */
export function getAbortController(executionId: string): AbortController | undefined {
  return activeAbortControllers.get(executionId);
}

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
  const presetPath = join(WORKFLOWS_DIR, `${flowId}.yaml`);
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
    const row = await db.graph_definitions.findUnique({
      where: { id: flowId },
    });
    if (row?.definition_json) {
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
  const count = await db.inbox_questions.count({
    where: { execution_id: executionId, status: 'pending' },
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

  // 0. 获取租约 —— CAS 原子操作（修复 A2: 使用真正的 acquireLease）
  const WORKER_ID = `graph-runner-${executionId.slice(0, 8)}`;
  const lease = await executionStore.acquireLease(executionId, WORKER_ID);
  if (!lease) {
    const errorMsg = `获取租约失败，可能已被其他 worker 抢占或状态不符: ${executionId}`;
    console.warn(`[graph-runner] ${errorMsg}`);
    throw new Error(errorMsg);  // 抛错让调用方处理
  }

  // 1. 加载流程定义
  const flow = await loadFlow(flowId);
  if (!flow) {
    await executionStore.fail(executionId, `流程定义不存在: ${flowId}`);
    return;
  }

  // 2. 设置 graph_definition_id 和 thread_id（acquireLease 已设置 status='running'）
  const threadId = randomUUID();
  await db.task_executions.update({
    where: { execution_id: executionId },
    data: {
      graph_definition_id: flowId,
      thread_id: threadId,
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

  // 5. 启动心跳循环（修复 A2: 使用 renewHeartbeat 续约，更新 heartbeat_at）
  // 修复 A4: 创建 AbortController，支持取消响应
  let cancelled = false;
  let paused = false;
  const abortController = new AbortController();

  // 维护 executionId → AbortController 映射，供外部查询
  activeAbortControllers.set(executionId, abortController);

  const heartbeatInterval = setInterval(async () => {
    try {
      // 续约心跳（更新 heartbeat_at，用于僵尸检测）
      const ok = await executionStore.renewHeartbeat(executionId, lease);
      if (!ok) {
        console.warn(`[graph-runner] 心跳续约失败，租约可能已失效: ${executionId}`);
        cancelled = true;
        return;
      }

      // 检查控制状态
      const exec = await db.task_executions.findUnique({
        where: { execution_id: executionId },
        select: { control_status: true },
      });
      if (exec?.control_status === 'cancel_requested') {
        console.log(`[graph-runner] 收到取消请求，触发 AbortSignal: ${executionId}`);
        cancelled = true;
        abortController.abort();  // A4: 触发取消信号
      } else if (exec?.control_status === 'pause_requested') {
        console.log(`[graph-runner] 收到暂停请求: ${executionId}`);
        paused = true;
        abortController.abort();  // 中断当前执行
      }
    } catch (err) {
      console.error(`[graph-runner] 心跳循环出错:`, err);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref();

  try {
    // 6. 执行图
    const config = {
      configurable: {
        thread_id: threadId,
        execution_id: executionId,
        exec_shortid: executionId.slice(0, 8),
      },
      // A4: 传入 AbortSignal，让 LangGraph 节点可以响应取消
      signal: abortController.signal,
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
      await db.task_executions.update({
        where: { execution_id: executionId },
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
      await db.task_executions.update({
        where: { execution_id: executionId },
        data: {
          status: 'paused',
          stage: err.nodeId || 'gate',
        },
      });

      // 创建 inbox_questions 供 Dashboard 展示
      await db.inbox_questions.create({
        data: {
          id: randomUUID(),
          execution_id: executionId,
          body: '请审核当前阶段的输出',
          choices: JSON.stringify({ flowId, nodeId: err.nodeId }),
          status: 'pending',
          created_at: new Date(),
        },
      });

      return;
    }

    // 检查是否为暂停/取消导致的 abort
    // 从数据库读取 control_status，因为 API 直接触发 abort 时本地变量不会设置
    const execState = await db.task_executions.findUnique({
      where: { execution_id: executionId },
      select: { control_status: true },
    });

    if (execState?.control_status === 'pause_requested' || paused) {
      console.log(`[graph-runner] 执行已暂停: ${executionId}`);
      await db.task_executions.update({
        where: { execution_id: executionId },
        data: {
          status: 'paused',
          control_status: 'paused',
        },
      });
      return;
    }

    if (execState?.control_status === 'cancel_requested' || cancelled) {
      console.log(`[graph-runner] 执行已取消: ${executionId}`);
      await executionStore.fail(executionId, '执行已被用户取消');
      return;
    }

    // 其他错误
    console.error(`[graph-runner] 执行出错:`, err);
    await executionStore.fail(executionId, err?.message || '执行失败');
  } finally {
    clearInterval(heartbeatInterval);
    // A4: 清理 AbortController 映射
    activeAbortControllers.delete(executionId);
  }
}

/**
 * 恢复执行（gate 通过后）
 */
export async function resumeExecution(opts: ResumeExecutionOpts): Promise<void> {
  const { executionId, decision, comments } = opts;

  console.log(`[graph-runner] 恢复执行: ${executionId}, decision: ${decision}`);

  // 1. 获取执行记录
  const exec = await db.task_executions.findUnique({
    where: { execution_id: executionId },
    select: { thread_id: true, graph_definition_id: true, status: true },
  });

  if (!exec || !exec.thread_id || !exec.graph_definition_id) {
    throw new Error('执行记录不存在或状态不正确');
  }

  if (exec.status !== 'paused') {
    throw new Error(`执行状态不是 paused，当前: ${exec.status}`);
  }

  // 2. 更新状态为 running
  await db.task_executions.update({
    where: { execution_id: executionId },
    data: { status: 'running' },
  });

  // 3. 加载流程图
  const flow = await loadFlow(exec.graph_definition_id);
  if (!flow) {
    await executionStore.fail(executionId, `流程定义不存在: ${exec.graph_definition_id}`);
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
      thread_id: exec.thread_id,
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
      await db.task_executions.update({
        where: { execution_id: executionId },
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

/**
 * 安全 JSON 解析辅助函数
 * 解析失败返回 null，不抛出异常
 * 支持从 markdown 代码块中提取 JSON（如 ```json ... ```）
 */
export function safeJsonParse(str: string): any {
  if (!str || typeof str !== 'string') return null;

  // 尝试直接解析
  try {
    return JSON.parse(str);
  } catch {
    // 继续尝试从 markdown 提取
  }

  // 尝试从 markdown 代码块中提取 JSON
  const jsonBlockMatch = str.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // 提取失败，继续尝试其他方式
    }
  }

  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(str.substring(firstBrace, lastBrace + 1));
    } catch {
      // 解析失败
    }
  }

  return null;
}

/**
 * 从 spec 字符串更新 Requirement 的 businessGoal 和 specDoc
 *
 * 设计说明：把 specDoc 写入逻辑放在 onFlowComplete 中，
 * 而不是 createTaskTreeFromParsed 中，避免被 task-planner 的输出覆盖。
 */
export async function updateRequirementFromSpec(
  requirementId: string,
  spec: string | Record<string, any>,
): Promise<void> {
  if (!spec) return;

  const specData = typeof spec === 'string' ? safeJsonParse(spec) : spec;
  if (!specData || typeof specData !== 'object') {
    console.warn(`[graph-runner] spec 解析失败或不是对象，跳过 Requirement 更新`);
    return;
  }

  const specForDoc = { ...specData };
  delete specForDoc.business_goal; // 去重，business_goal 单独存

  await db.requirements.update({
    where: { id: requirementId },
    data: {
      business_goal: specData.business_goal || null,
      spec_doc: JSON.stringify(specForDoc, null, 2),
    },
  });

  console.log(`[graph-runner] 已更新 Requirement.spec_doc 和 business_goal: ${requirementId}`);
}

// ─── 完成回调 ──────────────────────────────────────────────────────────────────

/**
 * 流程完成后的回调
 * - requirement-decomposition: 创建任务树 + 更新 Requirement specDoc/businessGoal
 * - default-dev-flow: 不需要额外处理
 */
async function onFlowComplete(
  flowId: string,
  executionId: string,
  result: Record<string, any>,
  requirementId?: string,
): Promise<void> {
  if (flowId === 'requirement-decomposition' && requirementId) {
    const spec = result.spec || '';
    const tasks = result.tasks || [];

    // 如果 result.spec 存在，更新 Requirement 的 businessGoal 和 specDoc
    if (spec) {
      await updateRequirementFromSpec(requirementId, spec);
    }

    if (tasks.length > 0) {
      console.log(`[graph-runner] 创建任务树，收到 ${tasks.length} 个解析结果`);
      console.log(`[graph-runner] spec length=${spec.length}, spec preview: ${typeof spec === 'string' ? spec.substring(0, 100) : 'object'}`);

      // 解析任务树格式并创建记录（传入 spec，从中读取 epics）
      await createTaskTreeFromBreakdown(requirementId, executionId, tasks, spec);
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
  const requirement = await db.requirements.findUnique({ where: { id: requirementId } });
  if (!requirement) return;

  // 查找 task_breakdown 节点的输出
  const phaseOutput = await db.phase_outputs.findFirst({
    where: {
      key: 'tasks',
      phase_instances: {
        execution_id: executionId,
        phase_id: 'task_breakdown',
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
export async function createTaskTreeFromParsed(
  requirement: any,
  parsed: any,
  specData?: any,  // 新增：接收 spec（requirement-analyst 的输出）
): Promise<void> {
  const { user_stories = [], tasks = [] } = parsed;

  // 1. 提取并创建 Epics
  const epicMap = new Map<string, string>(); // 临时ID -> 真实ID
  const epics = new Map<string, any>();

  // 优先从 specData.epics[] 提取 epics（requirement-analyst 的输出，有完整数据）
  if (specData?.epics && Array.isArray(specData.epics)) {
    for (const epicData of specData.epics) {
      if (epicData.id && !epics.has(epicData.id)) {
        epics.set(epicData.id, epicData);
      }
    }
    console.log(`[createTaskTreeFromParsed] 从 spec 读取了 ${epics.size} 个 epics`);
  }

  // 从 parsed.epics[] 提取 epics（优先，有完整数据）
  if (parsed.epics && Array.isArray(parsed.epics)) {
    for (const epicData of parsed.epics) {
      if (epicData.id && !epics.has(epicData.id)) {
        epics.set(epicData.id, epicData);
      }
    }
  }

  // 从 user_stories 提取 epics（补充/主要来源）
  for (const us of user_stories) {
    if (us.epic_id && !epics.has(us.epic_id)) {
      // 支持多种命名风格: epic_name, epic_title, epicName, epicTitle
      const epicTitle = us.epic_name || us.epic_title || us.epicName || us.epicTitle || requirement.title;
      epics.set(us.epic_id, {
        id: us.epic_id,
        name: epicTitle,
        title: epicTitle,
        module: us.module,
        description: us.epic_description || us.epicDescription,
      });
    } else if (us.epic_id && epics.has(us.epic_id)) {
      // 如果 epic 已存在但没有标题，补充标题
      const existing = epics.get(us.epic_id);
      const epicTitle = us.epic_name || us.epic_title || us.epicName || us.epicTitle || requirement.title;
      if (!existing.name && !existing.title) {
        existing.name = epicTitle;
        existing.title = epicTitle;
      }
    }
  }

  // 创建 Epics
  for (const [tempId, epicData] of epics) {
    const epicId = randomUUID();
    epicMap.set(tempId, epicId);

    // 标题优先级: epicData.name > epicData.title > 需求标题 > Epic ${tempId}
    const epicTitle = epicData.name || epicData.title || requirement.title || `Epic ${tempId}`;

    await db.epics.create({
      data: {
        id: epicId,
        requirement_id: requirement.id,
        title: epicTitle,
        description: epicData.description || null,
        module: epicData.module || null,
        priority: epicData.priority || null,
        acceptance_criteria: epicData.acceptance_criteria || null,
        status: 'pending',
      },
    });
  }

  // 2. 提取并创建 Features
  const featureMap = new Map<string, string>();
  const features = new Map<string, any>();

  // 从 parsed.epics[].features[] 提取 features（优先，有完整数据）
  if (parsed.epics && Array.isArray(parsed.epics)) {
    for (const epicData of parsed.epics) {
      if (epicData.features && Array.isArray(epicData.features)) {
        for (const featureData of epicData.features) {
          if (featureData.id && !features.has(featureData.id)) {
            features.set(featureData.id, { ...featureData, epic_id: epicData.id });
          }
        }
      }
    }
  }

  // 从 user_stories 提取 features（补充/主要来源）
  for (const us of user_stories) {
    // 获取关联的 epic 标题作为备选
    let epicTitleForFallback: string | undefined;
    if (us.epic_id && epics.has(us.epic_id)) {
      const epicData = epics.get(us.epic_id);
      epicTitleForFallback = epicData?.name || epicData?.title;
    }

    if (us.feature_id && !features.has(us.feature_id)) {
      // 支持多种命名风格: feature_name, feature_title, featureName, featureTitle
      // 回退优先级: feature_name > epic 标题 > 需求标题
      const featureTitle = us.feature_name || us.feature_title || us.featureName || us.featureTitle || epicTitleForFallback || requirement.title;
      features.set(us.feature_id, {
        id: us.feature_id,
        epic_id: us.epic_id,
        title: featureTitle,
        name: featureTitle,
        module: us.module,
        description: us.feature_description || us.featureDescription,
      });
    } else if (us.feature_id && features.has(us.feature_id)) {
      // 如果 feature 已存在但没有标题，补充标题
      const existing = features.get(us.feature_id);
      const featureTitle = us.feature_name || us.feature_title || us.featureName || us.featureTitle || epicTitleForFallback || requirement.title;
      if (!existing.title && !existing.name) {
        existing.title = featureTitle;
        existing.name = featureTitle;
      }
    }
  }

  for (const [tempId, featureData] of features) {
    const featureId = randomUUID();
    featureMap.set(tempId, featureId);

    const epicRealId = epicMap.get(featureData.epic_id);

    // 标题优先级: featureData.title > featureData.name > 关联 Epic 标题 > Feature ${tempId}
    // 获取关联的 Epic 标题作为备选
    let fallbackTitle = `Feature ${tempId}`;
    if (featureData.epic_id && epics.has(featureData.epic_id)) {
      const epicData = epics.get(featureData.epic_id);
      if (epicData?.name || epicData?.title) {
        fallbackTitle = epicData.name || epicData.title;
      }
    } else if (requirement.title) {
      fallbackTitle = requirement.title;
    }

    const featureTitle = featureData.title || featureData.name || fallbackTitle;

    await db.features.create({
      data: {
        id: featureId,
        epic_id: epicRealId || null,
        title: featureTitle,
        description: featureData.description || null,
        module: featureData.module || null,
        acceptance_criteria: featureData.acceptance_criteria || null,
        priority: featureData.priority || null,
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

    await db.user_stories.create({
      data: {
        id: usId,
        epic_id: epicRealId || null,
        feature_id: featureRealId || null,
        title: us.title || '',
        as_a: us.as_a || null,
        i_want: us.i_want || null,
        so_that: us.so_that || null,
        acceptance_text: us.acceptance_text || null,
        module: us.module || null,
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

        await db.tasks.create({
          data: {
            id: taskId,
            user_story_id: usId,
            epic_id: epicRealId || null,
            title: taskData.title,
            description: taskData.description || null,
            acceptance_criteria: taskData.acceptance_criteria || null,
            acceptance_steps: taskData.acceptance_steps || null,
            priority: taskData.priority || null,
            tech_constraints: taskData.tech_constraints || null,
            task_type: taskData.task_type || null,
            estimated_hours: taskData.estimated_hours || null,
            target_project_id: requirement.target_project_id,
            target_repo_path: requirement.target_repo_path,
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
          targetProjectId: requirement.target_project_id,
          targetRepoPath: requirement.target_repo_path,
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

    await db.tasks.create({
      data: {
        id: taskId,
        epic_id: epicRealId || null,
        title: taskData.title,
        description: taskData.description || null,
        acceptance_criteria: taskData.acceptance_criteria || null,
        acceptance_steps: taskData.acceptance_steps || null,
        priority: taskData.priority || null,
        tech_constraints: taskData.tech_constraints || null,
        task_type: taskData.task_type || null,
        estimated_hours: taskData.estimated_hours || null,
        target_project_id: requirement.target_project_id,
        target_repo_path: requirement.target_repo_path,
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
      targetProjectId: requirement.target_project_id,
      targetRepoPath: requirement.target_repo_path,
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
  spec?: string | any,  // 新增：接收 spec（requirement-analyst 的输出）
): Promise<void> {
  const requirement = await db.requirements.findUnique({ where: { id: requirementId } });
  if (!requirement) return;

  // 解析 spec（如果是字符串）
  let specData: any = null;
  if (spec) {
    specData = typeof spec === 'string' ? safeJsonParse(spec) : spec;
    console.log(`[createTaskTreeFromBreakdown] spec 解析结果: ${specData ? '成功' : '失败'}`);
    if (specData?.epics) {
      console.log(`[createTaskTreeFromBreakdown] spec 中有 ${specData.epics.length} 个 epics`);
    }
  }

  // tasksData 现在是 [{ user_stories: [...], tasks: [...] }]
  for (const data of tasksData) {
    if (data.user_stories || data.tasks) {
      await createTaskTreeFromParsed(requirement, data, specData);
    }
  }
}

// ─── 导出单例接口 ──────────────────────────────────────────────────────────────

export const graphRunner = {
  startExecution,
  resumeExecution,
  loadFlow,
};