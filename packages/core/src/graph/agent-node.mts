// packages/core/src/graph/agent-node.mts
// 通用 agent 节点 action —— 璇玑 V4 LangGraph 编排层
// 替代 V3 的 agent-node.mts（omnigent + pgClient）
//
// 职责：
// 1. makeAgentNode 工厂函数：根据节点配置创建 LangGraph 节点 action
// 2. 通过 runLocal() 调用 AgentOS Runner 执行 Agent（替代 omnigent 的 createSession + streamSession）
// 3. 通过 conversationStore 实时保存对话事件（替代 V3 的 execution_events SQLite 批量写入）
// 4. 通过 Prisma 操作数据库（替代 V3 的 pgClient 原始 SQL）
// 5. 支持 worktree 隔离（子图节点）、archive 节点、交互模式（interactive/autonomous）
// 6. handleInboxAsk 实现 —— 通过 session-control-v2 的 waitForHumanAnswer 阻塞等待人类回答
// 7. 从 AgentBinding 读取 prompt_content/model/harness/skill_id
//
// 与 worker-graph.mts 的关系：
// - worker-graph.mts：调度图的工作节点，负责任务队列的租约/心跳/429 重试
// - agent-node.mts：画布图的 agent 节点工厂，负责多步工作流中的 Agent 执行
// - 两者都使用 runLocal() 作为底层执行引擎

import { interrupt } from '@langchain/langgraph';
import { runLocal, type AdapterEvent } from '@xuanji/runner';
import { conversationStore } from '../storage/conversation-store.mjs';
import { ensureTaskWorktree } from './worktree.mjs';
import { mapAdapterEvent, handleInboxAsk } from './shared-agent-utils.mjs';
import { db } from '../db.mjs';
import { randomUUID } from 'node:crypto';
import type { SelectorRule, ExitContract } from './types.mjs';
import { getByRole, type AgentBinding } from '../storage/agent-binding-store.mjs';
import { readSkillContent, extractSkillBody } from '../lib/skill-content.mjs';
import { verifyContract } from './contract-verifier.mjs';
import { UpstreamMissingError } from './errors.mjs';
import { sourceText } from './conditions/source-text.mjs';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

// runLocal 超时阈值：单次执行不可超过该时长
// 默认 1 小时（reviewer 跑 code-review/security skill 分析代码 + 输出 checklist 较久）
// env 可覆盖
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS) || 60 * 60 * 1000;

// ─── 数据流 inputs 组装（Task 5）──────────────────────────────────────────────

/**
 * 根据 inputs 数组从 state 中构建 agent prompt 文本
 *
 * 支持的数据源：
 * - 'task': 读取 state.task，格式化完整的任务详情
 * - 'input': 读取 state.input
 * - 'spec': 读取 state.spec，格式化需求规格
 * - 其他: 上游节点 ID，从 node_outputs 中读取
 *
 * @param state LangGraph 状态
 * @param inputs 数据来源数组
 * @returns 组装后的 prompt 文本
 */
