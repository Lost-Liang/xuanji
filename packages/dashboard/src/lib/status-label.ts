/**
 * 节点状态翻译
 * 将英文状态转为中文显示
 */
export const nodeStatusLabel = (status: string | undefined): string => {
  const map: Record<string, string> = {
    pending: '待执行',
    draft: '待确认',
    running: '运行中',
    done: '已完成',
    completed: '已完成',
    failed: '失败',
    paused: '已暂停',
    stopped: '已停止',
    cancelled: '已取消',
    rate_limited: '限流中',
    waiting: '等待中',
  }
  return map[status || 'pending'] || status || '待执行'
}