<template>
  <div class="canvas-wrap">
    <div class="canvas-main">
      <VueFlow v-model:nodes="nodes" v-model:edges="edges"
        :default-edge-options="{ markerEnd: 'arrowclosed', animated: false }"
        :nodes-connectable="mode === 'static'"
        :nodes-draggable="mode === 'static'"
        :elements-deletable="mode === 'static'"
        :fit-view-on-init="true"
        @connect="onConnect" @node-drag-stop="onDragStop"
        @node-context-menu="onNodeContextMenu"
        @edge-context-menu="onEdgeContextMenu"
        @pane-context-menu="onPaneContextMenu"
        @node-click="onNodeClick" @edge-click="onEdgeClick">
        <template #node-agent="props"><AgentNode v-bind="props" /></template>
        <template #node-gate="props"><GateNode v-bind="props" /></template>
        <template #node-command="props"><CommandNode v-bind="props" /></template>
        <template #node-subgraph="props"><SubgraphNode v-bind="props" /></template>
        <template #edge-loop-edge="props"><LoopEdge v-bind="props" /></template>
      </VueFlow>
      <!-- 右键菜单 -->
      <ul v-if="ctxMenu.show" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <!-- 运行态：暂停/继续 -->
        <template v-if="mode === 'runtime'">
          <li @click="pauseExecution">暂停执行</li>
          <li @click="resumeExecution">继续执行</li>
        </template>
        <!-- 编辑态：画布空白区 -->
        <template v-else-if="ctxMenu.context === 'pane'">
          <li @click="ctxAddNode('agent')">添加 Agent 节点</li>
          <li @click="ctxAddNode('gate')">添加审批关卡</li>
          <li @click="ctxAddNode('command')">添加命令节点</li>
          <li @click="ctxAddNode('subgraph')">添加子工作流</li>
        </template>
        <!-- 编辑态：节点 -->
        <template v-else-if="ctxMenu.context === 'node'">
          <li @click="ctxCopyNode">复制节点</li>
          <li @click="ctxDeleteNode" class="danger">删除节点</li>
        </template>
        <!-- 编辑态：边 -->
        <template v-else-if="ctxMenu.context === 'edge'">
          <li @click="ctxEditEdge">配置条件</li>
          <li @click="ctxDeleteEdge" class="danger">删除连线</li>
        </template>
      </ul>
      <!-- 底部工具栏 -->
      <div class="bottom-toolbar">
        <div class="toolbar-left">
          <el-radio-group v-model="mode" size="small" @change="onModeChange">
            <el-radio-button value="static">编辑</el-radio-button>
            <el-radio-button value="runtime">运行态</el-radio-button>
          </el-radio-group>
          <template v-if="mode === 'static'">
            <el-select v-model="selectedGraphId" size="small" placeholder="选择图定义" @change="loadSelectedGraph" style="width: 180px;">
              <el-option v-for="g in graphDefs" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </template>
          <template v-if="mode === 'runtime'">
            <el-input v-model="executionId" placeholder="execution ID" size="small" class="rt-id" @keyup.enter="connectExecution" />
            <el-button size="small" :type="connected ? 'success' : 'default'" @click="connectExecution">{{ connected ? '断开' : '连接' }}</el-button>
            <span class="rt-meta" v-if="rtMeta">{{ rtMeta.status === 'running' ? '运行中' : rtMeta.status === 'completed' ? '已完成' : rtMeta.status === 'paused' ? '已暂停' : rtMeta.status === 'failed' ? '失败' : rtMeta.status }} · token {{ rtMeta.token_in != null ? rtMeta.token_in : '-' }}/{{ rtMeta.token_out != null ? rtMeta.token_out : '-' }}</span>
          </template>
        </div>
        <div class="toolbar-right">
          <el-button v-if="mode === 'static'" size="small" type="primary" class="save-btn" @click="save">保存</el-button>
        </div>
      </div>
    </div>
    <!-- 节点/边编辑模态框 -->
    <NodeEditModal
      :visible="showModal"
      :edit-type="modalType"
      :node-data="modalNodeData"
      :edge-data="modalEdgeData"
      @close="onModalClose"
      @save="onModalSave"
    />
    <!-- 运行态节点信息 -->
    <div v-if="mode === 'runtime'" class="runtime-panel">
      <div class="panel-title">执行信息</div>
      <template v-if="rtMeta">
        <div class="panel-row"><span class="label">状态</span>
          <el-tag :type="rtMeta.status === 'running' ? 'primary' : rtMeta.status === 'completed' ? 'success' : rtMeta.status === 'failed' ? 'danger' : rtMeta.status === 'paused' ? 'warning' : 'info'" size="small">
            {{ rtMeta.status === 'running' ? '运行中' : rtMeta.status === 'completed' ? '已完成' : rtMeta.status === 'paused' ? '已暂停' : rtMeta.status === 'failed' ? '失败' : rtMeta.status }}
          </el-tag>
        </div>
        <div class="panel-row" v-if="rtMeta.started_at"><span class="label">开始时间</span><span class="value">{{ formatTime(rtMeta.started_at) }}</span></div>
        <div class="panel-row" v-if="rtMeta.started_at && rtMeta.status === 'running'"><span class="label">已运行</span><span class="value">{{ elapsed(rtMeta.started_at) }}</span></div>
        <div class="panel-row" v-if="rtMeta.token_in != null"><span class="label">Token</span><span class="value">{{ rtMeta.token_in }} / {{ rtMeta.token_out }}</span></div>
        <div class="panel-row" v-if="rtMeta.current_node_id"><span class="label">当前节点</span><span class="value">{{ rtMeta.current_node_id }}</span></div>
      </template>
      <div class="panel-title" style="margin-top:12px;">节点状态</div>
      <div class="node-list">
        <div v-for="n in nodes" :key="n.id" class="node-list-item" :class="runtimePhases.get(n.id) || 'pending'"
          @click="selectNodeById(n.id)">
          <span class="node-status-dot" :class="runtimePhases.get(n.id) || 'pending'"></span>
          <span class="node-list-label">{{ n.data?.label || n.id }}</span>
          <span class="node-list-status">{{ nodeStatusLabel(n.type, runtimePhases.get(n.id)) }}</span>
        </div>
      </div>
      <template v-if="selectedNode">
        <div class="panel-title" style="margin-top:12px;">节点详情</div>
        <div class="panel-row"><span class="label">节点 ID</span><span class="value">{{ selectedNode.id }}</span></div>
        <div class="panel-row"><span class="label">类型</span><span class="value">{{ selectedNode.type }}</span></div>
        <div class="panel-row"><span class="label">状态</span>
          <el-tag :type="selectedNode.data?.status === 'running' ? 'primary' : selectedNode.data?.status === 'done' ? 'success' : selectedNode.data?.status === 'failed' ? 'danger' : selectedNode.data?.status === 'paused' ? 'warning' : 'info'" size="small">
            {{ statusLabel(selectedNode.data?.status) }}
          </el-tag>
        </div>
        <div class="panel-row" v-if="selectedNode.data?.badge"><span class="label">信息</span><span class="value">{{ selectedNode.data.badge }}</span></div>
        <div class="panel-row" v-if="selectedNode.data?.agent_binding_ids?.length">
          <span class="label">Agent</span>
          <span class="value">{{ selectedNode.data.agent_binding_ids.join(', ') }}</span>
        </div>
        <!-- 人审 gate：当前节点处于 paused（待人审）时给出审核操作 -->
        <div v-if="isGateReviewable" class="gate-review">
          <div class="panel-title">人工审核</div>
          <el-input type="textarea" v-model="reviewComment" :rows="3" resize="none"
            placeholder="审核意见（可选）" class="gate-comment" />
          <div class="gate-review-btns">
            <el-button type="success" size="small" :loading="reviewing" @click="submitGateReview('approve')">通过</el-button>
            <el-button type="danger" size="small" :loading="reviewing" @click="submitGateReview('reject')">驳回</el-button>
          </div>
        </div>
      </template>
      <div v-else-if="!selectedNode" class="panel-hint">点击节点查看详情</div>
    </div>
    <LiveEventStream v-if="mode === 'runtime' && connected" :execution-id="executionId" class="rt-stream" />
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { VueFlow, useVueFlow, type Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import AgentNode from '../components/canvas/nodes/AgentNode.vue'
import GateNode from '../components/canvas/nodes/GateNode.vue'
import CommandNode from '../components/canvas/nodes/CommandNode.vue'
import SubgraphNode from '../components/canvas/nodes/SubgraphNode.vue'
import LoopEdge from '../components/canvas/edges/LoopEdge.vue'
import NodeEditModal from '../components/canvas/NodeEditModal.vue'
import LiveEventStream from '../components/execution/LiveEventStream.vue'
import { layoutDagre } from '../lib/dagre-layout'
import { toGraphDef, toVueFlow } from '../lib/graph-serialize'
import { api } from '../api/graph'
import { agentApi } from '../api/agent-bindings'

const route = useRoute()
const router = useRouter()

const nodes = ref<any[]>([])
const edges = ref<any[]>([])
const { addEdges, findNode, onInit, fitView, updateNodeData: vfUpdate } = useVueFlow()
const selectedNode = computed(() => nodes.value.find(n => n.selected))
const selectedEdge = computed(() => edges.value.find(e => e.selected))
// 选中的是"待人审"的人审 gate → 显示审核操作
const isGateReviewable = computed(() =>
  selectedNode.value?.type === 'gate' && selectedNode.value?.data?.status === 'paused')
const reviewComment = ref('')
const reviewing = ref(false)

// 模态框状态
const showModal = ref(false)
const modalType = ref<'node' | 'edge' | null>(null)
const modalNodeData = ref<any>(null)
const modalEdgeData = ref<any>(null)

function selectNodeById(id: string) {
  nodes.value = nodes.value.map(n => ({ ...n, selected: n.id === id }))
}

function statusLabel(s: string | undefined): string {
  const map: Record<string, string> = { running: '运行中', done: '已完成', pending: '待处理', failed: '失败', paused: '已暂停' }
  return map[s || 'pending'] || s || '待处理'
}
// 节点状态文案：gate 节点 paused 是"等待人审"（LangGraph interrupt 自动挂起），非手动暂停
function nodeStatusLabel(type: string | undefined, s: string | undefined): string {
  if (s === 'paused' && type === 'gate') return '待人审'
  return statusLabel(s)
}

// 格式化时间
function formatTime(ts: string | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

// 用时计算
function elapsed(start: string | null): string {
  if (!start) return '-'
  const startTime = new Date(start).getTime()
  const diff = Math.floor((Date.now() - startTime) / 1000)
  const min = Math.floor(diff / 60)
  const sec = diff % 60
  return min > 0 ? `${min}分${sec}秒` : `${sec}秒`
}

// 获取节点的友好名称（用于边面板显示）
function getNodeLabel(nodeId: string): string {
  const node = nodes.value.find(n => n.id === nodeId)
  return node?.data?.label || node?.data?.agent_binding_ids?.[0] || nodeId
}

// 图定义列表
const graphDefs = ref<any[]>([])
const selectedGraphId = ref<string>('')

// 加载图定义列表
async function loadGraphDefs() {
  try {
    const data = await api.list()
    // data = { presets: [...], user: [...] }
    graphDefs.value = [...(data.presets || []), ...(data.user || [])]
    // 默认选中第一张
    if (graphDefs.value.length > 0 && !selectedGraphId.value) {
      selectedGraphId.value = graphDefs.value[0].id
    }
  } catch {
    // graph-definitions 端点可能不存在（V4 使用 workflows），不影响运行态画布
    graphDefs.value = []
  }
}

// 加载选中的图定义到画布
async function loadSelectedGraph() {
  if (!selectedGraphId.value) return
  const def = await api.get(selectedGraphId.value)
  if (def?.definition_json) {
    const vf = toVueFlow(def.definition_json)
    // 用 agent binding 的 agent_id 作为节点默认 label
    const labelMap = await agentApi.getLabelMap()
    for (const n of vf.nodes) {
      if (!n.data.label) {
        const bindingId = n.data.agent_binding_ids?.[0]
        if (bindingId && labelMap.has(bindingId)) {
          n.data.label = labelMap.get(bindingId)
        }
      }
    }
    nodes.value = layoutDagre(vf.nodes, vf.edges)
    edges.value = vf.edges
    setTimeout(() => fitView({ padding: 0.08, minZoom: 0.5 }), 60)
  }
}

// —— 运行态 ——
const mode = ref<'static' | 'runtime'>('static')
const executionId = ref('')
const connected = ref(false)
// node_id → status（pending/running/done/failed/paused）；用 ref Map（照 framework applyState）
const runtimePhases = ref<Map<string, string>>(new Map())
// GET /:id 轮询得到的 execution 级元数据
const rtMeta = ref<{ status: string; token_in: number | null; token_out: number | null; current_node_id?: string; loop_counters?: Record<string, number>; started_at?: string } | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

function onModeChange(m: 'static' | 'runtime') {
  disconnect()
  if (m === 'static') {
    // 回编辑态：清运行染色
    runtimePhases.value = new Map()
    applyState()
  }
}

async function connectExecution() {
  if (connected.value) { disconnect(); return }
  if (!executionId.value) return
  // 拉取 execution 行 → 图定义或任务树 → 构画布节点
  try {
    const er = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}`)
    if (!er.ok) { alert('execution 查询失败: ' + er.status); return }
    const erow = await er.json()
    rtMeta.value = { status: erow.status, token_in: erow.token_in ?? null, token_out: erow.token_out ?? null, current_node_id: erow.current_node_id, loop_counters: erow.loop_counters || {}, started_at: erow.started_at }
    const defId = erow.graph_definition_id

    // 情况 1：有 graph_definition_id（工作流驱动的执行）
    if (defId) {
      const drow = await api.get(defId)
      const def = drow?.definition_json
      if (def) {
        const vf = toVueFlow(def)
        // 用 agent binding 的 agent_id 作为节点默认 label
        const labelMap = await agentApi.getLabelMap()
        for (const n of vf.nodes) {
          if (!n.data.label) {
            const bindingId = n.data.agent_binding_ids?.[0]
            if (bindingId && labelMap.has(bindingId)) {
              n.data.label = labelMap.get(bindingId)
            }
          }
        }
        nodes.value = layoutDagre(vf.nodes, vf.edges)
        edges.value = vf.edges
      }
    }
    // 情况 2：需求类型执行（无图定义，从任务树构建画布）
    else if (erow.subject_type === 'requirement' && erow.subject_id) {
      await buildCanvasFromRequirementTree(erow.subject_id)
    }
    // 情况 3：任务级执行（无图定义），显示单个任务节点
    else if (erow.subject_type === 'task') {
      await buildCanvasFromTask(erow.subject_id, erow.subject_id)
    }
    // 情况 4：其他类型执行，无法构建画布
    else {
      console.warn('[canvas] 无法构建画布: 无图定义且非需求/任务类型执行')
      // 显示占位节点
      nodes.value = [{
        id: 'unknown',
        type: 'agent',
        position: { x: 200, y: 200 },
        data: { label: '未知执行类型', status: 'pending', agent_binding_ids: [] },
      }]
      edges.value = []
    }

    // 初始染色：回填已完成节点（phase_nodes）→ done；当前节点 → running/paused
    runtimePhases.value = new Map()
    // phase_nodes 是 { phaseId: status } 对象，不是数组
    if (erow.phase_nodes && typeof erow.phase_nodes === 'object') {
      for (const [nid, status] of Object.entries(erow.phase_nodes)) {
        runtimePhases.value.set(nid, status as string)
      }
    }
    if (rtMeta.value.current_node_id) {
      runtimePhases.value.set(rtMeta.value.current_node_id, rtMeta.value.status === 'paused' ? 'paused' : 'running')
    }
    applyState()
    setTimeout(() => fitView({ padding: 0.08, minZoom: 0.5 }), 60)
    // 开轮询更新 rtMeta + 染色（SSE 由 LiveEventStream 组件处理，此处不再重复）
    pollTimer = setInterval(pollExecution, 1500)
    connected.value = true
  } catch (e: any) {
    alert('连接失败: ' + (e?.message || e))
  }
}

/**
 * 从需求任务树构建画布
 *
 * 节点：epic → feature → userStory → task（四层）
 * 边：按顺序连接（epic → feature → userStory → task）
 * 状态：从子执行查询每个 task 的执行状态
 */
async function buildCanvasFromRequirementTree(requirementId: string) {
  try {
    const treeRes = await fetch(`/api/requirements/${encodeURIComponent(requirementId)}/tree`)
    if (!treeRes.ok) { console.warn('[canvas] 需求树查询失败:', treeRes.status); return }
    const tree = await treeRes.json()

    // 查询所有子执行的执行状态
    const taskStatusMap = new Map<string, string>() // taskId → execution status
    const taskExecIdMap = new Map<string, string>() // taskId → executionId
    try {
      const execRes = await fetch(`/api/executions?requirement_id=${encodeURIComponent(requirementId)}`)
      if (execRes.ok) {
        const execs = await execRes.json()
        for (const ex of execs) {
          if (ex.subject_type === 'task' && ex.subject_id) {
            taskStatusMap.set(ex.subject_id, ex.status)
            taskExecIdMap.set(ex.subject_id, ex.id)
          }
        }
      }
    } catch { /* ignore */ }

    const buildNodes: any[] = []
    const buildEdges: any[] = []
    let x = 0
    const Y_LEVELS = { epic: 0, feature: 1, story: 2, task: 3 }
    const Y_STEP = 120
    const X_STEP = 200

    // 按史诗组织节点，每个史诗一列
    for (const epic of tree.epics || []) {
      const epicId = `epic-${epic.id}`
      buildNodes.push({
        id: epicId, type: 'agent',
        position: { x: x * X_STEP, y: Y_LEVELS.epic * Y_STEP },
        data: { label: epic.title, status: 'done', agent_binding_ids: [epicId] },
      })

      for (const feat of epic.features || []) {
        const featId = `feat-${feat.id}`
        buildNodes.push({
          id: featId, type: 'agent',
          position: { x: x * X_STEP, y: Y_LEVELS.feature * Y_STEP },
          data: { label: feat.title, status: 'done', agent_binding_ids: [featId] },
        })
        buildEdges.push({ id: `${epicId}-${featId}`, source: epicId, target: featId, animated: false, markerEnd: 'arrowclosed' })

        for (const story of feat.user_stories || []) {
          const storyId = `story-${story.id}`
          buildNodes.push({
            id: storyId, type: 'agent',
            position: { x: x * X_STEP, y: Y_LEVELS.story * Y_STEP },
            data: { label: story.title, status: 'done', agent_binding_ids: [storyId] },
          })
          buildEdges.push({ id: `${featId}-${storyId}`, source: featId, target: storyId, animated: false, markerEnd: 'arrowclosed' })

          for (const task of story.tasks || []) {
            const taskId = `task-${task.id}`
            const execStatus = taskStatusMap.get(task.id) || 'pending'
            // 映射 task_execution 状态到画布状态
            const canvasStatus = execStatus === 'completed' ? 'done'
              : execStatus === 'running' ? 'running'
              : execStatus === 'failed' ? 'failed'
              : 'pending'
            buildNodes.push({
              id: taskId, type: 'agent',
              position: { x: x * X_STEP, y: Y_LEVELS.task * Y_STEP },
              data: { label: task.title, status: canvasStatus, agent_binding_ids: [taskId] },
            })
            buildEdges.push({ id: `${storyId}-${taskId}`, source: storyId, target: taskId, animated: false, markerEnd: 'arrowclosed' })
          }
        }
      }
      x++
    }

    nodes.value = buildNodes
    edges.value = buildEdges
    // 用节点状态填充 runtimePhases
    runtimePhases.value = new Map()
    for (const n of buildNodes) {
      runtimePhases.value.set(n.id, n.data.status)
    }
  } catch (e: any) {
    console.error('[canvas] 构建需求树画布失败:', e)
  }
}

/**
 * 从单个任务构建画布
 *
 * 显示单个任务节点，用于任务级执行
 */
async function buildCanvasFromTask(taskId: string, executionId: string) {
  try {
    // 查询任务详情获取标题
    const taskRes = await fetch(`/api/tasks/${encodeURIComponent(executionId)}`)
    let taskTitle = taskId
    let taskStatus = 'pending'
    if (taskRes.ok) {
      const task = await taskRes.json()
      taskTitle = task.title || taskId
      taskStatus = task.status || 'pending'
    }

    // 映射任务状态到画布状态
    const canvasStatus = taskStatus === 'completed' ? 'done'
      : taskStatus === 'running' ? 'running'
      : taskStatus === 'failed' ? 'failed'
      : taskStatus === 'paused' ? 'paused'
      : 'pending'

    // 创建单个任务节点
    nodes.value = [{
      id: taskId,
      type: 'agent',
      position: { x: 200, y: 200 },
      data: {
        label: taskTitle,
        status: canvasStatus,
        agent_binding_ids: [taskId],
      },
    }]
    edges.value = []

    // 设置运行阶段状态
    runtimePhases.value = new Map()
    runtimePhases.value.set(taskId, canvasStatus)
  } catch (e: any) {
    console.error('[canvas] 构建任务画布失败:', e)
    // 显示占位节点
    nodes.value = [{
      id: taskId,
      type: 'agent',
      position: { x: 200, y: 200 },
      data: { label: `任务: ${taskId}`, status: 'pending', agent_binding_ids: [] },
    }]
    edges.value = []
  }
}

async function pollExecution() {
  if (!executionId.value) return
  try {
    const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}`)
    if (!r.ok) return
    const row = await r.json()
    rtMeta.value = { status: row.status, token_in: row.token_in ?? null, token_out: row.token_out ?? null, current_node_id: row.current_node_id, loop_counters: row.loop_counters || {}, started_at: row.started_at }
    // phase_nodes 是 { phaseId: status } 对象，直接使用其状态值
    if (row.phase_nodes && typeof row.phase_nodes === 'object') {
      for (const [nid, status] of Object.entries(row.phase_nodes)) {
        runtimePhases.value.set(nid, status as string)
      }
    }
    // 若 execution 整体结束 → 全部标 done（未标的留原态）
    if (row.status === 'completed') {
      for (const n of nodes.value) if (!runtimePhases.value.get(n.id)) runtimePhases.value.set(n.id, 'done')
    } else if (row.status === 'paused' && row.current_node_id) {
      runtimePhases.value.set(row.current_node_id, 'paused')
    } else if (row.status === 'failed' && row.current_node_id) {
      runtimePhases.value.set(row.current_node_id, 'failed')
    } else if (row.current_node_id && !runtimePhases.value.get(row.current_node_id)) {
      runtimePhases.value.set(row.current_node_id, 'running')
    }
    applyState()
  } catch { /* 轮询失败忽略，下次重试 */ }
}