export function buildAgentContext(state: any, inputs: string[]): string {
  const parts: string[] = [];

  for (const src of inputs) {
    if (src === 'task') {
      const task = state.task;
      if (task) {
        const taskParts: string[] = [];
        taskParts.push(`# 任务：${task.title || '未命名任务'}`);

        if (task.description) {
          taskParts.push(`\n## 任务描述\n${task.description}`);
        }

        if (task.acceptance_criteria || task.acceptanceCriteria) {
          taskParts.push(`\n## 验收标准\n${task.acceptance_criteria || task.acceptanceCriteria}`);
        }

        if (task.acceptance_steps || task.acceptanceSteps) {
          const steps = task.acceptance_steps || task.acceptanceSteps;
          if (Array.isArray(steps) && steps.length > 0) {
            taskParts.push(`\n## BDD 验收步骤`);
            steps.forEach((step: string, i: number) => {
              taskParts.push(`${i + 1}. ${step}`);
            });
          } else if (typeof steps === 'string') {
            taskParts.push(`\n## BDD 验收步骤\n${steps}`);
          }
        }

        if (task.target_repo_path || task.targetRepoPath) {
          taskParts.push(`\n## 工作目录\n${task.target_repo_path || task.targetRepoPath}`);
        }

        if (task.task_type || task.taskType) {
          taskParts.push(`\n## 任务类型\n${task.task_type || task.taskType}`);
        }

        parts.push(taskParts.join('\n'));
      }
    } else if (src === 'input') {
      if (state.input) {
        parts.push(state.input);
      }
    } else if (src === 'spec') {
      const specData = typeof state.spec === 'string' ? safeJsonParse(state.spec) : state.spec;
      if (specData) {
        parts.push(`# 需求规格\n\n${JSON.stringify(specData, null, 2)}`);
      }
    } else {
      // 上游节点产出
      // 区分"缺失"和"空输出"：
      // - 缺失：node_outputs 中没有这个 key → 抛错
      // - 空输出：有 key 但值为空数组 → 视为有效输出（内容为空）
      const outputs = state.node_outputs?.[src]
      if (outputs === undefined) {
        throw new UpstreamMissingError(src);
      }
      const out = sourceText(state, src);
      parts.push(`## 上游阶段产出：${src}\n\n${out}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 安全解析 JSON
 */
function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// ─── 工作目录解析 ──────────────────────────────────────────────────────────────

/**
 * 解析 agent 进程的工作目录（spawn 的 cwd）
 *
 * 优先级：
 *   1. 任务自带的目标项目目录（task.target_repo_path）
 *   2. 子图节点：该任务独立的 worktree
 *   3. 执行实例自身的 target_repo_path（需求级执行 state.task 为 null，走这条）
 *
 * ⚠️ 字段名必须是 snake_case。Prisma 返回的 tasks 行是 `target_repo_path`；
 * 写成 camelCase 的 `targetRepoPath` 会恒为 undefined，workDir 便静默落到
 * process.cwd()——也就是 core 服务自己的目录，被调度的 agent 于是带着全工具
 * 权限在璇玑源码里执行（2026-09-10 事故根因）。task 的类型是 any，TS 拦不住
 * 这种笔误，改这里请对照 prisma/schema.prisma。
 *
 * 三条路径都拿不到时抛错，绝不降级到 process.cwd()。
 *
 * @param opts.lookupExecRepoPath / opts.createWorktree —— 测试注入点，生产走默认实现
 */
export async function resolveAgentWorkDir(opts: {
  task: any;
  executionId: string;
  nodeId: string;
  isSubgraph?: boolean;
  execShortid?: string;
  lookupExecRepoPath?: (executionId: string) => Promise<string | null | undefined>;
  createWorktree?: (taskShortid: string, execShortid: string) => Promise<string>;
}): Promise<string> {
  const { task, executionId, nodeId, isSubgraph, execShortid, lookupExecRepoPath, createWorktree } = opts;

  // 1. 任务自带目标目录
  //    camelCase 分支仅为兼容手工构造的对象；真实 Prisma 行只有 snake_case
  const taskRepoPath = task?.target_repo_path || task?.targetRepoPath;
  if (taskRepoPath) {
    return taskRepoPath;
  }

  // 2. 子图节点：每个任务一个独立 worktree
  //    注意 tasks 表没有 shortid 列，task.shortid 恒为 undefined，故回退到主键 id
  if (isSubgraph && task) {
    const create = createWorktree ?? ensureTaskWorktree;
    return await create(task.shortid ?? task.id, execShortid ?? '');
  }

  // 3. 需求级执行：用执行实例自己的 target_repo_path
  const lookup = lookupExecRepoPath ?? (async (id: string) => {
    const exec = await db.task_executions.findUnique({
      where: { execution_id: id },
      select: { target_repo_path: true },
    });
    return exec?.target_repo_path;
  });
  const execRepoPath = await lookup(executionId);
  if (execRepoPath) {
    return execRepoPath;
  }

  throw new Error(
    `无法确定 Agent 工作目录：execution=${executionId} node=${nodeId} 的 target_repo_path 为空。` +
      `拒绝降级到 process.cwd()——那会让 agent 在璇玑自己的源码目录里以全权限执行。`,
  );
}

// ─── Binding 选择器 ────────────────────────────────────────────────────────────

/**
 * 从多个 binding 中根据 selector 选择一个
 */
function selectBinding(
  bindings: AgentBinding[],
  selector: SelectorRule | undefined,
  task: any
): AgentBinding | null {
  if (bindings.length === 0) return null;
  if (bindings.length === 1) return bindings[0];

  // 无 selector 或无 task，回退第一个
  if (!selector || !task) return bindings[0];

  const { by } = selector;
  const triggersKey = by === 'task_type' ? 'task_type' : 'stack_type';

  // 遍历 bindings，找到 triggers 匹配的
  for (const binding of bindings) {
    const triggers = binding.triggers as any;
    if (triggers && triggers[triggersKey]) {
      const taskValue = by === 'task_type' ? task.taskType : task.stackType;
      if (taskValue && triggers[triggersKey].includes(taskValue)) {
        return binding;
      }
    }
  }

  // 未匹配，回退第一个
  return bindings[0];
}

/**
 * 构建 Agent Prompt：角色指令 + 技能 + 节点上下文 + 输出格式要求
 */
function buildAgentPrompt(
  binding: AgentBinding | null,
  nodeContext: string,
  skillContent: string | null,
  nodeId?: string,
): string {
  const parts: string[] = [];

  // 1. 角色指令（来自 binding.prompt_content）
  if (binding?.prompt_content) {
    parts.push(binding.prompt_content);
  }

  // 2. 技能内容（来自 skill_id 的 SKILL.md）
  if (skillContent) {
    parts.push('\n\n---\n\n# 技能指南\n\n' + skillContent);
  }

  // 3. 节点上下文（任务描述、需求文本等）
  if (nodeContext) {
    parts.push('\n\n---\n\n# 当前任务\n\n' + nodeContext);
  }

  // 4. 根据节点类型追加输出格式要求
  let outputFormat = '';

  if (nodeId === 'write_tests') {
    outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,           // 测试编写是否完成
  "summary": "一句话总结",
  "test_files": ["文件路径"],
  "test_count": number     // 测试用例总数
}
\`\`\``;
  } else if (nodeId === 'develop') {
    outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,              // 开发是否完成
  "summary": "一句话总结",
  "files_created": ["文件路径"],
  "files_modified": ["文件路径"],
  "compilation_ok": boolean   // 编译是否通过
}
\`\`\``;
  } else if (nodeId === 'test') {
    outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,              // 测试是否全部通过
  "summary": "一句话总结",
  "passed": boolean,          // 测试是否全部通过
  "passed_count": number,     // 通过的测试数
  "total_count": number,      // 测试总数
  "compilation_ok": boolean   // 编译是否通过
}
\`\`\``;
  } else if (nodeId === 'code_review') {
    outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,              // 审查是否通过
  "summary": "一句话总结",
  "approved": boolean,        // 是否批准
  "issues": ["问题描述"]
}
\`\`\``;
  } else if (nodeId === 'code_fix') {
    outputFormat = `

## 输出格式要求

在最终回答末尾，输出一个 JSON 代码块：

\`\`\`json
{
  "ok": boolean,                 // 修复是否完成
  "summary": "一句话总结",
  "files_modified": ["文件路径"],
  "issues_resolved": ["问题描述"]
}
\`\`\``;
  }

  return parts.join('') + outputFormat;
}

