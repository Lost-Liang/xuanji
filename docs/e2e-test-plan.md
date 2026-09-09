# 人机交互状态持久化 E2E 测试方案

## 测试目标

验证人机交互状态从进程内存持久化到数据库后，支持：
1. 服务重启后恢复等待状态
2. 执行状态与人机交互状态同步
3. SSE 实时推送
4. 孤儿检测服务正常工作

## 测试环境

| 服务 | 端口 | 状态检查 |
|------|------|----------|
| PostgreSQL | 5433 | `docker ps` |
| Core API | 3000 | `curl http://localhost:3000/api/health` |
| Dashboard | 5173 | `curl http://localhost:5173` |

## 测试用例

### 测试 1: API 端点功能验证

**目的:** 验证 inbox-ask 端点的创建和轮询模式

**步骤:**
```bash
# 1.1 创建测试问题
curl -X POST http://localhost:3000/api/internal/inbox-ask \
  -H "Content-Type: application/json" \
  -d '{"create": true, "executionId": "test-exec-001", "question": "请选择测试选项", "choices": ["A", "B", "C"]}'

# 预期: 返回 questionId，30秒后返回 {status: "pending", continue: true}

# 1.2 验证问题已创建
curl http://localhost:3000/api/executions/test-exec-001/elicitations

# 预期: 返回包含刚创建的问题

# 1.3 回答问题
curl -X POST http://localhost:3000/api/executions/test-exec-001/elicitations/{questionId}/reply \
  -H "Content-Type: application/json" \
  -d '{"answer": "A"}'

# 预期: 返回更新后的问题，status = "answered"

# 1.4 轮询获取答案
curl -X POST http://localhost:3000/api/internal/inbox-ask \
  -H "Content-Type: application/json" \
  -d '{"questionId": "{questionId}"}'

# 预期: 返回 {status: "answered", answer: "A"}
```

### 测试 2: 服务重启恢复

**目的:** 验证服务重启后等待中的问题不丢失

**步骤:**
```bash
# 2.1 创建问题（不回答）
curl -X POST http://localhost:3000/api/internal/inbox-ask \
  -H "Content-Type: application/json" \
  -d '{"create": true, "executionId": "test-exec-002", "question": "重启测试问题"}'

# 记录返回的 questionId

# 2.2 验证问题在数据库中
curl http://localhost:3000/api/executions/test-exec-002/elicitations

# 2.3 重启 Core 服务
pkill -f "node.*index"
cd packages/core && node dist/index.mjs &
sleep 3

# 2.4 检查孤儿检测日志
# 预期: 日志显示 "[orphan-detection] 开始检测孤儿问题..."

# 2.5 回答问题
curl -X POST http://localhost:3000/api/executions/test-exec-002/elicitations/{questionId}/reply \
  -H "Content-Type: application/json" \
  -d '{"answer": "recovered"}'

# 2.6 验证答案可以获取
curl -X POST http://localhost:3000/api/internal/inbox-ask \
  -H "Content-Type: application/json" \
  -d '{"questionId": "{questionId}"}'
```

### 测试 3: SSE 实时推送

**目的:** 验证 SSE 正确推送 inbox_ask 和 inbox_answer 事件

**步骤:**
```bash
# 3.1 打开 SSE 连接（终端1）
curl -N http://localhost:3000/api/executions/test-exec-003/stream

# 3.2 创建问题（终端2）
curl -X POST http://localhost:3000/api/internal/inbox-ask \
  -H "Content-Type: application/json" \
  -d '{"create": true, "executionId": "test-exec-003", "question": "SSE测试"}'

# 预期: 终端1 收到 {"type":"inbox_ask","node_id":"agent","text":"SSE测试"}

# 3.3 回答问题（终端2）
curl -X POST http://localhost:3000/api/executions/test-exec-003/elicitations/{questionId}/reply \
  -H "Content-Type: application/json" \
  -d '{"answer": "SSE answer"}'

# 预期: 终端1 收到 {"type":"inbox_answer","node_id":"human","text":"SSE answer"}
```

### 测试 4: 执行状态同步

**目的:** 验证 graph-runner 正确设置 'waiting' 状态

**前提:** 需要有一个实际执行中的任务

**步骤:**
```bash
# 4.1 检查现有执行状态
curl http://localhost:3000/api/executions

# 4.2 找一个 'waiting' 状态的执行，验证有 pending 问题
curl http://localhost:3000/api/executions/{executionId}/elicitations

# 4.3 回答所有问题后，验证状态恢复
```

### 测试 5: 孤儿检测服务

**目的:** 验证孤儿检测在服务启动时运行

**步骤:**
```bash
# 5.1 查看日志中的孤儿检测输出
grep "orphan-detection" /tmp/xuanji-core.log

# 预期输出:
# [orphan-detection] 开始检测孤儿问题...
# [orphan-detection] 定期清理任务已启动（每 5 分钟）
# [orphan-detection] 发现 N 个孤儿问题
# [orphan-detection] 孤儿问题检测完成
```

