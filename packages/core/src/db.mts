// packages/core/src/db.mts
// Prisma 客户端单例 —— 璇玑 V4 统一数据库访问入口

import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();

// 优雅关闭：进程退出前断开数据库连接
process.on('beforeExit', async () => {
  await db.$disconnect();
});
