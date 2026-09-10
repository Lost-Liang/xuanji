// packages/core/src/storage/book-store.mts
// 图书 CRUD 操作 —— 璇玑 V4 Storage 层

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { books } from '@prisma/client';

export const bookStore = {
  /**
   * 创建新图书
   */
  async create(data: {
    isbn: string;
    title: string;
    author: string;
    publisher: string;
    category: string;
    stock_quantity?: number;
  }): Promise<books> {
    return db.books.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    });
  },

  /**
   * 根据 ID 查询图书
   */
  async getById(id: string): Promise<books | null> {
    return db.books.findUnique({ where: { id } });
  },

  /**
   * 根据 ISBN 查询图书
   */
  async getByIsbn(isbn: string): Promise<books | null> {
    return db.books.findUnique({ where: { isbn } });
  },

  /**
   * 列出所有图书
   */
  async list(): Promise<books[]> {
    return db.books.findMany({
      orderBy: { created_at: 'desc' },
    });
  },

  /**
   * 更新图书库存
   */
  async updateStock(id: string, stockQuantity: number): Promise<books> {
    return db.books.update({
      where: { id },
      data: { stock_quantity: stockQuantity },
    });
  },

  /**
   * 删除图书
   */
  async delete(id: string): Promise<books> {
    return db.books.delete({ where: { id } });
  },
};