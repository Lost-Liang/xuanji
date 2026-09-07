<script setup lang="ts">
// core/web/src/components/RequirementTreeView.vue —— 需求树状视图
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, type RequirementTree, type EpicNode, type FeatureNode, type UserStoryNode, type TaskNode } from '../api/requirements'

const props = defineProps<{
  requirementId: string
}>()

const emit = defineEmits<{
  (e: 'openChat', taskId: string): void
  (e: 'openLog', taskId: string): void
}>()

const router = useRouter()
const tree = ref<RequirementTree | null>(null)
const loading = ref(false)
const expandedNodes = ref<Set<string>>(new Set())

async function loadTree() {
  loading.value = true
  try {
    tree.value = await api.getTree(props.requirementId)
    // 默认展开所有节点
    expandAll()
  } catch (e) {
    console.error('加载需求树失败', e)
  } finally {
    loading.value = false
  }
}

function expandAll() {
  if (!tree.value) return
  const set = new Set<string>()
  tree.value.epics.forEach(epic => {
    set.add(epic.id)
    epic.features.forEach(f => set.add(f.id))
    epic.orphan_user_stories.forEach(s => set.add(s.id))
  })
  expandedNodes.value = set
}

function toggleNode(id: string) {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id)
  } else {
    expandedNodes.value.add(id)
  }
}

function isExpanded(id: string): boolean {
  return expandedNodes.value.has(id)
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待执行', running: '执行中', completed: '已完成',
    failed: '失败', paused: '已暂停', stopped: '已停止',
  }
  return map[status] || status
}

function statusClass(status: string): string {
  return status
}

function goToTask(task: TaskNode) {
  if (task.execution_id) {
    router.push(`/tasks/${task.execution_id}`)
  }
}

watch(() => props.requirementId, () => {
  if (props.requirementId) loadTree()
}, { immediate: true })
</script>

<template>
  <div class="tree-view" v-loading="loading">
    <div v-if="!loading && tree">
      <!-- 需求根节点 -->
      <div class="tree-root">
        <span class="root-label">需求</span>
        <span class="root-title">{{ tree.requirement.input_text }}</span>
      </div>

      <!-- 史诗列表 -->
      <div v-if="tree.epics.length === 0" class="empty-tree">
        <p>暂无分解结构</p>
        <p class="hint">执行需求后将自动生成史诗、特性、用户故事和任务</p>
      </div>

      <template v-for="epic in tree.epics" :key="epic.id">
        <!-- 史诗节点 -->
        <div class="tree-node level-epic" :class="{ expanded: isExpanded(epic.id) }">
          <div class="node-header" @click="toggleNode(epic.id)">
            <span class="toggle-btn">{{ isExpanded(epic.id) ? '−' : '+' }}</span>
            <span class="level-badge epic">史诗</span>
            <span class="node-title">{{ epic.title }}</span>
            <span class="node-status" :class="statusClass(epic.status)">{{ statusText(epic.status) }}</span>
            <span v-if="epic.module" class="node-module">{{ epic.module }}</span>
          </div>

          <div class="node-children" v-show="isExpanded(epic.id)">
            <!-- 特性列表 -->
            <div v-for="feature in epic.features" :key="feature.id" class="tree-node level-feature" :class="{ expanded: isExpanded(feature.id) }">
              <div class="node-header" @click="toggleNode(feature.id)">
                <span class="toggle-btn">{{ isExpanded(feature.id) ? '−' : '+' }}</span>
                <span class="level-badge feature">特性</span>
                <span class="node-title">{{ feature.title }}</span>
                <span class="node-status" :class="statusClass(feature.status)">{{ statusText(feature.status) }}</span>
              </div>

              <div class="node-children" v-show="isExpanded(feature.id)">
                <!-- 用户故事列表 -->
                <div v-for="story in feature.user_stories" :key="story.id" class="tree-node level-story">
                  <div class="node-header story-header">
                    <span class="level-badge story">故事</span>
                    <span class="node-title">{{ story.title }}</span>
                    <span class="priority-tag">{{ story.priority }}</span>
                    <span class="node-status" :class="statusClass(story.status)">{{ statusText(story.status) }}</span>
                  </div>

                  <div class="story-detail" v-if="story.as_a || story.i_want || story.so_that">
                    <p v-if="story.as_a"><strong>作为</strong> {{ story.as_a }}</p>
                    <p v-if="story.i_want"><strong>我想要</strong> {{ story.i_want }}</p>
                    <p v-if="story.so_that"><strong>以便</strong> {{ story.so_that }}</p>
                  </div>

                  <!-- 任务列表 -->
                  <div class="task-list">
                    <div v-for="task in story.tasks" :key="task.id" class="task-item" @click="goToTask(task)">
                      <span class="level-badge task">任务</span>
                      <span class="task-title">{{ task.title }}</span>
                      <span class="node-status" :class="statusClass(task.status)">{{ statusText(task.status) }}</span>
                      <span v-if="task.estimated_hours" class="task-hours">{{ task.estimated_hours }}h</span>
                      <div class="task-actions" @click.stop>
                        <button class="action-btn" @click="emit('openLog', task.execution_id || '')">日志</button>
                      </div>
                    </div>
                    <div v-if="story.tasks.length === 0" class="no-tasks">无任务</div>
                  </div>
                </div>
                <div v-if="feature.user_stories.length === 0" class="no-children">无用户故事</div>
              </div>
            </div>

            <!-- 孤立的用户故事（直接属于 epic） -->
            <div v-for="story in epic.orphan_user_stories" :key="story.id" class="tree-node level-story">
              <div class="node-header story-header">
                <span class="level-badge story">故事</span>
                <span class="node-title">{{ story.title }}</span>
                <span class="priority-tag">{{ story.priority }}</span>
              </div>
              <div class="task-list">
                <div v-for="task in story.tasks" :key="task.id" class="task-item" @click="goToTask(task)">
                  <span class="level-badge task">任务</span>
                  <span class="task-title">{{ task.title }}</span>
                  <span class="node-status" :class="statusClass(task.status)">{{ statusText(task.status) }}</span>
                </div>
              </div>
            </div>

            <div v-if="epic.features.length === 0 && epic.orphan_user_stories.length === 0" class="no-children">
              无特性和用户故事
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tree-view {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-height: 200px;
}

