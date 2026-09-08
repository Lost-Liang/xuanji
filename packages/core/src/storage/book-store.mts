// packages/core/src/storage/book-store.mts
// 图书 CRUD 操作 —— 璇玑 V4 Storage 层

import { randomUUID } from 'node:crypto';
import { db } from '../db.mjs';
import type { Book } from '@prisma/client';

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
    stockQuantity?: number;
  }): Promise<Book> {
    return db.book.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    });
  },

  /**
   * 根据 ID 查询图书
   */
  async getById(id: string): Promise<Book | null> {
    return db.book.findUnique({ where: { id } });
  },

  /**
   * 根据 ISBN 查询图书
   */
  async getByIsbn(isbn: string): Promise<Book | null> {
    return db.book.findUnique({ where: { isbn } });
  },

  /**
   * 列出所有图书
   */
  async list(): Promise<Book[]> {
    return db.book.findMany({
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * 更新图书库存
   */
  async updateStock(id: string, stockQuantity: number): Promise<Book> {
    return db.book.update({
      where: { id },
      data: { stockQuantity },
    });
  },

  /**
   * 删除图书
   */
  async delete(id: string): Promise<Book> {
    return db.book.delete({ where: { id } });
  },
};