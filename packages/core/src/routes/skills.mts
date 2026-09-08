// Skills API
// GET /api/skills - 列表（返回 { presets, user }）
// GET /api/skills/:id - 详情（含 content）
// POST /api/skills - 创建（写 user/<id>/SKILL.md）
// PUT /api/skills/:id - 更新
// DELETE /api/skills/:id - 删除（仅 user）

import { Router, type Request, type Response } from 'express';
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

export const skillsRouter: Router = Router();

// cwd = packages/core（运行时）
const SKILLS_DIR = () => join(process.cwd(), 'skills');
const PRESETS_DIR = () => join(SKILLS_DIR(), 'presets');
const USER_DIR = () => join(SKILLS_DIR(), 'user');

// 解析 SKILL.md 的 frontmatter
function parseSkillMd(filePath: string): { id: string; name: string; description: string; content?: string } | null {
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  let name = '';
  let description = '';
  let inFrontmatter = false;

  for (const line of lines) {
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) {
      if (line.startsWith('name:')) name = line.slice(5).trim();
      if (line.startsWith('description:')) description = line.slice(12).trim();
    }
  }

  return {
    id: '',
    name: name || '未命名',
    description: description || '',
    content: raw,
  };
}

// 扫描目录下的 skill
function scanSkills(dir: string, type: 'preset' | 'user'): Array<{ id: string; name: string; description: string; type: string }> {
  if (!existsSync(dir)) return [];

  const results: Array<{ id: string; name: string; description: string; type: string }> = [];

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(dir, entry.name, 'SKILL.md');
    const parsed = parseSkillMd(skillPath);
    if (parsed) {
      results.push({
        id: entry.name,
        name: parsed.name,
        description: parsed.description,
        type,
      });
    }
  }

  return results;
}

// GET / - 列表
skillsRouter.get('/', async (_req, res) => {
  const presets = scanSkills(PRESETS_DIR(), 'preset');
  const user = scanSkills(USER_DIR(), 'user');

  res.json({ presets, user });
});

// GET /:id - 详情
skillsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;

  // 先查 presets，再查 user
  let filePath = join(PRESETS_DIR(), id, 'SKILL.md');
  let type: 'preset' | 'user' = 'preset';

  if (!existsSync(filePath)) {
    filePath = join(USER_DIR(), id, 'SKILL.md');
    type = 'user';
  }

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Skill not found' });
  }

  const parsed = parseSkillMd(filePath);
  if (!parsed) {
    return res.status(500).json({ error: 'Failed to parse SKILL.md' });
  }

  res.json({
    id,
    name: parsed.name,
    description: parsed.description,
    type,
    content: parsed.content,
  });
});

// POST / - 创建（仅 user）
skillsRouter.post('/', async (req, res) => {
  const { id, name, description, content } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  const skillDir = join(USER_DIR(), id);
  const filePath = join(skillDir, 'SKILL.md');

  if (existsSync(filePath)) {
    return res.status(409).json({ error: 'Skill already exists' });
  }

  // 生成 SKILL.md 内容
  const md = `---
name: ${name || id}
description: ${description || ''}
---

${content || ''}
`;

  // 确保目录存在
  const { mkdirSync } = await import('fs');
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(filePath, md, 'utf-8');

  res.status(201).json({ id, name, description, type: 'user' });
});

// PUT /:id - 更新（仅 user）
skillsRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, content } = req.body;

  const filePath = join(USER_DIR(), id, 'SKILL.md');

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Skill not found or not editable (preset skills are read-only)' });
  }

  const md = `---
name: ${name || id}
description: ${description || ''}
---

${content || ''}
`;

  writeFileSync(filePath, md, 'utf-8');

  res.json({ id, name, description, type: 'user' });
});

// DELETE /:id - 删除（仅 user）
skillsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const skillDir = join(USER_DIR(), id);

  if (!existsSync(skillDir)) {
    return res.status(404).json({ error: 'Skill not found or not deletable (preset skills are protected)' });
  }

  rmSync(skillDir, { recursive: true, force: true });

  res.json({ ok: true });
});