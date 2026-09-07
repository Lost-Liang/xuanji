export interface KeywordConfig {
  any?: string[]           // 匹配任一关键词
  none?: string[]          // 排除关键词
  regex?: string[]         // 正则匹配
  case_sensitive?: boolean // 区分大小写，默认 false
}

/**
 * 评估 Keyword 条件
 * @param output 节点输出文本
 * @param config 关键词配置
 * @returns 是否匹配
 */
export function evaluateKeywordCondition(output: string, config: KeywordConfig): boolean {
  const text = config.case_sensitive ? output : output.toLowerCase()

  // none: 包含任意一个即不匹配（优先检查）
  if (config.none?.length) {
    const keywords = config.case_sensitive ? config.none : config.none.map(k => k.toLowerCase())
    if (keywords.some(k => text.includes(k))) {
      return false
    }
  }

  // any: 包含任意一个即匹配
  if (config.any?.length) {
    const keywords = config.case_sensitive ? config.any : config.any.map(k => k.toLowerCase())
    if (keywords.some(k => text.includes(k))) {
      return true
    }
  }

  // regex: 正则匹配
  if (config.regex?.length) {
    const flags = config.case_sensitive ? 'g' : 'gi'
    for (const pattern of config.regex) {
      try {
        if (new RegExp(pattern, flags).test(output)) {
          return true
        }
      } catch (e) {
        console.warn(`Invalid regex pattern: ${pattern}`, e)
      }
    }
  }

  // 如果没有配置任何条件，返回 false
  return false
}