function disconnect() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  connected.value = false
  rtMeta.value = null
  runtimePhases.value = new Map()
  applyState()
}

// 上次应用状态的时间戳（用于 throttle）
let lastApplyTime = 0
const APPLY_THROTTLE_MS = 200 // 最小间隔 200ms

// 更新染色/边动画，不动 dagre 位置（照 framework FlowEditor.vue applyState）
// 优化：throttle + 只更新变化的节点/边
function applyState() {
  const now = Date.now()
  if (now - lastApplyTime < APPLY_THROTTLE_MS) return // throttle
  lastApplyTime = now

  const lc = rtMeta.value?.loop_counters || {}
  const tokIn = rtMeta.value?.token_in ?? 0
  const tokOut = rtMeta.value?.token_out ?? 0

  // 优化：只更新状态变化的节点，避免重建整个数组
  let nodesChanged = false
  for (let i = 0; i < nodes.value.length; i++) {
    const n = nodes.value[i]
    const status = runtimePhases.value.get(n.id)
    const data = n.data as any
    const loop = lc[n.id]
    const isCurrent = rtMeta.value?.current_node_id === n.id
    const badgeParts: string[] = []
    if (loop) badgeParts.push(`第 ${loop} 轮`)
    if (isCurrent && (tokIn || tokOut)) badgeParts.push(`token ${tokIn}/${tokOut}`)
    const badge = badgeParts.join(' · ') || undefined
    const newClass = [selectedNode.value?.id === n.id ? 'sel' : '', status ? `st-${status}` : ''].join(' ').trim()

    // 检查是否需要更新（避免不必要的响应式触发）
    if (data.status !== status || data.badge !== badge || n.class !== newClass) {
      nodesChanged = true
      // 直接修改数组元素（Vue 3 支持）
      nodes.value[i] = {
        ...n,
        data: { ...data, status, badge },
        class: newClass,
      }
    }
  }

  // 优化：只更新 animated 属性和 class 变化的边
  let edgesChanged = false
  for (let i = 0; i < edges.value.length; i++) {
    const e = edges.value[i]
    const targetStatus = runtimePhases.value.get(e.target as string)
    const sourceStatus = runtimePhases.value.get(e.source as string)
    const newAnimated = targetStatus === 'running'

    // 确定边的状态 class
    let statusClass = ''
    if (targetStatus === 'done' && sourceStatus === 'done') {
      statusClass = 'st-done'
    } else if (targetStatus === 'running') {
      statusClass = 'st-running'
    }

    // 保留原始的 class（如 loop-edge），追加状态 class
    const originalClass = e.data?.isLoopEdge ? 'loop-edge' : ''
    const newClass = [originalClass, statusClass].filter(Boolean).join(' ')

    if (e.animated !== newAnimated || e.class !== newClass) {
      edgesChanged = true
      edges.value[i] = { ...e, animated: newAnimated, class: newClass || undefined }
    }
  }

  // 如果有变化，触发响应式更新（通过重新赋值整个数组）
  if (nodesChanged) nodes.value = [...nodes.value]
  if (edgesChanged) edges.value = [...edges.value]
}