.tree-root {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.root-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  padding: 3px 8px;
  background: rgba(34, 211, 238, 0.15);
  border-radius: 4px;
}

.root-title {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}

.empty-tree {
  padding: 40px 20px;
  text-align: center;
  color: var(--muted);
}

.empty-tree .hint {
  font-size: 12px;
  margin-top: 8px;
}

.tree-node {
  border-bottom: 1px solid var(--border);
}

.tree-node:last-child {
  border-bottom: none;
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.16s;
  border-left: 3px solid transparent;
}

.node-header:hover {
  background: var(--surface);
}

.toggle-btn {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
  flex-shrink: 0;
}

.level-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.level-badge.epic {
  background: rgba(103, 194, 96, 0.15);
  color: #67c23a;
}

.level-badge.feature {
  background: rgba(230, 162, 60, 0.15);
  color: #e6a23c;
}

.level-badge.story {
  background: rgba(155, 89, 182, 0.15);
  color: #9b59b6;
}

.level-badge.task {
  background: var(--surface);
  color: var(--muted);
}

.node-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-status {
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 8px;
  border-radius: 3px;
  flex-shrink: 0;
}

.node-status.pending { background: var(--surface); color: var(--muted); }
.node-status.running { background: rgba(34, 211, 238, 0.15); color: var(--st-running); }
.node-status.completed { background: rgba(34, 197, 94, 0.15); color: var(--st-done); }
.node-status.failed { background: rgba(239, 68, 68, 0.15); color: var(--st-failed); }
.node-status.paused { background: rgba(245, 158, 11, 0.15); color: var(--st-paused); }

.node-module {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}

.level-epic .node-header { border-left-color: #67c23a; }
.level-feature .node-header { border-left-color: #e6a23c; padding-left: 32px; }
.level-story .node-header { border-left-color: #9b59b6; padding-left: 52px; }

.node-children {
  background: rgba(0, 0, 0, 0.02);
}

.story-header {
  cursor: default;
}

.story-detail {
  padding: 8px 16px 8px 72px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.story-detail p {
  margin: 2px 0;
}

.story-detail strong {
  color: var(--text);
}

.priority-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  flex-shrink: 0;
}

.task-list {
  padding: 4px 16px 12px 72px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-top: 4px;
  background: var(--panel);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.16s;
}

.task-item:hover {
  background: var(--surface);
  transform: translateX(2px);
}

.task-title {
  flex: 1;
  font-size: 13px;
  color: var(--text);
}

.task-hours {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent);
}

.task-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
}

.action-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.no-tasks, .no-children {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--faint);
}
</style>