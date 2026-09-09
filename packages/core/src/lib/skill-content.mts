// Skill Content Reader —— 读取 SKILL.md 文件内容
// 供 agent-node 和 seed 复用

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件所在目录（ESM 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// skills 目录相对于当前文件的位置（src/lib -> ../../skills）
const SKILLS_DIR = join(__dirname, '../../skills');

/**
 * 读取 skill 的 SKILL.md 内容
 * @param skillId skill id（如 spec-driven-development）
 * @returns SKILL.md 内容，不存在返回空字符串
 */
export function readSkillContent(skillId: string): string {
  if (!skillId) return '';

  // 先查 presets，再查 user
  const presetPath = join(SKILLS_DIR, 'presets', skillId, 'SKILL.md');
  const userPath = join(SKILLS_DIR, 'user', skillId, 'SKILL.md');

  const filePath = existsSync(presetPath) ? presetPath : existsSync(userPath) ? userPath : null;
  if (!filePath) {
    console.warn(`[skill-content] SKILL.md 不存在: ${skillId}`);
    return '';
  }

  return readFileSync(filePath, 'utf-8');
}

/**
 * 截取 SKILL.md 的有效内容（去掉 frontmatter）
 * @param content SKILL.md 原始内容
 * @param maxChars 最大字符数（防止 prompt 过长）
 */
export function extractSkillBody(content: string, maxChars: number = 8000): string {
  // 去掉 frontmatter
  let body = content;
  if (body.startsWith('---')) {
    const endIndex = body.indexOf('---', 3);
    if (endIndex > 0) {
      body = body.slice(endIndex + 3).trim();
    }
  }
  // 截断
  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + '\n... (截断)';
  }
  return body;
}