<template>
  <div class="app">
    <aside class="side">
      <div class="brand">
        <img src="/favicon.svg" class="logo-icon" alt="璇玑">
        <div class="name">璇玑</div>
      </div>
      <nav class="nav">
        <router-link
          v-for="m in menus"
          :key="m.path"
          :to="m.path"
          class="nav-item"
          :class="{ active: activeMenu === m.match }"
        >
          <el-icon><component :is="m.icon" /></el-icon>
          <span class="label">{{ m.label }}</span>
          <span v-if="m.count" class="ct">{{ m.count }}</span>
        </router-link>
      </nav>
      <div class="host">
        <div class="host-label">璇玑 Core</div>
        <div class="host-row">
          <span class="host-dot" :class="hostStatus"></span>
          <span class="host-text">core · {{ hostStatusText }}</span>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="crumb">
          控制台<span class="sep">/</span><b>{{ currentTitle }}</b>
        </div>
      </div>
      <div class="content">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { Odometer, Document, List, Monitor, Setting, Collection, Operation, ChatDotRound, Folder } from '@element-plus/icons-vue'

const route = useRoute()

const menus: { path: string; match: string; label: string; icon: any; count?: number }[] = [
  { path: '/canvas', match: '/canvas', label: '流程画布', icon: Odometer },
  { path: '/projects', match: '/projects', label: '项目管理', icon: Folder },
  { path: '/requirements', match: '/requirements', label: '需求管理', icon: Document },
  { path: '/tasks', match: '/tasks', label: '任务列表', icon: List },
  { path: '/executions', match: '/executions', label: '执行概览', icon: Monitor },
  { path: '/inbox', match: '/inbox', label: '人机交互', icon: ChatDotRound },
  { path: '/agents', match: '/agents', label: 'Agent配置', icon: Setting },
  { path: '/skills', match: '/skills', label: 'Skill配置', icon: Collection },
  { path: '/workflows', match: '/workflows', label: '工作流列表', icon: Operation },
]

const activeMenu = computed(() => {
  if (route.path.startsWith('/tasks')) return '/tasks'
  if (route.path.startsWith('/requirements')) return '/requirements'
  if (route.path.startsWith('/conversations/')) return '/inbox'
  return route.path
})

const titleMap: Record<string, string> = {
  '/canvas': '流程画布',
  '/projects': '项目管理',
  '/requirements': '需求管理',
  '/tasks': '任务列表',
  '/executions': '执行概览',
  '/inbox': '人机交互',
  '/agents': 'Agent配置',
  '/skills': 'Skill配置',
  '/workflows': '工作流列表',
}
const currentTitle = computed(() => {
  if (route.path.startsWith('/tasks')) return '任务列表'
  if (route.path.startsWith('/requirements')) return '需求管理'
  if (route.path.startsWith('/conversations/')) return '对话历史'
  return titleMap[route.path] ?? ''
})

// Host 状态
const hostStatus = ref<'online' | 'offline' | 'checking'>('checking')
const hostStatusText = computed(() => {
  switch (hostStatus.value) {
    case 'online': return 'online'
    case 'offline': return 'offline'
    default: return 'checking…'
  }
})

async function checkHostStatus() {
  try {
    const res = await fetch('/api/health')
    const data = await res.json()
    hostStatus.value = data.status === 'ok' ? 'online' : 'offline'
  } catch {
    hostStatus.value = 'offline'
  }
}

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  checkHostStatus()
  timer = setInterval(checkHostStatus, 30000)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: 100vh;
  overflow: hidden;
}

/* ---------- sidebar ---------- */
.side {
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
}
.brand .logo-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}
.brand .name {
  font-family: var(--font-ui);
  font-weight: 700;
  font-size: 15px;
  letter-spacing: .02em;
  color: var(--text);
}

.nav {
  padding: 10px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 11px;
  border-radius: 7px;
  color: var(--muted);
  font-size: 13.5px;
  font-family: var(--font-ui);
  font-weight: 500;
  text-decoration: none;
  border: 1px solid transparent;
  transition: background .16s, color .16s, border-color .16s;
}
.nav-item .el-icon { font-size: 17px; flex-shrink: 0; }
.nav-item:hover {
  background: var(--surface);
  color: var(--text);
}
.nav-item.active {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--border);
}
.nav-item.active .el-icon {
  color: var(--accent);
}
.nav-item .ct {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
}

.host {
  margin: 8px 10px 12px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.host-label {
  color: var(--faint);
  text-transform: uppercase;
  letter-spacing: .1em;
  font-size: 9.5px;
  font-family: var(--font-ui);
  margin-bottom: 5px;
}
.host-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.host-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.host-dot.online { background: var(--st-done); box-shadow: 0 0 8px var(--st-done); animation: v2-pulse 2.4s infinite; }
.host-dot.offline { background: var(--st-failed); }
.host-dot.checking { background: var(--st-paused); animation: v2-pulse 1s infinite; }

/* ---------- main ---------- */
.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.topbar {
  height: 52px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 22px;
  background: var(--bg);
  flex-shrink: 0;
}
.crumb {
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 9px;
}
.crumb b { color: var(--text); font-weight: 600; }
.crumb .sep { color: var(--faint); }

.content {
  flex: 1;
  overflow: auto;
  padding: 22px 26px;
}
</style>
