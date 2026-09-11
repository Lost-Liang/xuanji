#!/bin/bash
# 璇玑 V4 启动脚本
# 用法: ./scripts/start.sh [--core-only|--dashboard-only|--all]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志目录
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 PostgreSQL
check_postgres() {
    print_info "检查 PostgreSQL..."
    if docker ps | grep -q postgres; then
        print_info "✓ PostgreSQL 正在运行"
        return 0
    else
        print_error "✗ PostgreSQL 未运行"
        print_info "请先启动 PostgreSQL: docker compose up -d postgres"
        return 1
    fi
}

# 检查数据库
check_database() {
    print_info "检查 xuanji 数据库..."
    if docker exec core-postgres-1 psql -U v2 -d v2 -c "\l" 2>/dev/null | grep -q xuanji; then
        print_info "✓ xuanji 数据库存在"
        return 0
    else
        print_warn "✗ xuanji 数据库不存在，正在创建..."
        docker exec core-postgres-1 psql -U v2 -d v2 -c "CREATE DATABASE xuanji;" >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            print_info "✓ xuanji 数据库已创建"
            return 0
        else
            print_error "✗ 创建数据库失败"
            return 1
        fi
    fi
}

# 初始化数据库
init_database() {
    print_info "初始化数据库 schema..."
    cd packages/core
    pnpm prisma db push >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        print_info "✓ 数据库 schema 已同步"
    else
        print_error "✗ 数据库初始化失败"
        return 1
    fi
    cd "$PROJECT_ROOT"
}

# 启动 Core API
start_core() {
    print_info "启动 Core API (端口 3000, tsx watch 热重载)..."
    pnpm --filter @xuanji/core dev > "$LOG_DIR/core.log" 2>&1 &
    CORE_PID=$!
    echo $CORE_PID > "$LOG_DIR/core.pid"
    sleep 2

    if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
        print_info "✓ Core API 启动成功 (PID: $CORE_PID)"
        return 0
    else
        print_error "✗ Core API 启动失败，查看日志: $LOG_DIR/core.log"
        return 1
    fi
}

# 启动 MCP Bridge
start_runner() {
    print_info "启动 MCP Bridge..."
    # MCP Bridge 按需启动，这里只验证 runner 包可用
    if pnpm --filter @xuanji/runner build > /dev/null 2>&1; then
        print_info "✓ Runner 包构建成功"
        return 0
    else
        print_error "✗ Runner 包构建失败"
        return 1
    fi
}

# 启动 Dashboard
start_dashboard() {
    print_info "启动 Dashboard (端口 5173)..."
    pnpm --filter @xuanji/dashboard dev > "$LOG_DIR/dashboard.log" 2>&1 &
    DASHBOARD_PID=$!
    echo $DASHBOARD_PID > "$LOG_DIR/dashboard.pid"
    sleep 3

    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        print_info "✓ Dashboard 启动成功 (PID: $DASHBOARD_PID)"
        return 0
    else
        print_error "✗ Dashboard 启动失败，查看日志: $LOG_DIR/dashboard.log"
        return 1
    fi
}

# 停止所有服务
stop_all() {
    print_info "停止所有服务..."

    if [ -f "$LOG_DIR/core.pid" ]; then
        kill $(cat "$LOG_DIR/core.pid") 2>/dev/null || true
        rm "$LOG_DIR/core.pid"
        print_info "✓ Core API 已停止"
    fi

    if [ -f "$LOG_DIR/dashboard.pid" ]; then
        kill $(cat "$LOG_DIR/dashboard.pid") 2>/dev/null || true
        rm "$LOG_DIR/dashboard.pid"
        print_info "✓ Dashboard 已停止"
    fi

    print_info "所有服务已停止"
}

# 显示状态
show_status() {
    print_info "=== 璇玑 V4 系统状态 ==="
    echo

    # Core API
    if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
        print_info "Core API:      ✓ 运行中 (http://localhost:3000)"
    else
        print_error "Core API:      ✗ 未运行"
    fi

    # Dashboard
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        print_info "Dashboard:     ✓ 运行中 (http://localhost:5173)"
    else
        print_error "Dashboard:     ✗ 未运行"
    fi

    # PostgreSQL
    if docker ps | grep -q postgres; then
        print_info "PostgreSQL:    ✓ 运行中 (端口 5433)"
    else
        print_error "PostgreSQL:    ✗ 未运行"
    fi

    echo
    print_info "=== 访问地址 ==="
    echo "  Dashboard:      http://localhost:5173"
    echo "  Inbox:          http://localhost:5173/inbox"
    echo "  API Health:     http://localhost:3000/api/health"
    echo "  API Docs:       http://localhost:3000/api"
    echo
}

# 主函数
main() {
    local mode="${1:---all}"

    case "$mode" in
        --core-only)
            check_postgres || exit 1
            check_database || exit 1
            init_database || exit 1
            start_core || exit 1
            ;;
        --dashboard-only)
            start_dashboard || exit 1
            ;;
        --stop)
            stop_all
            ;;
        --status)
            show_status
            ;;
        --all|*)
            check_postgres || exit 1
            check_database || exit 1
            init_database || exit 1
            start_core || exit 1
            start_runner || exit 1
            start_dashboard || exit 1
            show_status
            ;;
    esac
}

main "$@"
