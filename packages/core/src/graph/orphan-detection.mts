// packages/core/src/graph/orphan-detection.mts
// 孤儿问题检测和恢复服务
//
// 服务启动时运行，检测超时未回答的问题并恢复状态。
// 支持定期清理任务。

import { db } from '../db.mjs';

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * 孤儿问题检测和恢复
 *
 * 服务启动时运行，检测超时未回答的问题并恢复状态。
 */
export async function recoverOrphanedQuestions(): Promise<void> {
  console.log('[orphan-detection] 开始检测孤儿问题...');

  const timeoutThreshold = new Date(Date.now() - DEFAULT_TIMEOUT_MS);

  // 查找超时的 pending 问题
  const orphans = await db.inbox_questions.findMany({
    where: {
      status: 'pending',
      waitingSince: { lt: timeoutThreshold },
    },
    include: {
      task_executions: {
        select: { status: true, execution_id: true },
      },
    },
  });

  console.log(`[orphan-detection] 发现 ${orphans.length} 个孤儿问题`);

  for (const orphan of orphans) {
    const exec = orphan.task_executions;

    if (!exec) {
      // 无关联执行，标记为 timeout
      await db.inbox_questions.update({
        where: { id: orphan.id },
        data: { status: 'timeout' },
      });
      console.log(`[orphan-detection] 问题 ${orphan.id} 标记为 timeout（无关联执行）`);
      continue;
    }

    if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled') {
      // 执行已完成但问题仍 pending，标记为 timeout
      await db.inbox_questions.update({
        where: { id: orphan.id },
        data: { status: 'timeout' },
      });
      console.log(`[orphan-detection] 问题 ${orphan.id} 标记为 timeout（执行已${exec.status}）`);
    } else if (exec.status === 'running') {
      // 执行仍在运行但问题超时，更新执行状态为 waiting
      if (!orphan.execution_id) {
        console.log(`[orphan-detection] 问题 ${orphan.id} 无 execution_id，跳过`);
        continue;
      }
      await db.task_executions.update({
        where: { execution_id: orphan.execution_id },
        data: { status: 'waiting' },
      });
      console.log(`[orphan-detection] 执行 ${orphan.execution_id} 状态更新为 waiting`);
    }
  }

  console.log('[orphan-detection] 孤儿问题检测完成');
}

/**
 * 定期清理任务
 *
 * 每 5 分钟运行一次，检测并清理孤儿问题。
 */
export function startPeriodicCleanup(): void {
  const interval = setInterval(async () => {
    try {
      await recoverOrphanedQuestions();
    } catch (err) {
      console.error('[orphan-detection] 定期清理失败:', err);
    }
  }, 5 * 60 * 1000); // 5分钟

  interval.unref(); // 不阻止进程退出
  console.log('[orphan-detection] 定期清理任务已启动（每 5 分钟）');
}