// ─── 返回构建 ──────────────────────────────────────────────────────────────────

/**
 * 从 markdown 输出中提取 JSON 对象
 * 支持格式：
 * 1. 直接 JSON 对象
 * 2. ```json ... ``` 代码块
 */
function extractJsonFromOutput(output: string): any | null {
  if (!output) return null;

  // 尝试直接解析
  try {
    return JSON.parse(output);
  } catch {
    // 不是直接 JSON，尝试从代码块提取
  }

  // 尝试从 ```json 代码块提取
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // 解析失败
    }
  }

  // 尝试匹配任何 JSON 对象
  const objectMatch = output.match(/\{[\s\S]*"user_stories"[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // 解析失败
    }
  }

  return null;
}

/**
 * 按 writeKey 分支 return 三种 state channel shape（spec §4.A 末段）
 *
 * - spec=string 覆盖
 * - tasks=array 覆盖（从 agent 输出中解析）
 * - results=array append（reducer concat）
 */
export function buildReturn(
  writeKey: string,
  nodeId: string,
  output: string,
  sessionId: string,
  phaseInstanceId?: string,
) {
  const session_refs = [{ node_id: nodeId, session_id: sessionId }];

  if (writeKey === 'spec') {
    // 从 agent 输出中解析 JSON（requirement-analyst 的输出包含 markdown + JSON）
    const parsed = extractJsonFromOutput(output);
    return { spec: parsed || output, session_refs };
  }
  if (writeKey === 'tasks') {
    // 从 agent 输出中解析任务数据
    const parsed = extractJsonFromOutput(output);
    if (parsed) {
      // 返回完整的解析结果，供 onFlowComplete 使用
      return { tasks: [parsed], session_refs };
    }
    return { tasks: [], session_refs };
  }
  return {
    results: [{ node_id: nodeId, output, phase_instance_id: phaseInstanceId }],
    node_outputs: { [nodeId]: [output] },
    session_refs,
  };
}

