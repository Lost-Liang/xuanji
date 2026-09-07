// core/server/src/graph/worktree.mts —— 目标项目 worktree 隔离（spec §4.2）
// v2 维护目标 repo clone（core/.target-repo/），首次 clone，后续 fetch
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
const execAsync = promisify(exec)
const ROOT = path.resolve(process.cwd())
const TARGET_DIR = path.join(ROOT, '.target-repo')
const WT_DIR = path.join(ROOT, '.worktrees')

export async function ensureTargetClone() {
  const url = process.env.TARGET_REPO_URL
  if (!url) throw new Error('TARGET_REPO_URL 未配')
  try { await execAsync(`git -C ${TARGET_DIR} fetch`) }
  catch { await execAsync(`git clone ${url} ${TARGET_DIR}`) }
}

export async function ensureReqBranch(execShortid: string) {
  const base = process.env.TARGET_BASE_BRANCH || 'main'
  await execAsync(`git -C ${TARGET_DIR} branch -f req-${execShortid} origin/${base}`)
}

// Send fan-out 每个 task 建 worktree（existing_worktree 模式，Omnigent 不自建）
// spec §4.2 worktree 隔离依赖 TARGET_REPO_URL 配置；未配时（dev 环境）降级为普通目录作 workspace，
// 否则 Omnigent createSession 会因 workspace 路径不存在而拒绝（path does not exist on host）
export async function ensureTaskWorktree(taskShortid: string, execShortid: string) {
  const wtPath = path.join(WT_DIR, `task-${taskShortid}`)
  if (process.env.TARGET_REPO_URL) {
    try {
      await execAsync(`git -C ${TARGET_DIR} worktree add -b task-${taskShortid} ${wtPath} req-${execShortid}`)
    } catch {
      // 已存在则复用
    }
  } else {
    // dev 降级：无目标 repo 时建普通目录作 workspace（不传 git，Omnigent 仅用目录）
    await execAsync(`mkdir -p ${wtPath}`).catch(() => {})
  }
  return wtPath
}

export async function removeTaskWorktree(taskShortid: string) {
  const wtPath = path.join(WT_DIR, `task-${taskShortid}`)
  await execAsync(`git -C ${TARGET_DIR} worktree remove --force ${wtPath} 2>/dev/null || true`)
}