## 自动化测试脚本

```bash
#!/bin/bash
# run-e2e-test.sh

set -e

API_URL="http://localhost:3000"
TEST_EXEC_ID="e2e-test-$(date +%s)"

echo "=== E2E 测试开始 ==="
echo "测试执行 ID: $TEST_EXEC_ID"

# 测试 1: 创建问题
echo -e "\n[测试 1] 创建问题..."
RESPONSE=$(curl -s -X POST "$API_URL/api/internal/inbox-ask" \
  -H "Content-Type: application/json" \
  -d "{\"create\": true, \"executionId\": \"$TEST_EXEC_ID\", \"question\": \"E2E测试问题\", \"choices\": [\"选项A\", \"选项B\"]}" \
  --max-time 35)

QUESTION_ID=$(echo $RESPONSE | jq -r '.questionId')
echo "问题 ID: $QUESTION_ID"

if [ "$QUESTION_ID" == "null" ] || [ -z "$QUESTION_ID" ]; then
  echo "❌ 创建问题失败"
  echo "响应: $RESPONSE"
  exit 1
fi
echo "✅ 问题创建成功"

# 测试 2: 验证问题存在
echo -e "\n[测试 2] 验证问题存在..."
QUESTIONS=$(curl -s "$API_URL/api/executions/$TEST_EXEC_ID/elicitations")
FOUND=$(echo $QUESTIONS | jq -r ".[] | select(.id == \"$QUESTION_ID\") | .id")

if [ "$FOUND" != "$QUESTION_ID" ]; then
  echo "❌ 问题未找到"
  exit 1
fi
echo "✅ 问题验证成功"

# 测试 3: 回答问题
echo -e "\n[测试 3] 回答问题..."
ANSWER_RESP=$(curl -s -X POST "$API_URL/api/executions/$TEST_EXEC_ID/elicitations/$QUESTION_ID/reply" \
  -H "Content-Type: application/json" \
  -d '{"answer": "选项A"}')

NEW_STATUS=$(echo $ANSWER_RESP | jq -r '.status')
if [ "$NEW_STATUS" != "answered" ]; then
  echo "❌ 回答失败"
  exit 1
fi
echo "✅ 问题回答成功"

# 测试 4: 轮询获取答案
echo -e "\n[测试 4] 轮询获取答案..."
POLL_RESP=$(curl -s -X POST "$API_URL/api/internal/inbox-ask" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\": \"$QUESTION_ID\"}")

POLL_STATUS=$(echo $POLL_RESP | jq -r '.status')
POLL_ANSWER=$(echo $POLL_RESP | jq -r '.answer')

if [ "$POLL_STATUS" != "answered" ] || [ "$POLL_ANSWER" != "选项A" ]; then
  echo "❌ 轮询失败"
  echo "响应: $POLL_RESP"
  exit 1
fi
echo "✅ 轮询成功，答案: $POLL_ANSWER"

# 测试 5: 验证孤儿检测
echo -e "\n[测试 5] 验证孤儿检测服务..."
if grep -q "orphan-detection" /tmp/xuanji-core.log 2>/dev/null; then
  echo "✅ 孤儿检测服务运行中"
else
  echo "⚠️ 孤儿检测日志未找到（可能日志路径不同）"
fi

echo -e "\n=== E2E 测试全部通过 ==="
```

## 手动测试检查清单

使用 Dashboard 进行手动测试：

1. [ ] 打开 http://localhost:5173
2. [ ] 创建一个需求或选择现有执行
3. [ ] 触发 inbox_ask（通过 Agent 执行）
4. [ ] 在 Inbox 页面查看待回答问题
5. [ ] 回答问题
6. [ ] 验证 Canvas 页面实时更新
7. [ ] 重启 Core 服务，验证问题仍存在
8. [ ] 回答问题后验证 Agent 能收到

## 预期结果

| 测试项 | 预期结果 | 通过标准 |
|--------|----------|----------|
| API 创建模式 | 返回 questionId，状态 pending | HTTP 200 |
| API 轮询模式 | 返回答案或继续等待 | HTTP 200 |
| 问题列表 | 包含创建的问题 | JSON 数组 |
| 回答提交 | 状态变为 answered | HTTP 200 |
| SSE 推送 | 收到 inbox_ask/inbox_answer 事件 | 实时推送 |
| 服务重启 | 问题不丢失，孤儿检测运行 | 问题仍可查询 |
| 状态同步 | waiting 状态正确设置和恢复 | 状态正确 |

## 测试数据清理

```bash
# 清理测试数据
psql -h localhost -p 5433 -U v2 -d xuanji -c "DELETE FROM inbox_questions WHERE execution_id LIKE 'test-exec-%' OR execution_id LIKE 'e2e-test-%';"
```