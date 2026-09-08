// 璇玑 V4 - Agent Bindings Seed
// 从 V3 ruoyi plugin.yaml + agents/*.md 初始化 10 个角色绑定

import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// V3 plugin.yaml 中定义的 10 个 agent（model/triggers/reasoning_effort 来源）
const AGENT_DEFS: Array<{
  id: string;
  name: string;
  skill: string;
  model: string;
  reasoningEffort: string;
  triggers?: Prisma.InputJsonValue;
}> = [
  { id: 'requirement-analyst', name: '需求分析师', skill: 'spec-driven-development', model: 'claude-sonnet-5', reasoningEffort: 'high' },
  { id: 'task-planner', name: '任务规划师', skill: 'planning-and-task-breakdown', model: 'claude-sonnet-5', reasoningEffort: 'high' },
  { id: 'backend-crud', name: '后端 CRUD 开发工程师', skill: 'ruoyi-plus-ai-coding', model: 'claude-sonnet-5', reasoningEffort: 'medium', triggers: { task_type: ['CRUD'], stack_type: ['BACKEND', 'FULLSTACK'] } },
  { id: 'backend-module-enhancement', name: '后端模块增强工程师', skill: 'ruoyi-plus-ai-coding', model: 'claude-sonnet-5', reasoningEffort: 'medium', triggers: { task_type: ['CRUD_UPLOAD', 'CRUD_WORKFLOW', 'CRUD_BUSINESS', 'MODULE_ENHANCEMENT'] } },
  { id: 'frontend-crud-page', name: '前端 CRUD 页面开发工程师', skill: 'ruoyi-plus-ai-coding', model: 'claude-sonnet-5', reasoningEffort: 'medium', triggers: { task_type: ['CRUD_PAGE'] } },
  { id: 'tester', name: '测试验证员', skill: 'test-driven-development', model: 'claude-sonnet-5', reasoningEffort: 'medium' },
  { id: 'bug-fixer', name: 'Bug 修复工程师', skill: 'debugging-and-error-recovery', model: 'claude-sonnet-5', reasoningEffort: 'high' },
  { id: 'reviewer', name: '代码审查员', skill: 'code-review-and-quality', model: 'claude-sonnet-5', reasoningEffort: 'high' },
  { id: 'quality-fixer', name: '质量问题修复工程师', skill: 'code-simplification', model: 'claude-sonnet-5', reasoningEffort: 'medium' },
  { id: 'security-fixer', name: '安全漏洞修复工程师', skill: 'security-and-hardening', model: 'claude-sonnet-5', reasoningEffort: 'high' },
];

// agent id → md 文件名映射
const AGENT_FILE_MAP: Record<string, string> = {
  'requirement-analyst': 'requirement-analyst.md',
  'task-planner': 'task-planner.md',
  'backend-crud': 'backend-crud.md',
  'backend-module-enhancement': 'backend-module-enhancement.md',
  'frontend-crud-page': 'frontend-crud-page.md',
  'tester': 'tester.md',
  'bug-fixer': 'bug-fixer.md',
  'reviewer': 'reviewer.md',
  'quality-fixer': 'quality-fixer.md',
  'security-fixer': 'security-fixer.md',
};

function readPromptContent(agentId: string): string {
  const fileName = AGENT_FILE_MAP[agentId];
  if (!fileName) return '';

  // dist/seed/agent-bindings-seed.mjs 运行时 cwd=packages/core
  const filePath = join(process.cwd(), 'agents', 'ruoyi', fileName);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  console.warn(`[seed] 提示文件不存在: ${filePath}`);
  return '';
}

async function main() {
  console.log('[seed] 开始初始化 Agent Bindings...');

  for (const def of AGENT_DEFS) {
    const promptContent = readPromptContent(def.id);

    const binding = await prisma.agentBinding.upsert({
      where: { id: def.id },
      update: {
        agentId: def.name,  // 中文名称，如"需求分析师"
        skillId: def.skill,
        model: def.model,
        reasoningEffort: def.reasoningEffort,
        triggers: def.triggers ? def.triggers : Prisma.JsonNull,
        // promptContent 每次都更新（确保同步）
        promptContent,
      },
      create: {
        id: def.id,
        agentId: def.name,  // 中文名称，如"需求分析师"
        pluginId: 'ruoyi',
        harness: 'claude',
        skillId: def.skill,
        model: def.model,
        reasoningEffort: def.reasoningEffort,
        triggers: def.triggers ? def.triggers : Prisma.JsonNull,
        promptContent,
      },
    });

    console.log(`[seed] ✓ ${binding.id} (${def.name})`);
  }

  console.log('[seed] 完成，共 10 个 Agent Bindings');
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });