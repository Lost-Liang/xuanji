// packages/core/src/routes/scheduler.mts
// 调度器控制 API —— 璇玑 V4 架构层
// 提供调度器的启动/停止/状态查询接口
//
// 设计目标：
// - 从 Dashboard 可以控制调度器的运行状态
// - 避免只能 kill 进程才能停止调度器
// - 支持优雅关闭（等待当前执行完成）
// - 显示并发配置和当前运行状态

import { Router } from 'express';
import { getSchedulerController } from '../scheduler-controller.mjs';
import { getMaxConcurrent } from '../concurrency-config.mjs';

export const schedulerRouter: Router = Router();

/**
 * GET /api/scheduler/status
 * 查询调度器运行状态（包括并发配置和当前运行数）
 */
schedulerRouter.get('/status', async (_req, res) => {
  try {
    const controller = getSchedulerController();
    res.json({
      running: controller.isRunning(),
      startedAt: controller.getStartedAt(),
      maxConcurrent: getMaxConcurrent(),
      currentRunningCount: controller.getCurrentRunningCount(),
      currentRunning: controller.getCurrentRunning(),
    });
  } catch (err) {
    res.status(500).json({ error: '查询状态失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/scheduler/stop
 * 停止调度器（优雅关闭：等待当前执行完成）
 */
schedulerRouter.post('/stop', async (_req, res) => {
  try {
    const controller = getSchedulerController();
    controller.stop();
    res.json({
      ok: true,
      message: '调度器已停止（当前执行完成后不再拾取新任务）',
    });
  } catch (err) {
    res.status(500).json({ error: '停止失败', detail: (err as Error).message });
  }
});

/**
 * POST /api/scheduler/start
 * 启动调度器（如果已停止）
 */
schedulerRouter.post('/start', async (_req, res) => {
  try {
    const controller = getSchedulerController();
    const started = controller.start();
    if (started) {
      res.json({
        ok: true,
        message: '调度器已启动',
      });
    } else {
      res.json({
        ok: true,
        message: '调度器已在运行中',
      });
    }
  } catch (err) {
    res.status(500).json({ error: '启动失败', detail: (err as Error).message });
  }
});