// —— 右键菜单 ——
const ctxMenu = ref<{
  show: boolean
  x: number
  y: number
  context: 'pane' | 'node' | 'edge' | null
  nodeId?: string
  edgeId?: string
}>({ show: false, x: 0, y: 0, context: null })

function onPaneContextMenu(event: MouseEvent) {
  if (mode.value !== 'static') return
  event.preventDefault()
  ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: 'pane' }
}

function onNodeContextMenu({ event, node }: { event: any; node: Node }) {
  event.preventDefault()
  if (mode.value === 'runtime') {
    // 运行态：暂停/继续菜单
    ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: null }
  } else {
    // 编辑态：复制/删除菜单
    ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: 'node', nodeId: node.id }
  }
}

function onEdgeContextMenu({ event, edge }: { event: any; edge: any }) {
  if (mode.value !== 'static') return
  event.preventDefault()
  ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: 'edge', edgeId: edge.id }
}

function hideCtxMenu() { ctxMenu.value.show = false }

// 节点/边点击 → 打开模态框
function onNodeClick({ node }: { node: Node }) {
  if (mode.value !== 'static') return
  modalType.value = 'node'
  modalNodeData.value = { ...node.data, id: node.id }
  modalEdgeData.value = null
  showModal.value = true
}

function onEdgeClick({ edge }: { edge: any }) {
  if (mode.value !== 'static') return
  modalType.value = 'edge'
  modalEdgeData.value = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceLabel: getNodeLabel(edge.source),
    targetLabel: getNodeLabel(edge.target),
    condition: edge.data?.condition || null,
    loop_max: edge.data?.loop_max ?? 3
  }
  modalNodeData.value = null
  showModal.value = true
}

