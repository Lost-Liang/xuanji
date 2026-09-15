// 模拟路由逻辑
import { registerCondition, getCondition } from './src/graph/conditions/index.mjs';

// 注册条件函数
function parseOutput(text) {
  if (!text) return null;
  const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (typeof parsed?.ok === 'boolean') return parsed;
    } catch {}
  }
  return null;
}

const codeReviewPass = (text) => {
  const result = parseOutput(text);
  return result?.ok === true;
};

const codeReviewIssues = (text) => {
  const result = parseOutput(text);
  return result === null || result.ok === false;
};

registerCondition('code_review_pass', codeReviewPass);
registerCondition('code_review_issues', codeReviewIssues);

// 模拟 sourceText
const sourceText = (state, sourceId) => {
  const outputs = state.node_outputs?.[sourceId];
  if (Array.isArray(outputs)) return String(outputs.at(-1) ?? '');
  return String(outputs ?? '');
};

// 模拟 routeFromSource
function routeFromSource(state, meta) {
  const nonDefault = meta.edges.filter(e => !e.is_default && !e.loop_back);
  const loopBack = meta.edges.find(e => e.loop_back);

  // 评估非回环条件边
  for (const e of nonDefault) {
    if (!e.condition) continue;
    if (e.condition.type === 'function') {
      const fn = getCondition(e.condition.config.name);
      const sourceId = e.condition.config.source;
      const text = sourceId ? sourceText(state, sourceId) : null;
      console.log(`  评估 ${e.condition.config.name}(text=${text?.slice(0, 50)}...) = ${fn(text)}`);
      if (fn(text)) return e.target;
    }
  }

  // 回环边
  if (loopBack) {
    const visits = state.loop_counters?.[meta.source] ?? 0;
    const limit = loopBack.loop_max ?? 3;
    if (visits <= limit) {
      if (loopBack.condition?.type === 'function') {
        const fn = getCondition(loopBack.condition.config.name);
        const sourceId = loopBack.condition.config.source;
        const text = sourceId ? sourceText(state, sourceId) : null;
        console.log(`  评估回环 ${loopBack.condition.config.name}() = ${fn(text)}`);
        if (fn(text)) return loopBack.target;
      }
    }
  }

  return '__end__';
}

// 测试
const content = `# 代码审查报告
\`\`\`json
{ "ok": true, "issues": [] }
\`\`\`
`;

const state = {
  node_outputs: {
    code_review: [content]
  },
  loop_counters: {
    code_review: 3  // attempt 3
  }
};

const route = {
  source: 'code_review',
  edges: [
    { target: 'final_review', loop_back: false, condition: { type: 'function', config: { name: 'code_review_pass', source: 'code_review' } } },
    { target: 'code_fix', loop_back: true, loop_max: 3, condition: { type: 'function', config: { name: 'code_review_issues', source: 'code_review' } } }
  ]
};

console.log('测试路由:');
const result = routeFromSource(state, route);
console.log(`\n结果: ${result}`);