// ─── makeAgentNode 工厂 ────────────────────────────────────────────────────────

/**
 * Agent 节点工厂：根据配置创建 LangGraph 节点 action
 *
 * V3 → V4 改造要点：
 * - createSession + streamSession → runLocal()
 * - pgClient 原始 SQL → Prisma 客户端
 * - omnigent_session_refs → phase_instances 表
 * - execution_events（批量 token 写入）→ conversation_events（onEvent 回调）
 * - elicitation_requests → inbox_questions 表
 * - isKilled / stopSession / getSession → 不再需要（runLocal 是进程级）
 * - 从 AgentBinding 读取 prompt_content/model/harness/skill_id
 *
 * 节点类型支持：
 * - isSubgraph: 子图节点，建 worktree，有 task 上下文
 * - isArchive: 归档节点，prompt 拼 git push + gh pr create
 * - interactionMode: interactive（支持 interrupt 等待人类）/ autonomous（直接执行）
 */
export function makeAgentNode(opts: {
  bindingIds: string[];                       // 多数 1 个；development 多个 + selector
  selector?: SelectorRule;
  buildPrompt: (state: any) => string;       // 节点上下文构建函数
  writeKey: string;
  nodeId: string;
  isSubgraph?: boolean;                       // 子图节点有 task，建 worktree
  isArchive?: boolean;                        // archive 节点：prompt 拼 git push + gh pr create
  interactionMode?: 'interactive' | 'autonomous';
  exitContract?: ExitContract;                // 准出契约（Task 4）
}) {
  return async (state: any, config: any) => {
    const task = state.task;
    const topExecId = config.configurable?.execution_id as string;
    const execShortid = config.configurable?.exec_shortid as string;

    // 子图节点用子图 execution id 作 ref 键（spec §6 子图有独立 GraphExecution 行）
    // Send fan-out 并行场景需按子图实例区分，避免 ref 撞键
    const execId = opts.isSubgraph && task?.shortid
      ? `exec-task-${execShortid}-${task.shortid}`
      : topExecId;

    // 循环节点第几轮（fix 节点 action 末尾自增）
    // V4 修正：命名改为 visits（已完成次数），更清晰
    const visits = state.loop_counters?.[opts.nodeId] ?? 0

    // ── 从 DB 读取 Binding 配置 ───────────────────────────────────────────────
    let bindings: AgentBinding[] = [];
    try {
      bindings = await getByRole(opts.bindingIds);
    } catch (e) {
      console.warn(`[agent-node] 读取 binding 失败: ${opts.bindingIds}`, e);
    }

    // 选择 binding（多 binding + selector 场景）
    const selectedBinding = selectBinding(bindings, opts.selector, task);

    // 读取技能内容
    let skillContent: string | null = null;
    if (selectedBinding?.skill_id) {
      try {
        const raw = readSkillContent(selectedBinding.skill_id);
        if (raw) {
          skillContent = extractSkillBody(raw, 6000);
        }
      } catch (e) {
        console.warn(`[agent-node] 读取 skill 失败: ${selectedBinding.skill_id}`, e);
      }
    }

    // 映射 harness → provider
    const provider = selectedBinding?.harness === 'codex' ? 'codex' : 'claude';
    const model = selectedBinding?.model || undefined;

    // ── 子图 execution 行状态更新 ────────────────────────────────────────────
    // 子图节点执行时推进子图 execution 行的 status + current_node_id
    if (opts.isSubgraph && execId) {
      await updateSubgraphExec(execId, 'running', opts.nodeId);
    }

    // ── reject 重做检测（spec §5）────────────────────────────────────────────
    // 上游 gate reject 后 path 回到此节点，续原 session 发 message 带 comments
    const lastReview = state.review_decisions?.[state.review_decisions.length - 1];
    const isRejectRedo = lastReview?.decision === 'reject' && !!lastReview?.comments;

    // ── 构建 Prompt ──────────────────────────────────────────────────────────
    const nodeContext = opts.buildPrompt(state);
    let promptText = buildAgentPrompt(selectedBinding, nodeContext, skillContent, opts.nodeId);

    if (isRejectRedo) {
      promptText = `人审驳回意见：${lastReview.comments}\n\n请据此修正：\n\n${promptText}`;
    }

    // archive 节点 prompt 拼 git push + gh pr create（spec §4.2/§4.5）
    if (opts.isArchive) {
      if (process.env.TARGET_REPO_URL) {
        promptText = `${promptText}\n\n完成后执行：git push origin task-${task?.shortid} && gh pr create --base ${process.env.TARGET_BASE_BRANCH} --repo ${process.env.TARGET_REPO_URL} --fill`;
      } else {
        promptText = `${promptText}\n\n完成后执行：git tag archive-${task?.shortid} && echo "已本地归档 task-${task?.shortid}（未配 TARGET_REPO_URL，跳过远端 push/PR）"`;
      }
    }

    // ── 创建/复用 PhaseInstance（替代 V3 的 omnigent_session_refs）──────────
    // V4 使用 phase_instances 表追踪每个节点每次迭代的执行状态
    let phaseInstance: { id: string; sessionId: string | null } | null = null;

    if (execId) {
      // 查找已有的 phase instance（幂等续跑）
      const existing = await db.phase_instances.findFirst({
        where: {
          execution_id: execId,
          phase_id: opts.nodeId,
          attempt: visits + 1,  // V4 修正：attempt = visits + 1
        },
      });

      if (existing) {
        phaseInstance = { id: existing.id, sessionId: existing.session_id };
      } else {
        // 创建新的 phase instance
        const newPhase = await db.phase_instances.create({
          data: {
            id: randomUUID(),
            execution_id: execId,
            phase_id: opts.nodeId,
            task_id: task?.id ?? null,
            attempt: visits + 1,  // V4 修正：attempt = visits + 1
            status: 'running',
            started_at: new Date(),
          },
        });
        phaseInstance = { id: newPhase.id, sessionId: null };
      }
    }

    // ── 确定工作目录 ─────────────────────────────────────────────────────────
    const workDir = await resolveAgentWorkDir({
      task,
      executionId: topExecId,
      nodeId: opts.nodeId,
      isSubgraph: opts.isSubgraph,
      execShortid,
    });

    // ── 会话恢复决策（V4 修复）────────────────────────────────────────────────────
    // V4 修复：区分回环重入 vs 串行续跑
    // - 回环重入（reentry 标记）→ 强制开新会话，AI 不复述旧答案
    // - 串行续跑（429 重试/gate resume）→ 复用会话，AI 继续上次工作
    const isReentry = state.reentry?.[opts.nodeId] === true;

    // 清除 reentry 标记（一次性消费）
    if (isReentry && state.reentry) {
      delete state.reentry[opts.nodeId];
    }

    // 决定是否复用 session
    const existingSessionId = isReentry
      ? undefined  // 回环重入 → 强制开新会话
      : phaseInstance?.sessionId;  // 串行续跑 → 复用

    // ── 执行 Agent ───────────────────────────────────────────────────────────
    let output = '';
    let currentSessionId: string | null = null;

    // A4: 从 config 中提取 AbortSignal（由 graph-runner 传入）
    const abortSignal = config?.signal as AbortSignal | undefined;

    // 超时保护
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Agent 执行超时（${RUN_TIMEOUT_MS}ms）`)), RUN_TIMEOUT_MS);
    });

    try {
      const runPromise = runLocal({
        provider,                          // 从 binding.harness 映射
        prompt: promptText,
        workDir,
        model,                             // 从 binding.model 读取
        // 执行实例 ID —— 用于 MCP 配置（inbox_ask 工具）
        executionId: execId,
        // A4: 传入 AbortSignal，支持取消响应
        abortSignal,
        // 如果有 sessionId，尝试恢复会话
        resume: existingSessionId
          ? { providerConversationId: existingSessionId, input: promptText }
          : undefined,
        // 事件流回调 —— 实时保存对话事件到 conversation_events 表
        onEvent: async (event: AdapterEvent) => {
          // 提取 sessionId（来自 system/init 事件）
          if (event.type === 'system' && event.subtype === 'init') {
            currentSessionId = event.sessionId;

            // 更新 phase instance 的 sessionId
            if (phaseInstance) {
              await db.phase_instances.update({
                where: { id: phaseInstance.id },
                data: { session_id: event.sessionId },
              });
              phaseInstance.sessionId = event.sessionId;
            }
          }

          // 映射并保存对话事件
          const mapped = mapAdapterEvent(event);
          if (!mapped) return;
          await conversationStore.saveEvent({
            execution_id: execId,
            session_id: currentSessionId ?? undefined,
            event_type: mapped.eventType,
            role: mapped.role,
            payload: mapped.payload,
          });

          // 累积最终输出
          if (event.type === 'result' && event.subtype === 'success' && event.output) {
            output = event.output;
          }
        },
        // 人机交互回调 —— inbox_ask 工具触发
        onInboxAsk: async (question) => {
          return await handleInboxAsk(execId, currentSessionId, question);
        },
      });

      // 超时竞争
      const result = await Promise.race([runPromise, timeoutPromise]);

      // 提取最终输出
      if (result.success && result.finalOutput) {
        output = result.finalOutput;
      }

      // 更新 sessionId
      if (result.sessionInfo?.providerConversationId) {
        currentSessionId = result.sessionInfo.providerConversationId;
        if (phaseInstance && phaseInstance.sessionId !== currentSessionId) {
          await db.phase_instances.update({
            where: { id: phaseInstance.id },
            data: { session_id: currentSessionId },
          });
        }
      }

      // 执行失败处理
      if (!result.success) {
        const errorMsg = result.error || 'Agent 执行失败，无输出';

        if (phaseInstance) {
          await db.phase_instances.update({
            where: { id: phaseInstance.id },
            data: { status: 'failed', error_message: errorMsg, completed_at: new Date() },
          });
        }

        if (opts.isSubgraph && execId) {
          await updateSubgraphExec(execId, 'failed', opts.nodeId);
        }

        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      // 超时错误
      if (err instanceof Error && err.message.includes('超时')) {
        if (phaseInstance) {
          await db.phase_instances.update({
            where: { id: phaseInstance.id },
            data: { status: 'failed', error_message: err.message, completed_at: new Date() },
          });
        }
        if (opts.isSubgraph && execId) {
          await updateSubgraphExec(execId, 'failed', opts.nodeId);
        }
        throw err;
      }

      // inbox_ask 中断（LangGraph interrupt）—— 向上透传
      throw err;
    }

    // ── 准出契约校验（Task 4）────────────────────────────────────────────────────
    // AI 说「测试通过」不算数，流程跑断言才算数
    // 契约失败不抛错，合成 ok:false verdict 走正常路由
    const exitContract = opts.exitContract;
    let contractVerified = true;
    let contractFailures: any[] = [];

    if (exitContract) {
      const contractResult = await verifyContract(
        opts.nodeId,
        output,
        exitContract,
        workDir,
      );

      if (!contractResult.ok) {
        contractVerified = false;
        contractFailures = contractResult.failures;

        console.warn(
          `[agent-node] 准出契约失败: nodeId=${opts.nodeId} failures=${contractFailures.length}`,
        );

        // 更新 phase instance 状态为 contract_failed
        if (phaseInstance) {
          await db.phase_instances.update({
            where: { id: phaseInstance.id },
            data: {
              status: 'contract_failed',
              error_message: `准出契约失败: ${contractFailures.map((f) => f.detail).join('; ')}`,
              completed_at: new Date(),
            },
          });
        }

        // 合成 ok:false verdict
        const verdict = {
          ok: false,
          contract_failed: true,
          failures: contractFailures,
          ai_claimed: extractJsonFromOutput(output),
        };
        output = JSON.stringify(verdict);
      } else {
        console.log(`[agent-node] 准出契约通过: nodeId=${opts.nodeId}`);
      }
    }

    // ── 保存阶段产出物 ───────────────────────────────────────────────────────
    if (phaseInstance) {
      // 保存完整输出到 phase_outputs
      await db.phase_outputs.create({
        data: {
          phase_instance_id: phaseInstance.id,
          key: opts.writeKey,
          value: output,
        },
      });

      // 尝试从输出中提取 JSON 并存储到 result_payload
      let resultPayload: any = null
      if (output) {
        // 尝试从 ```json 代码块提取
        const jsonMatch = output.match(/```json\s*(\{[\s\S]*?\})\s*```/)
        if (jsonMatch) {
          try {
            resultPayload = JSON.parse(jsonMatch[1])
          } catch {
            console.warn(`[agent-node] 无法解析 ${opts.nodeId} 的 JSON 代码块`)
          }
        } else {
          // 回退：尝试直接解析
          try {
            const parsed = JSON.parse(output)
            if (typeof parsed === 'object' && parsed !== null) {
              resultPayload = parsed
            }
          } catch {
            console.warn(`[agent-node] ${opts.nodeId} 输出无法解析为 JSON`)
          }
        }
      }

      // 标记 phase instance 完成
      await db.phase_instances.update({
        where: { id: phaseInstance.id },
        data: {
          status: 'completed',
          result_content: output,
          result_payload: resultPayload,  // 存储解析出的 JSON
          session_id: currentSessionId,
          completed_at: new Date(),
        },
      });
    }

    // ── 子图 archive 节点：标记子图 execution 完成 ──────────────────────────
    if (opts.isSubgraph && opts.isArchive && execId) {
      await updateSubgraphExec(execId, 'completed', opts.nodeId);
    }

    // ── interactive 模式：session 完成后 interrupt 等待用户回复 ──────────────
    // sessionInterrupt / resumeGraph 已就位于 session-control-v2.mts
    // TODO: 此处接入 interactive 模式：调用 sessionInterrupt 挂起图，等人类确认后 resumeGraph 继续
    // 当前简化：autonomous 模式直接返回，interactive 模式也直接返回（不 interrupt）

    // ── 返回 state 更新 ──────────────────────────────────────────────────────
    return buildReturn(
      opts.writeKey,
      opts.nodeId,
      output,
      currentSessionId || '',
      phaseInstance?.id,
    );
  };
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * 子图 execution 行状态更新
 *
 * 替代 V3 的 markSubgraphExec（pgClient 原始 SQL）
 * 使用 Prisma 操作 task_executions 表
 *
 * 状态机：
 * - status: running → completed/failed
 * - current_node_id: 记录当前执行的节点
 * - started_at: 首次写入
 * - completed_at: 终态时写入
 */
async function updateSubgraphExec(
  execId: string,
  status: string,
  nodeId?: string,
): Promise<void> {
  try {
    await db.task_executions.update({
      where: { execution_id: execId },
      data: {
        status,
        ...(nodeId ? { stage: nodeId } : {}),
        ...(status === 'running' ? { started_at: new Date() } : {}),
        ...((status === 'completed' || status === 'failed')
          ? { completed_at: new Date() }
          : {}),
      },
    });
  } catch {
    // 子图 execution 行更新失败不影响主流程
    console.warn(`[agent-node] 更新子图 execution 状态失败: ${execId}`);
  }
}