function onModalClose() {
  showModal.value = false
  modalType.value = null
  modalNodeData.value = null
  modalEdgeData.value = null
}

function onModalSave(type: 'node' | 'edge', data: any) {
  if (type === 'node') {
    updateNodeData(data.id, data)
  } else if (type === 'edge') {
    // 更新边条件
    const edgeIndex = edges.value.findIndex(e => e.id === modalEdgeData.value?.id)
    if (edgeIndex !== -1) {
      edges.value[edgeIndex] = {
        ...edges.value[edgeIndex],
        data: {
          ...edges.value[edgeIndex].data,
          condition: data.condition,
          loop_max: data.loop_max
        }
      }
    }
  }
  onModalClose()
}

// 右键菜单操作
function ctxAddNode(type: string) {
  ctxMenu.value.show = false
  addNode(type)
}

function ctxCopyNode() {
  if (!ctxMenu.value.nodeId) return
  const node = nodes.value.find(n => n.id === ctxMenu.value.nodeId)
  if (!node) return
  ctxMenu.value.show = false
  const newNode = {
    ...node,
    id: `${node.type}-${Date.now()}`,
    position: { x: node.position.x + 50, y: node.position.y + 50 },
    data: { ...node.data },
    selected: false
  }
  nodes.value.push(newNode)
}

