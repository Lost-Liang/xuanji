# 璇玑 V4 E2E 测试方案

> 按 Spec 设计文档逐项验证，使用 Chrome DevTools MCP + API 调用

## 测试范围

### Level 1: API 层测试（14 个端点）
| # | 端点 | 方法 | 验证点 |
|---|------|------|--------|
| 1 | /api/health | GET | 返回 version: "0.1.0" |
| 2 | /api/requirements | POST | 创建需求，返回 id + status |
| 3 | /api/requirements | GET | 列表包含新创建的需求 |
| 4 | /api/requirements/:id | GET | 返回完整详情 |
| 5 | /api/workflows | GET | 返回工作流列表（至少 default-dev-flow） |
| 6 | /api/workflows/:id | GET | 返回 YAML 解析后的工作流详情 |
| 7 | /api/requirements/:id/execute | POST | 触发执行，返回 executionId |
| 8 | /api/executions | GET | 列表包含新创建的执行 |
| 9 | /api/executions/:id | GET | 返回执行详情，含 status/provider |
| 10 | /api/tasks | GET | 返回任务列表 |
| 11 | /api/inbox/pending | GET | 返回待回答问题列表 |
| 12 | /api/inbox/:id/answer | POST | 提交回答，更新状态 |
| 13 | /api/conversations/:sessionId/events | GET | 返回对话事件 |
| 14 | /api/conversations/session/:sessionId/followup | POST | 追问（--resume） |

### Level 2: Dashboard UI 测试（10 个场景）
| # | 页面 | 验证点 |
|---|------|--------|
| 1 | 首页 | 加载无 console 错误，导航正常 |
| 2 | 需求列表页 | 显示需求，工作流选择器填充 |
| 3 | 创建需求 | 表单提交成功，列表更新 |
| 4 | 执行需求 | 点击执行，状态变化 |
| 5 | 任务页 | 列表渲染，状态显示 |
| 6 | 执行页 | 执行详情渲染 |
| 7 | Inbox 页 | 待回答问题列表，回答表单 |
| 8 | 对话页 | 事件流渲染 |
| 9 | 路由导航 | 页面切换正常，无 404 |
| 10 | Console | 无 JS 错误，无 404/500 |

### Level 3: 数据持久化测试
| # | 表 | 验证点 |
|---|-----|--------|
| 1 | requirements | 创建后存在 |
| 2 | task_executions | 执行后存在，状态正确 |
| 3 | conversation_events | Agent 执行后有事件 |
| 4 | inbox_questions | inbox_ask 调用后存在 |
| 5 | task_logs | 执行过程有日志 |

## 测试执行顺序

1. Level 1（API）→ 确保所有端点可用
2. Level 2（UI）→ 确保 Dashboard 正常
3. Level 3（数据）→ 确保数据持久化
4. 集成测试 → 端到端流程
