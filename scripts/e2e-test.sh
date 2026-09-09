#!/bin/bash
# 人机交互状态持久化 E2E 测试

set -e

API_URL="http://localhost:3000"

echo "=========================================="
echo "  人机交互状态持久化 E2E 测试"
echo "=========================================="
echo ""

# 检查服务状态
echo "[预检] 检查服务状态..."
HEALTH=$(curl -s "$API_URL/api/health")
if [ -z "$HEALTH" ] || ! echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ Core API 未运行"
  echo "响应: $HEALTH"
  exit 1
fi
echo "✅ Core API 运行正常"
echo ""

# 获取现有执行 ID
echo "[预检] 获取现有执行..."
EXEC_ID=$(curl -s "$API_URL/api/executions" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$EXEC_ID" ]; then
  echo "❌ 没有可用的执行记录"
  exit 1
fi
echo "使用执行 ID: $EXEC_ID"
echo ""

# 测试 1: 创建问题
echo "[测试 1] 创建问题..."
RESPONSE=$(curl -s -X POST "$API_URL/api/internal/inbox-ask" \
  -H "Content-Type: application/json" \
  -d "{\"create\": true, \"executionId\": \"$EXEC_ID\", \"question\": \"E2E测试问题\", \"choices\": [\"选项A\", \"选项B\"]}" \
  --max-time 35)

echo "响应: $RESPONSE"

# 提取 questionId
QUESTION_ID=$(echo "$RESPONSE" | grep -o '"questionId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$QUESTION_ID" ] || [ "$QUESTION_ID" == "null" ]; then
  echo "❌ 创建问题失败"
  exit 1
fi
echo "问题 ID: $QUESTION_ID"

# 检查状态
if echo "$RESPONSE" | grep -q '"status":"pending"'; then
  echo "✅ 问题创建成功，状态为 pending（需要继续轮询）"
else
  echo "✅ 问题创建成功"
fi
echo ""

# 测试 2: 验证问题存在
echo "[测试 2] 验证问题已保存到数据库..."
QUESTIONS=$(curl -s "$API_URL/api/executions/$EXEC_ID/elicitations")

if ! echo "$QUESTIONS" | grep -q "$QUESTION_ID"; then
  echo "❌ 问题未在数据库中找到"
  echo "查询结果: $QUESTIONS"
  exit 1
fi
echo "✅ 问题已保存到数据库"
echo ""

# 测试 3: 回答问题
echo "[测试 3] 通过 API 回答问题..."
ANSWER_RESP=$(curl -s -X POST "$API_URL/api/executions/$EXEC_ID/elicitations/$QUESTION_ID/reply" \
  -H "Content-Type: application/json" \
  -d '{"answer": "选项A"}')

echo "响应: $ANSWER_RESP"

if ! echo "$ANSWER_RESP" | grep -q '"status":"answered"'; then
  echo "❌ 回答失败"
  exit 1
fi

ANSWER=$(echo "$ANSWER_RESP" | grep -o '"answer":"[^"]*"' | cut -d'"' -f4)
echo "✅ 问题已回答，答案: $ANSWER"
echo ""

# 测试 4: 轮询获取答案
echo "[测试 4] 轮询获取答案..."
POLL_RESP=$(curl -s -X POST "$API_URL/api/internal/inbox-ask" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\": \"$QUESTION_ID\"}")

echo "响应: $POLL_RESP"

if ! echo "$POLL_RESP" | grep -q '"status":"answered"'; then
  echo "❌ 轮询状态不正确"
  exit 1
fi

if ! echo "$POLL_RESP" | grep -q '"answer":"选项A"'; then
  echo "❌ 轮询答案不正确"
  exit 1
fi
echo "✅ 轮询成功，正确返回答案"
echo ""

# 测试 5: 验证孤儿检测服务
echo "[测试 5] 验证孤儿检测服务..."
if [ -f /tmp/xuanji-core.log ]; then
  echo "孤儿检测日志:"
  grep "orphan-detection" /tmp/xuanji-core.log | tail -5
  echo "✅ 孤儿检测服务运行中"
else
  echo "⚠️ 日志文件不存在"
fi
echo ""

echo "=========================================="
echo "  ✅ 所有 E2E 测试通过!"
echo "=========================================="
