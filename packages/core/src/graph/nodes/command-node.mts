// core/server/src/graph/nodes/command-node.mts —— 跑 shell 命令（如 mvn -q compile），不调 Omnigent
// C1：补落 phase_outputs.compile_result（spec §4.F）
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
// TODO: Task 10 修复 — persistence.mts 属于 V3 SQLite 层，V4 使用 Prisma，需改造
// import type { PersistDb } from '../persistence.mjs'
const execAsync = promisify(exec)

export function makeCommandNode(opts: { command: string; db?: any /* TODO: Task 10 修复 PersistDb */ }) {
  return async (_state: any, config: any) => {
    const execId = config?.configurable?.execution_id as string
    // TODO: Task 10 修复 — poId 和 phase_outputs 写入需改用 Prisma
    // const poId = `po-${execId}-compile_check-0`   // compile_check 不在循环，iteration 固定 0
    let compile_result: { ok: boolean; stdout?: string; stderr?: string; error?: string }
    try {
      const { stdout, stderr } = await execAsync(opts.command, { timeout: 120000 })
      compile_result = { ok: true, stdout, stderr }
    } catch (e: any) {
      compile_result = { ok: false, error: e.message, stdout: e.stdout, stderr: e.stderr }
    }
    // TODO: Task 10 修复 — 使用 Prisma 写入 phase_instances 或 conversation_events
    // if (opts.db && execId) {
    //   await opts.db.query('UPDATE phase_outputs SET compile_result=$1 WHERE id=$2', [compile_result, poId])
    // }
    return { results: [{ compile_result }] }
  }
}