function ctxDeleteNode() {
  if (!ctxMenu.value.nodeId) return
  ctxMenu.value.show = false
  nodes.value = nodes.value.filter(n => n.id !== ctxMenu.value.nodeId)
  edges.value = edges.value.filter(e => e.source !== ctxMenu.value.nodeId && e.target !== ctxMenu.value.nodeId)
}

function ctxDeleteEdge() {
  if (!ctxMenu.value.edgeId) return
  ctxMenu.value.show = false
  edges.value = edges.value.filter(e => e.id !== ctxMenu.value.edgeId)
}

function ctxEditEdge() {
  if (!ctxMenu.value.edgeId) return
  const edge = edges.value.find(e => e.id === ctxMenu.value.edgeId)
  if (!edge) return
  ctxMenu.value.show = false
  modalType.value = 'edge'
  modalEdgeData.value = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceLabel: getNodeLabel(edge.source),
    targetLabel: getNodeLabel(edge.target),
    condition: edge.data?.condition || null,
    loop_max: edge.data?.loop_max ?? 3
  }
  modalNodeData.value = null
  showModal.value = true
}

onMounted(async () => {
  window.addEventListener('click', hideCtxMenu)
  window.addEventListener('scroll', hideCtxMenu, true)

  // 如果有 execution_id 查询参数，自动进入运行态
  const execId = route.query.execution_id as string | undefined
  const workflowId = route.query.workflow_id as string | undefined

  if (execId) {
    mode.value = 'runtime'
    executionId.value = execId
    await connectExecution()
  } else if (workflowId) {
    // 静态编辑态：加载指定的 workflow_id
    selectedGraphId.value = workflowId
    // 同时加载图列表供下拉选择
    await loadGraphDefs()
    await loadSelectedGraph()
  } else {
    // 默认：加载图列表，选中第一张
    await loadGraphDefs()
    if (selectedGraphId.value) {
      await loadSelectedGraph()
    }
  }
})
onUnmounted(() => {
  disconnect()
  window.removeEventListener('click', hideCtxMenu)
  window.removeEventListener('scroll', hideCtxMenu, true)
})

