// packages/core/src/graph/requirement-prompts.mts
// 需求分析 Prompt 模板 —— 璇玑 V4
//
// 集中管理需求分析阶段的 prompt 模板。
// Agent 接收需求文本，输出结构化 JSON（spec + Epic/Feature/UserStory/Task 树）。

/**
 * 构建需求分析 prompt
 *
 * @param inputText - 用户输入的一句话需求
 * @returns 完整的 prompt 文本
 */
export function buildRequirementAnalysisPrompt(inputText: string): string {
  return `你是璇玑自动化研发系统的需求分析师。请分析以下需求，并将其拆解为结构化的开发任务树。

## 需求描述
${inputText}

## 输出要求

请严格按以下 JSON 格式输出，不要包含任何其他内容（不要用 markdown 代码块包裹，直接输出 JSON）：

{
  "spec": "需求规格说明（200-500字，包含功能需求、非功能需求、技术约束）",
  "epics": [
    {
      "title": "史诗标题（业务模块）",
      "description": "史诗描述",
      "module": "所属模块名",
      "features": [
        {
          "title": "特性标题",
          "description": "特性描述",
          "user_stories": [
            {
              "title": "用户故事标题",
              "as_a": "作为（角色）",
              "i_want": "我想要（功能）",
              "so_that": "以便（价值）",
              "acceptance_text": "验收标准（可测试的条件列表，用逗号分隔）",
              "tasks": [
                {
                  "title": "任务标题（动词开头，明确可执行）",
                  "description": "任务详细描述，包含实现指引、涉及的文件和函数",
                  "acceptance_criteria": "具体的验收标准"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

## 拆解原则

1. **MECE 原则**：史诗之间互不重叠、完全穷尽
2. **任务粒度**：每个任务应可在 1-4 小时内完成（一个 Agent session）
3. **任务描述**：必须包含具体的实现指引（文件路径、函数名、接口定义）
4. **验收标准**：必须是可测试的、具体的条件
5. **合理数量**：通常 1-3 个史诗，每个史诗 1-3 个特性，每个特性 1-3 个用户故事，每个故事 1-3 个任务

## 注意

- 直接输出 JSON，不要有任何前缀或后缀文字
- 所有字段使用中文
- 如果需求过于简单（如"Hello World"），可以只创建 1 个史诗、1 个特性、1 个用户故事、1 个任务
`;
}
