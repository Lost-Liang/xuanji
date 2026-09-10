// core/server/src/graph/nodes/command-node.mts —— 跑 shell 命令（如 mvn -q compile），不调 Omnigent
// V4 修复：
// 1. 同时写入 results（V3 兼容）和 node_outputs（V4 条件函数读取通道）
// 2. 创建 phase_instance 记录（与 agent-node.mts 对齐）
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { db } from '../../db.mjs'

const execAsync = promisify(exec)

/**
 * 创建 shell 命令节点
 *
 * 执行指定 shell 命令，返回结构化结果：
 * - results: [{ compile_result }] — V3 兼容通道
 * - node_outputs: { [nodeId]: [JSON] } — V4 条件函数读取通道（spec §6.0）
 * - phase_instance 记录 — 追踪执行状态（与 agent-node.mts 对齐）
 *
 * @param opts.command shell 命令
 * @param opts.nodeId 节点 id（用于 node_outputs 键名，缺省 'command'）
 * @param opts.timeoutMs 命令超时毫秒数（默认 120000）
 */
export function makeCommandNode(opts: {
  command: string
  nodeId?: string
  timeoutMs?: number
}) {
  return async (_state: any, config: any) => {
    const execId = config?.configurable?.execution_id as string
    const timeoutMs = opts.timeoutMs ?? 120000

    // 节点标识（用于 node_outputs 键名）
    const nodeId = opts.nodeId ?? 'command'

    // ── 创建/复用 PhaseInstance（与 agent-node.mts 对齐）────────────────────
    let phaseInstance: { id: string } | null = null

    if (execId) {
      // 查找已有的 phase instance（幂等续跑）
      const existing = await db.phase_instances.findFirst({
        where: {
          execution_id: execId,
          phase_id: nodeId,
          status: { in: ['running', 'completed'] },
        },
        orderBy: { attempt: 'desc' },
      })

      if (existing && existing.status === 'running') {
        // 续跑：复用现有 phase instance
        phaseInstance = { id: existing.id }
      } else {
        // 创建新的 phase instance
        const newPhase = await db.phase_instances.create({
          data: {
            id: randomUUID(),
            execution_id: execId,
            phase_id: nodeId,
            task_id: _state?.task?.id ?? null,
            attempt: (existing?.attempt ?? 0) + 1,
            status: 'running',
            started_at: new Date(),
          },
        })
        phaseInstance = { id: newPhase.id }
      }
    }

    // ── 执行命令 ─────────────────────────────────────────────────────────────
    let compile_result: { ok: boolean; stdout?: string; stderr?: string; error?: string }
    try {
      const { stdout, stderr } = await execAsync(opts.command, { timeout: timeoutMs })
      compile_result = { ok: true, stdout, stderr }
    } catch (e: any) {
      compile_result = { ok: false, error: e.message, stdout: e.stdout, stderr: e.stderr }
    }

    // ── 更新 PhaseInstance 状态 ──────────────────────────────────────────────
    if (phaseInstance) {
      await db.phase_instances.update({
        where: { id: phaseInstance.id },
        data: {
          status: compile_result.ok ? 'completed' : 'failed',
          completed_at: new Date(),
          result_summary: JSON.stringify(compile_result),
        },
      })
    }

    // 同时写入两个通道：
    // 1) results（V3 兼容：buildSubGraph 中内联条件读 s.results）
    // 2) node_outputs（V4：default-conditions 通过 sourceText → node_outputs 读取）
    return {
      results: [{ compile_result }],
      node_outputs: { [nodeId]: [JSON.stringify(compile_result)] },
    }
  }
}
