// core/server/src/graph/nodes/command-node.mts —— 跑 shell 命令（如 mvn -q compile），不调 Omnigent
// V4 修复：同时写入 results（V3 兼容）和 node_outputs（V4 条件函数读取通道）
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const execAsync = promisify(exec)

/**
 * 创建 shell 命令节点
 *
 * 执行指定 shell 命令，返回结构化结果：
 * - results: [{ compile_result }] — V3 兼容通道
 * - node_outputs: { [nodeId]: [JSON] } — V4 条件函数读取通道（spec §6.0）
 *
 * @param opts.command shell 命令
 * @param opts.db Prisma 客户端（预留，暂未使用）
 * @param opts.nodeId 节点 id（用于 node_outputs 键名，缺省 'command'）
 * @param opts.timeoutMs 命令超时毫秒数（默认 120000）
 */
export function makeCommandNode(opts: {
  command: string
  db?: any
  nodeId?: string
  timeoutMs?: number
}) {
  return async (_state: any, config: any) => {
    const execId = config?.configurable?.execution_id as string
    const timeoutMs = opts.timeoutMs ?? 120000

    let compile_result: { ok: boolean; stdout?: string; stderr?: string; error?: string }
    try {
      const { stdout, stderr } = await execAsync(opts.command, { timeout: timeoutMs })
      compile_result = { ok: true, stdout, stderr }
    } catch (e: any) {
      compile_result = { ok: false, error: e.message, stdout: e.stdout, stderr: e.stderr }
    }

    // 节点标识（用于 node_outputs 键名）
    const nodeId = opts.nodeId ?? 'command'

    // 同时写入两个通道：
    // 1) results（V3 兼容：buildSubGraph 中内联条件读 s.results）
    // 2) node_outputs（V4：default-conditions 通过 sourceText → node_outputs 读取）
    return {
      results: [{ compile_result }],
      node_outputs: { [nodeId]: [JSON.stringify(compile_result)] },
    }
  }
}
