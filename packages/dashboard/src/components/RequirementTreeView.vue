<script setup lang="ts">
// core/web/src/components/RequirementTreeView.vue —— 全宽需求树视图（V4 重写）
// 5 级树：需求 → 史诗 → 特性 → 用户故事 → 任务
// 行级操作按钮 + 内部日志抽屉管理
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api as reqApi, type RequirementListItem, type RequirementTree, type EpicNode, type FeatureNode, type UserStoryNode, type TaskNode } from '../api/requirements'
import { api as taskApi } from '../api/tasks'
import { openLogDrawer as openTaskLogDrawerGlobal } from '../stores/tasks'
import RequirementLogDrawer from './drawers/RequirementLogDrawer.vue'
import LogDrawer from './drawers/LogDrawer.vue'

const props = defineProps<{
  requirements: RequirementListItem[]
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const router = useRouter()
const loading = ref(false)
const treeData = ref<Map<string, RequirementTree>>(new Map())
const expandedNodes = ref<Set<string>>(new Set())

// 内部日志抽屉（需求级）
const logDrawerVisible = ref(false)
const logDrawerReqId = ref('')

function openLogDrawer(reqId: string) {
  logDrawerReqId.value = reqId
  logDrawerVisible.value = true
}

// 任务级日志：通过全局 store 打开 LogDrawer（本组件挂载了 LogDrawer 实例）
function openTaskLogDrawer(execId: string) {
  if (!execId) return
  // LogDrawer 由 stores/tasks 的 showLogDrawer 驱动，仅消费 id/status/rate_limited_until
  openTaskLogDrawerGlobal({
    id: execId,
    status: '',
    rate_limited_until: null,
  } as any)
}

// 全量加载所有需求的分解树
async function loadAllTrees() {
  loading.value = true
  try {
    const trees = await Promise.all(props.requirements.map(r => reqApi.getTree(r.id)))
    const map = new Map<string, RequirementTree>()
    trees.forEach(t => map.set(t.requirement.id, t))
    treeData.value = map
    // 默认展开所有需求行
    props.requirements.forEach(r => expandedNodes.value.add(r.id))
  } catch (e) {
    ElMessage.error('加载分解结构失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadAllTrees)
watch(() => props.requirements.length, loadAllTrees)

// 展开/折叠
function toggle(nodeId: string) {
  if (expandedNodes.value.has(nodeId)) {
    expandedNodes.value.delete(nodeId)
  } else {
    expandedNodes.value.add(nodeId)
  }
}

function isExpanded(nodeId: string): boolean {
  return expandedNodes.value.has(nodeId)
}

// 状态标签（中文）
const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待执行', running: '执行中',
  completed: '已完成', failed: '失败', cancelled: '已取消',
  waiting: '等待回答', paused: '已暂停', stopped: '已停止',
  planned: '待执行',
}

function statusLabel(s: string): string {
  return statusLabels[s] || s || '-'
}

function statusClass(s: string): string {
  return `st-${s}`
}

// 判断需求是否可执行
function canExecute(req: RequirementListItem): boolean {
  const s = req.execution_status || req.status
  return !s || s === 'draft' || s === 'pending' || s === 'failed' || s === 'cancelled' || s === 'stopped'
}

// 行交互：任务跳转、其他展开/折叠
function handleRowClick(level: string, node: any) {
  if (level === 'task' && node.execution_id) {
    router.push(`/tasks/${node.execution_id}`)
  } else {
    toggle(node.id)
  }
}

// Actions —— 需求级
async function executeRequirement(reqId: string) {
  try {
    await reqApi.execute(reqId)
    ElMessage.success('执行已启动')
    emit('refresh')
  } catch (e) {
    ElMessage.error('启动失败')
  }
}

async function stopRequirement(reqId: string) {
  try {
    await reqApi.stop(reqId)
    ElMessage.success('已停止')
    emit('refresh')
  } catch (e) {
    ElMessage.error('停止失败')
  }
}

async function confirmAllTasks(reqId: string) {
  try {
    const res = await reqApi.confirmAll(reqId)
    ElMessage.success(res.message || `已确认 ${res.confirmed_count} 个任务`)
    await loadAllTrees()
  } catch (e) {
    ElMessage.error('确认失败')
  }
}

async function deleteRequirement(reqId: string) {
  try {
    await ElMessageBox.confirm('确定删除该需求？所有关联执行将被取消。', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await reqApi.delete(reqId)
    ElMessage.success('已删除')
    emit('refresh')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

// Actions —— 任务级
async function confirmTask(execId: string) {
  try {
    await taskApi.confirm(execId)
    ElMessage.success('已确认')
    await loadAllTrees()
  } catch (e) {
    ElMessage.error('确认失败')
  }
}

async function executeTask(execId: string) {
  try {
    await taskApi.execute(execId)
    ElMessage.success('执行已启动')
    await loadAllTrees()
  } catch (e) {
    ElMessage.error('启动失败')
  }
}

async function deleteTask(execId: string) {
  try {
    await ElMessageBox.confirm('确定删除该任务？', '删除确认', {
      type: 'warning',
    })
    await taskApi.delete(execId)
    ElMessage.success('已删除')
    await loadAllTrees()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

// 判断是否有 draft 任务（用于显示"确认任务"按钮）
function hasDraftTasks(tree: RequirementTree): boolean {
  for (const epic of tree.epics) {
    for (const feature of epic.features) {
      for (const story of feature.user_stories) {
        if (story.tasks.some(t => t.status === 'draft')) return true
      }
    }
    for (const story of epic.orphan_user_stories) {
      if (story.tasks.some(t => t.status === 'draft')) return true
    }
  }
  return false
}
</script>

<template>
  <div class="req-tree" v-loading="loading">
    <div v-if="requirements.length === 0 && !loading" class="empty-state">
      暂无需求，使用上方表单创建
    </div>

    <template v-for="req in requirements" :key="req.id">
      <!-- 需求行 -->
      <div
        class="tree-row level-requirement"
        :class="{ 'is-running': (req.execution_status || req.status) === 'running' }"
        @click="handleRowClick('requirement', req)"
      >
        <span class="toggle-icon">{{ isExpanded(req.id) ? '▼' : '▶' }}</span>
        <span class="level-badge requirement">需求</span>
        <span class="title">{{ req.input_text }}</span>
        <span class="status-chip" :class="statusClass(req.execution_status || req.status)">
          {{ statusLabel(req.execution_status || req.status) }}
        </span>
        <span class="created-at">{{ req.created_at ? new Date(req.created_at).toLocaleDateString() : '' }}</span>
        <div class="actions" @click.stop>
          <el-button v-if="canExecute(req)" size="small" type="primary" @click="executeRequirement(req.id)">执行</el-button>
          <el-button v-if="req.execution_status === 'running' || req.execution_status === 'pending'" size="small" type="warning" @click="stopRequirement(req.id)">停止</el-button>
          <el-button v-if="treeData.get(req.id) && hasDraftTasks(treeData.get(req.id)!)" size="small" type="primary" @click="confirmAllTasks(req.id)">确认任务</el-button>
          <el-button size="small" @click="openLogDrawer(req.id)">日志</el-button>
          <el-button v-if="req.execution_id" size="small" @click="router.push('/canvas')">画布</el-button>
          <el-button size="small" type="danger" @click="deleteRequirement(req.id)">删除</el-button>
        </div>
      </div>

      <!-- 分解树（展开时显示） -->
      <template v-if="isExpanded(req.id) && treeData.has(req.id)">
        <template v-for="epic in treeData.get(req.id)!.epics" :key="epic.id">
          <!-- Epic 行 -->
          <div
            class="tree-row level-epic"
            :class="{ 'is-running': epic.status === 'running' }"
            @click="toggle(epic.id)"
          >
            <span class="toggle-icon" style="padding-left: 20px">{{ isExpanded(epic.id) ? '▼' : '▶' }}</span>
            <span class="level-badge epic">史诗</span>
            <span class="title">{{ epic.title }}</span>
            <span class="status-chip" :class="statusClass(epic.status)">{{ statusLabel(epic.status) }}</span>
            <span v-if="epic.module" class="module-tag">{{ epic.module }}</span>
          </div>

          <template v-if="isExpanded(epic.id)">
            <template v-for="feature in epic.features" :key="feature.id">
              <!-- Feature 行 -->
              <div
                class="tree-row level-feature"
                :class="{ 'is-running': feature.status === 'running' }"
                @click="toggle(feature.id)"
              >
                <span class="toggle-icon" style="padding-left: 40px">{{ isExpanded(feature.id) ? '▼' : '▶' }}</span>
                <span class="level-badge feature">特性</span>
                <span class="title">{{ feature.title }}</span>
                <span class="status-chip" :class="statusClass(feature.status)">{{ statusLabel(feature.status) }}</span>
              </div>

              <template v-if="isExpanded(feature.id)">
                <template v-for="story in feature.user_stories" :key="story.id">
                  <!-- UserStory 行 -->
                  <div
                    class="tree-row level-story"
                    :class="{ 'is-running': story.status === 'running' }"
                    @click="toggle(story.id)"
                  >
                    <span class="toggle-icon" style="padding-left: 60px">{{ isExpanded(story.id) ? '▼' : '▶' }}</span>
                    <span class="level-badge story">故事</span>
                    <span class="title">{{ story.title }}</span>
                    <span class="priority-tag">{{ story.priority }}</span>
                    <span class="status-chip" :class="statusClass(story.status)">{{ statusLabel(story.status) }}</span>
                  </div>

                  <template v-if="isExpanded(story.id)">
                    <div v-for="task in story.tasks" :key="task.id"
                      class="tree-row level-task"
                      :class="{ 'is-running': task.status === 'running' }"
                      @click="handleRowClick('task', task)"
                    >
                      <span class="toggle-icon" style="padding-left: 80px"></span>
                      <span class="level-badge task">任务</span>
                      <span class="title">{{ task.title || '(无标题)' }}</span>
                      <span v-if="task.estimated_hours" class="hours-tag">{{ task.estimated_hours }}h</span>
                      <span class="status-chip" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
                      <div class="actions" @click.stop>
                        <el-button v-if="task.status === 'draft'" size="small" type="primary" @click="confirmTask(task.execution_id!)">确认</el-button>
                        <el-button v-if="task.status === 'pending'" size="small" type="primary" @click="executeTask(task.execution_id!)">执行</el-button>
                        <el-button v-if="task.execution_id" size="small" @click="openTaskLogDrawer(task.execution_id)">日志</el-button>
                        <el-button v-if="task.status !== 'running' && task.execution_id" size="small" type="danger" @click="deleteTask(task.execution_id)">删除</el-button>
                      </div>
                    </div>
                    <div v-if="story.tasks.length === 0" class="no-items">无任务</div>
                  </template>
                </template>
              </template>
            </template>

            <!-- 孤立用户故事（直接属于 epic） -->
            <template v-for="story in epic.orphan_user_stories" :key="story.id">
              <div
                class="tree-row level-story orphan"
                :class="{ 'is-running': story.status === 'running' }"
                @click="toggle(story.id)"
              >
                <span class="toggle-icon" style="padding-left: 40px">{{ isExpanded(story.id) ? '▼' : '▶' }}</span>
                <span class="level-badge story">故事</span>
                <span class="title">{{ story.title }}</span>
                <span class="priority-tag">{{ story.priority }}</span>
                <span class="status-chip" :class="statusClass(story.status)">{{ statusLabel(story.status) }}</span>
              </div>

              <template v-if="isExpanded(story.id)">
                <div v-for="task in story.tasks" :key="task.id"
                  class="tree-row level-task"
                  :class="{ 'is-running': task.status === 'running' }"
                  @click="handleRowClick('task', task)"
                >
                  <span class="toggle-icon" style="padding-left: 60px"></span>
                  <span class="level-badge task">任务</span>
                  <span class="title">{{ task.title || '(无标题)' }}</span>
                  <span v-if="task.estimated_hours" class="hours-tag">{{ task.estimated_hours }}h</span>
                  <span class="status-chip" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
                  <div class="actions" @click.stop>
                    <el-button v-if="task.status === 'draft'" size="small" type="primary" @click="confirmTask(task.execution_id!)">确认</el-button>
                    <el-button v-if="task.status === 'pending'" size="small" type="primary" @click="executeTask(task.execution_id!)">执行</el-button>
                    <el-button v-if="task.execution_id" size="small" @click="openTaskLogDrawer(task.execution_id)">日志</el-button>
                    <el-button v-if="task.status !== 'running' && task.execution_id" size="small" type="danger" @click="deleteTask(task.execution_id)">删除</el-button>
                  </div>
                </div>
              </template>
            </template>
          </template>
        </template>
      </template>
    </template>

    <!-- 内部日志抽屉（需求级） -->
    <RequirementLogDrawer
      v-model="logDrawerVisible"
      :requirement-id="logDrawerReqId"
    />

    <!-- 任务级日志抽屉（全局 store 驱动，此处挂载以便在需求页可用） -->
    <LogDrawer />
  </div>
</template>

<style scoped>
.req-tree {
  padding: 16px 0;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--muted, #94A3B8);
  font-size: 13px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.2s;
}

.tree-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tree-row.is-running {
  background: color-mix(in srgb, var(--st-running, #22D3EE) 8%, transparent);
  animation: breathe 2s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { background: color-mix(in srgb, var(--st-running, #22D3EE) 8%, transparent); }
  50% { background: color-mix(in srgb, var(--st-running, #22D3EE) 15%, transparent); }
}

/* 层级左竖条颜色 */
.level-requirement { border-left-color: var(--accent, #22D3EE); }
.level-epic { border-left-color: var(--st-done, #22C55E); }
.level-feature { border-left-color: var(--st-paused, #F59E0B); }
.level-story { border-left-color: var(--ai, #7C3AED); }
.level-task { border-left-color: var(--st-pending, #64748B); }

.toggle-icon {
  width: 16px;
  font-size: 12px;
  color: var(--muted, #94A3B8);
  flex-shrink: 0;
  text-align: center;
}

.level-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.level-badge.requirement { background: color-mix(in srgb, var(--accent, #22D3EE) 20%, transparent); color: var(--accent, #22D3EE); }
.level-badge.epic { background: color-mix(in srgb, var(--st-done, #22C55E) 20%, transparent); color: var(--st-done, #22C55E); }
.level-badge.feature { background: color-mix(in srgb, var(--st-paused, #F59E0B) 20%, transparent); color: var(--st-paused, #F59E0B); }
.level-badge.story { background: color-mix(in srgb, var(--ai, #7C3AED) 20%, transparent); color: var(--ai, #7C3AED); }
.level-badge.task { background: color-mix(in srgb, var(--st-pending, #64748B) 20%, transparent); color: var(--st-pending, #64748B); }

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text, #F8FAFC);
}

.status-chip {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
}

.status-chip.st-running { background: color-mix(in srgb, var(--st-running, #22D3EE) 20%, transparent); color: var(--st-running, #22D3EE); }
.status-chip.st-completed { background: color-mix(in srgb, var(--st-done, #22C55E) 20%, transparent); color: var(--st-done, #22C55E); }
.status-chip.st-pending, .status-chip.st-planned { background: color-mix(in srgb, var(--st-pending, #64748B) 20%, transparent); color: var(--st-pending, #64748B); }
.status-chip.st-failed { background: color-mix(in srgb, var(--st-failed, #EF4444) 20%, transparent); color: var(--st-failed, #EF4444); }
.status-chip.st-paused { background: color-mix(in srgb, var(--st-paused, #F59E0B) 20%, transparent); color: var(--st-paused, #F59E0B); }
.status-chip.st-draft, .status-chip.st-cancelled, .status-chip.st-stopped { background: rgba(100, 116, 139, 0.1); color: #64748B; }
.status-chip.st-waiting { background: color-mix(in srgb, var(--ai, #7C3AED) 20%, transparent); color: var(--ai, #7C3AED); }

.created-at, .module-tag, .priority-tag, .hours-tag {
  font-size: 12px;
  color: var(--muted, #94A3B8);
  flex-shrink: 0;
}

.hours-tag {
  font-family: var(--font-mono, monospace);
  color: var(--accent, #22D3EE);
}

.priority-tag {
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  font-weight: 600;
  font-size: 10px;
}

.no-items {
  padding: 6px 16px 6px 92px;
  font-size: 12px;
  color: var(--faint, #64748B);
}

.actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

/* 孤立故事视觉区分 */
.tree-row.orphan {
  opacity: 0.85;
}
</style>
