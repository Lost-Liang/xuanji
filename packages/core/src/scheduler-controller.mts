// packages/core/src/scheduler-controller.mts
// 调度器控制器 —— 璇玑 V4 架构层
// 管理调度器的启动/停止/状态查询 + Worker Pool 并发控制
//
// 设计目标：
// - 提供全局可访问的调度器控制器
// - 支持从 API 路由或任何模块控制调度器
// - 支持可配置的并发数（MAX_CONCURRENT_EXECUTIONS）
// - Worker Pool 架构：维护 running 集合，当 running.size < MAX_CONCURRENT 时拾取新任务

import { buildSchedulerGraph } from './graph/scheduler-graph.mjs';
import { getMaxConcurrent } from './concurrency-config.mjs';
import { db } from './db.mjs';

class SchedulerController {
  private running = false;
  private startedAt: string | null = null;
  private currentRunning = new Set<string>();  // 当前正在运行的 execution IDs

  /**
   * 启动调度器循环
   * @returns true 如果成功启动，false 如果已在运行
   */
  start(): boolean {
    if (this.running) {
      return false;
    }

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.runLoop().catch(err => {
      console.error('[scheduler-controller] 调度循环致命错误:', err);
      this.running = false;
    });

    console.log(`[scheduler-controller] 调度器已启动 (MAX_CONCURRENT=${getMaxConcurrent()})`);
    return true;
  }

  /**
   * 停止调度器（优雅关闭：当前执行完成后不再拾取新任务）
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    console.log('[scheduler-controller] 调度器已停止');
  }

  /**
   * 查询调度器是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取调度器启动时间（ISO 格式）
   */
  getStartedAt(): string | null {
    return this.startedAt;
  }

  /**
   * 获取当前正在运行的 execution IDs
   */
  getCurrentRunning(): string[] {
    return Array.from(this.currentRunning);
  }

  /**
   * 获取当前运行数
   */
  getCurrentRunningCount(): number {
    return this.currentRunning.size;
  }

  /**
   * 调度循环主体（Worker Pool 架构）
   *
   * 并发控制：
   * - 维护 currentRunning 集合
   * - 当 currentRunning.size < MAX_CONCURRENT 时，拾取 pending 任务
   * - 任务完成后从 currentRunning 中移除
   * - 使用 Promise.all 并行执行多个任务
   */
  private async runLoop(): Promise<void> {
    const schedulerGraph = buildSchedulerGraph();
    const maxConcurrent = getMaxConcurrent();
    console.log(`[scheduler-controller] 调度循环开始运行 (MAX_CONCURRENT=${maxConcurrent})`);

    while (this.running) {
      try {
        // 检查是否可以拾取新任务
        if (this.currentRunning.size < maxConcurrent) {
          // 查找 pending 任务
          const pending = await db.task_executions.findFirst({
            where: {
              OR: [
                {
                  status: 'pending',
                  OR: [
                    { retry_at: null },
                    { retry_at: { lte: new Date() } },
                  ],
                },
                {
                  status: 'rate_limited',
                  retry_at: { lte: new Date() },
                },
              ],
            },
            orderBy: { created_at: 'asc' },
          });

          if (pending) {
            // 拾取任务，加入 running 集合
            this.currentRunning.add(pending.execution_id);
            console.log(`[scheduler-controller] 拾取任务: ${pending.execution_id} (running: ${this.currentRunning.size}/${maxConcurrent})`);

            // 异步执行任务（不阻塞调度循环）
            this.executeTask(schedulerGraph, pending.execution_id, pending.task_id).catch(err => {
              console.error(`[scheduler-controller] 任务执行失败: ${pending.execution_id}`, err);
            });
          }
        }
      } catch (err) {
        console.error('[scheduler-controller] 调度循环出错:', (err as Error).message);
      }

      // 等待 5 秒后重新轮询
      await new Promise(r => setTimeout(r, 5000));
    }

    // 等待所有正在运行的任务完成（优雅关闭）
    if (this.currentRunning.size > 0) {
      console.log(`[scheduler-controller] 等待 ${this.currentRunning.size} 个任务完成...`);
      // 这里不实际等待，只是记录日志
      // 实际的任务会在后台继续运行直到完成
    }

    console.log('[scheduler-controller] 调度循环已退出');
  }

  /**
   * 执行单个任务
   * 任务完成后从 currentRunning 中移除
   */
  private async executeTask(schedulerGraph: any, executionId: string, taskId: string | null): Promise<void> {
    try {
      await schedulerGraph.invoke({ executionId, taskId });
    } catch (err) {
      console.error(`[scheduler-controller] 任务执行出错: ${executionId}`, err);
    } finally {
      // 任务完成，从 running 集合中移除
      this.currentRunning.delete(executionId);

      // 区分完成与失败日志
      const execution = await db.task_executions.findUnique({
        where: { execution_id: executionId },
        select: { status: true, error_message: true },
      });

      if (execution?.status === 'failed') {
        console.log(`[scheduler-controller] 任务失败: ${executionId} - ${execution.error_message || '未知错误'} (running: ${this.currentRunning.size})`);
      } else {
        console.log(`[scheduler-controller] 任务完成: ${executionId} (running: ${this.currentRunning.size})`);
      }
    }
  }
}

// 全局单例
let controllerInstance: SchedulerController | null = null;

/**
 * 获取调度器控制器实例（单例模式）
 */
export function getSchedulerController(): SchedulerController {
  if (!controllerInstance) {
    controllerInstance = new SchedulerController();
  }
  return controllerInstance;
}

/**
 * 重置控制器（仅用于测试）
 */
export function resetSchedulerController(): void {
  if (controllerInstance) {
    controllerInstance.stop();
  }
  controllerInstance = null;
}
