// packages/core/src/routes/books.mts
// 图书路由 —— 璇玑 V4 API 层
// 提供图书的 CRUD 接口

import { Router, Request, Response } from 'express';
import { bookStore } from '../storage/book-store.mjs';

export const booksRouter: Router = Router();

// =============================================================================
// 路由
// =============================================================================

/**
 * POST /api/books
 * 创建图书
 *
 * 请求体格式：{ isbn, title, author, publisher, category, stockQuantity? }
 * 返回 201 状态码和完整的图书信息
 */
export async function createBookHandler(req: Request, res: Response): Promise<void> {
  try {
    const { isbn, title, author, publisher, category, stockQuantity } = req.body;

    // 必填字段校验
    if (!isbn || !title || !author || !publisher || !category) {
      res.status(400).json({
        error: '缺少必填字段',
        required: ['isbn', 'title', 'author', 'publisher', 'category'],
      });
      return;
    }

    // 检查 ISBN 是否已存在
    const existing = await bookStore.getByIsbn(isbn);
    if (existing) {
      res.status(409).json({
        error: 'ISBN 已存在',
        isbn,
      });
      return;
    }

    // 创建图书
    const book = await bookStore.create({
      isbn,
      title,
      author,
      publisher,
      category,
      stock_quantity: stockQuantity ?? 0,
    });

    res.status(201).json(book);
  } catch (err) {
    res.status(500).json({
      error: '创建图书失败',
      detail: (err as Error).message,
    });
  }
}

booksRouter.post('/', createBookHandler);

/**
 * GET /api/books
 * 图书列表
 */
booksRouter.get('/', async (_req, res) => {
  try {
    const books = await bookStore.list();
    res.json(books);
  } catch (err) {
    res.status(500).json({
      error: '查询图书列表失败',
      detail: (err as Error).message,
    });
  }
});

/**
 * GET /api/books/:id
 * 图书详情
 */
booksRouter.get('/:id', async (req, res) => {
  try {
    const book = await bookStore.getById(req.params.id);
    if (!book) {
      res.status(404).json({ error: '图书不存在' });
      return;
    }
    res.json(book);
  } catch (err) {
    res.status(500).json({
      error: '查询图书失败',
      detail: (err as Error).message,
    });
  }
});

/**
 * DELETE /api/books/:id
 * 删除图书
 */
booksRouter.delete('/:id', async (req, res) => {
  try {
    const book = await bookStore.getById(req.params.id);
    if (!book) {
      res.status(404).json({ error: '图书不存在' });
      return;
    }
    await bookStore.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: '删除图书失败',
      detail: (err as Error).message,
    });
  }
});