async function pauseExecution() {
  ctxMenu.value.show = false
  if (!executionId.value) return
  try {
    const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}/pause`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'sub' }),
    })
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert('暂停失败: ' + (j.error || r.status)); return }
    await pollExecution()
  } catch (e: any) { alert('暂停异常: ' + (e?.message || e)) }
}

async function resumeExecution() {
  ctxMenu.value.show = false
  if (!executionId.value) return
  try {
    const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert('继续失败: ' + (j.error || r.status)); return }
    await pollExecution()
  } catch (e: any) { alert('继续异常: ' + (e?.message || e)) }
}

// 人审 gate 审核：POST /gate { decision, comments }（后端异步受理，立即返回）
async function submitGateReview(decision: 'approve' | 'reject') {
  if (!executionId.value || !selectedNode.value) return
  reviewing.value = true
  try {
    const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, comments: reviewComment.value?.trim() || undefined }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert('审核提交失败: ' + (j.error || r.status)); return }
    reviewComment.value = ''
    // 受理成功：本地立刻把被审 gate 置 done/驳回，节点列表/详情即时流转（不等 3s 轮询）
    const gid = selectedNode.value?.id
    if (gid) runtimePhases.value.set(gid, decision === 'approve' ? 'done' : 'failed')
    applyState()
    pollExecution()   // 非阻塞拉一次 DB：受理后 status='running'，执行信息面板随即流转
  } catch (e: any) {
    alert('审核异常: ' + (e?.message || e))
  } finally {
    reviewing.value = false
  }
}

// —— 编辑态 ——
function onConnect(conn: any) {
  addEdges([{ id: `${conn.source}-${conn.target}`, ...conn, markerEnd: 'arrowclosed' }])
}
function onDragStop() { /* position 已在 nodes ref */ }
function addNode(type: string) {
  nodes.value.push({
    id: `${type}-${Date.now()}`,
    type,
    position: { x: 200, y: 200 },
    data: { type, label: type },
  })
}
function updateNodeData(id: string, data: any) {
  vfUpdate(id, data)
}
function updateEdgeCondition(condition: any) {
  if (!selectedEdge.value) return
  const edgeIndex = edges.value.findIndex(e => e.id === selectedEdge.value!.id)
  if (edgeIndex !== -1) {
    edges.value[edgeIndex] = {
      ...edges.value[edgeIndex],
      data: {
        ...edges.value[edgeIndex].data,
        condition
      }
    }
  }
}

function updateEdgeLoopMax(loopMax: number) {
  if (!selectedEdge.value) return
  const edgeIndex = edges.value.findIndex(e => e.id === selectedEdge.value!.id)
  if (edgeIndex !== -1) {
    edges.value[edgeIndex] = {
      ...edges.value[edgeIndex],
      data: {
        ...edges.value[edgeIndex].data,
        loop_max: loopMax
      }
    }
  }
}

async function save() {
  nodes.value = layoutDagre(nodes.value, edges.value)  // 保存前布局
  const name = selectedGraphId.value ? (graphDefs.value.find(g => g.id === selectedGraphId.value)?.name || '新建图') : '新建图'
  const def = toGraphDef(nodes.value, edges.value, name, 'ruoyi')
  const saved = await api.save(def)
  // 更新 selectedGraphId 为新建图的 id
  if (saved?.id && !selectedGraphId.value) {
    selectedGraphId.value = saved.id
  }
  // 刷新列表
  await loadGraphDefs()
}
</script>
<style scoped>
.canvas-wrap { display: flex; width: 100%; height: 100%; overflow: hidden; box-sizing: border-box; }
.canvas-main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.canvas-main > :deep(.vue-flow) { flex: 1; }

/* 底部工具栏 */
.bottom-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 1px solid var(--border);
  background: var(--panel);
  z-index: 10;
}
.toolbar-left { display: flex; align-items: center; gap: 12px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.rt-id { width: 180px; }
.rt-meta { font-size: 12px; color: var(--muted); font-family: var(--font-mono); }
.rt-meta :deep(.el-tag) { margin: 0; }
.save-btn { font-weight: 500; }

.rt-stream { width: 440px; flex-shrink: 0; box-sizing: border-box; border-left: 1px solid var(--border); }

/* 运行态信息面板 */
.runtime-panel {
  width: 300px; flex-shrink: 0; box-sizing: border-box;
  border-left: 1px solid var(--border); background: var(--panel);
  padding: 16px; overflow-y: auto;
}
.panel-title {
  font-family: var(--font-ui); font-size: 10.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--faint);
  margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-soft);
}
.panel-row { display: flex; align-items: center; margin-bottom: 9px; font-size: 13px; }
.panel-row .label { width: 70px; color: var(--muted); flex-shrink: 0; font-size: 11.5px; }
.panel-row .value { color: var(--text); word-break: break-all; font-family: var(--font-mono); font-size: 12px; }
.panel-hint { color: var(--faint); font-size: 12px; text-align: center; margin-top: 20px; }

/* 人审 gate 审核区 */
.gate-review { margin-top: 4px; }
.gate-review .gate-comment :deep(textarea) {
  background: var(--surface); color: var(--text); border-color: var(--border);
  font-family: var(--font-mono); font-size: 12px;
}
.gate-review .gate-review-btns { display: flex; gap: 8px; margin-top: 8px; }
.gate-review .gate-review-btns .el-button { flex: 1; }

/* 右键菜单 */
.ctx-menu {
  position: fixed; z-index: 1000;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  padding: 4px; margin: 0; list-style: none; min-width: 130px;
}
.ctx-menu li { padding: 7px 12px; font-size: 12.5px; cursor: pointer; color: var(--text); border-radius: 4px; font-family: var(--font-ui); }
.ctx-menu li:hover { background: var(--surface); color: var(--accent); }
.ctx-menu li.danger { color: var(--st-failed); }
.ctx-menu li.danger:hover { background: rgba(239, 68, 68, 0.1); color: var(--st-failed); }

/* 节点状态列表（运行态面板内） */
.node-list { display: flex; flex-direction: column; gap: 3px; }
.node-list-item {
  display: flex; align-items: center; padding: 6px 8px; border-radius: var(--radius-sm);
  cursor: pointer; font-size: 12px; transition: background .15s;
  border: 1px solid transparent;
}
.node-list-item:hover { background: var(--surface); }
.node-list-item.selected { background: var(--surface-2); border-color: var(--border); }
.node-status-dot { width: 7px; height: 7px; border-radius: 50%; margin-right: 8px; flex-shrink: 0; }
.node-status-dot.running { background: var(--st-running); box-shadow: 0 0 6px var(--st-running); animation: v2-pulse 1.6s infinite; }
.node-status-dot.done { background: var(--st-done); }
.node-status-dot.pending { background: var(--st-pending); }
.node-status-dot.failed { background: var(--st-failed); }
.node-status-dot.paused { background: var(--st-paused); }
.node-list-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.node-list-status { color: var(--faint); font-size: 11px; font-family: var(--font-mono); }
</style>
