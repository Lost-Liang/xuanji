/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import AgentNode from '../components/canvas/nodes/AgentNode.vue';
import GateNode from '../components/canvas/nodes/GateNode.vue';
import CommandNode from '../components/canvas/nodes/CommandNode.vue';
import SubgraphNode from '../components/canvas/nodes/SubgraphNode.vue';
import NodeEditModal from '../components/canvas/NodeEditModal.vue';
import LiveEventStream from '../components/execution/LiveEventStream.vue';
import { layoutDagre } from '../lib/dagre-layout';
import { toGraphDef, toVueFlow } from '../lib/graph-serialize';
import { api } from '../api/graph';
import { agentApi } from '../api/agent-bindings';
const route = useRoute();
const router = useRouter();
const nodes = ref([]);
const edges = ref([]);
const { addEdges, findNode, onInit, fitView, updateNodeData: vfUpdate } = useVueFlow();
const selectedNode = computed(() => nodes.value.find(n => n.selected));
const selectedEdge = computed(() => edges.value.find(e => e.selected));
// 选中的是"待人审"的人审 gate → 显示审核操作
const isGateReviewable = computed(() => selectedNode.value?.type === 'gate' && selectedNode.value?.data?.status === 'paused');
const reviewComment = ref('');
const reviewing = ref(false);
// 模态框状态
const showModal = ref(false);
const modalType = ref(null);
const modalNodeData = ref(null);
const modalEdgeData = ref(null);
function selectNodeById(id) {
    nodes.value = nodes.value.map(n => ({ ...n, selected: n.id === id }));
}
function statusLabel(s) {
    const map = { running: '运行中', done: '已完成', pending: '待处理', failed: '失败', paused: '已暂停' };
    return map[s || 'pending'] || s || '待处理';
}
// 节点状态文案：gate 节点 paused 是"等待人审"（LangGraph interrupt 自动挂起），非手动暂停
function nodeStatusLabel(type, s) {
    if (s === 'paused' && type === 'gate')
        return '待人审';
    return statusLabel(s);
}
// 获取节点的友好名称（用于边面板显示）
function getNodeLabel(nodeId) {
    const node = nodes.value.find(n => n.id === nodeId);
    return node?.data?.label || node?.data?.agent_binding_ids?.[0] || nodeId;
}
// 图定义列表
const graphDefs = ref([]);
const selectedGraphId = ref('');
// 加载图定义列表
async function loadGraphDefs() {
    try {
        const data = await api.list();
        // data = { presets: [...], user: [...] }
        graphDefs.value = [...(data.presets || []), ...(data.user || [])];
        // 默认选中第一张
        if (graphDefs.value.length > 0 && !selectedGraphId.value) {
            selectedGraphId.value = graphDefs.value[0].id;
        }
    }
    catch {
        // graph-definitions 端点可能不存在（V4 使用 workflows），不影响运行态画布
        graphDefs.value = [];
    }
}
// 加载选中的图定义到画布
async function loadSelectedGraph() {
    if (!selectedGraphId.value)
        return;
    const def = await api.get(selectedGraphId.value);
    if (def?.definition_json) {
        const vf = toVueFlow(def.definition_json);
        // 用 agent binding 的 agent_id 作为节点默认 label
        const labelMap = await agentApi.getLabelMap();
        for (const n of vf.nodes) {
            if (!n.data.label) {
                const bindingId = n.data.agent_binding_ids?.[0];
                if (bindingId && labelMap.has(bindingId)) {
                    n.data.label = labelMap.get(bindingId);
                }
            }
        }
        nodes.value = layoutDagre(vf.nodes, vf.edges);
        edges.value = vf.edges;
        setTimeout(() => fitView({ padding: 0.08, minZoom: 0.5 }), 60);
    }
}
// —— 运行态 ——
const mode = ref('static');
const executionId = ref('');
const connected = ref(false);
// node_id → status（pending/running/done/failed/paused）；用 ref Map（照 framework applyState）
const runtimePhases = ref(new Map());
// GET /:id 轮询得到的 execution 级元数据
const rtMeta = ref(null);
let pollTimer = null;
function onModeChange(m) {
    disconnect();
    if (m === 'static') {
        // 回编辑态：清运行染色
        runtimePhases.value = new Map();
        applyState();
    }
}
async function connectExecution() {
    if (connected.value) {
        disconnect();
        return;
    }
    if (!executionId.value)
        return;
    // 拉取 execution 行 → 图定义或任务树 → 构画布节点
    try {
        const er = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}`);
        if (!er.ok) {
            alert('execution 查询失败: ' + er.status);
            return;
        }
        const erow = await er.json();
        rtMeta.value = { status: erow.status, token_in: erow.token_in ?? null, token_out: erow.token_out ?? null, current_node_id: erow.current_node_id, loop_counters: erow.loop_counters || {} };
        const defId = erow.graph_definition_id;
        // 情况 1：有 graph_definition_id（工作流驱动的执行）
        if (defId) {
            const drow = await api.get(defId);
            const def = drow?.definition_json;
            if (def) {
                const vf = toVueFlow(def);
                // 用 agent binding 的 agent_id 作为节点默认 label
                const labelMap = await agentApi.getLabelMap();
                for (const n of vf.nodes) {
                    if (!n.data.label) {
                        const bindingId = n.data.agent_binding_ids?.[0];
                        if (bindingId && labelMap.has(bindingId)) {
                            n.data.label = labelMap.get(bindingId);
                        }
                    }
                }
                nodes.value = layoutDagre(vf.nodes, vf.edges);
                edges.value = vf.edges;
            }
        }
        // 情况 2：需求类型执行（无图定义，从任务树构建画布）
        else if (erow.subject_type === 'requirement' && erow.subject_id) {
            await buildCanvasFromRequirementTree(erow.subject_id);
        }
        // 初始染色：回填已完成节点（phase_nodes）→ done；当前节点 → running/paused
        runtimePhases.value = new Map();
        // phase_nodes 是 { phaseId: status } 对象，不是数组
        if (erow.phase_nodes && typeof erow.phase_nodes === 'object') {
            for (const [nid, status] of Object.entries(erow.phase_nodes)) {
                runtimePhases.value.set(nid, status);
            }
        }
        if (rtMeta.value.current_node_id) {
            runtimePhases.value.set(rtMeta.value.current_node_id, rtMeta.value.status === 'paused' ? 'paused' : 'running');
        }
        applyState();
        setTimeout(() => fitView({ padding: 0.08, minZoom: 0.5 }), 60);
        // 开轮询更新 rtMeta + 染色（SSE 由 LiveEventStream 组件处理，此处不再重复）
        pollTimer = setInterval(pollExecution, 1500);
        connected.value = true;
    }
    catch (e) {
        alert('连接失败: ' + (e?.message || e));
    }
}
/**
 * 从需求任务树构建画布
 *
 * 节点：epic → feature → userStory → task（四层）
 * 边：按顺序连接（epic → feature → userStory → task）
 * 状态：从子执行查询每个 task 的执行状态
 */
async function buildCanvasFromRequirementTree(requirementId) {
    try {
        const treeRes = await fetch(`/api/requirements/${encodeURIComponent(requirementId)}/tree`);
        if (!treeRes.ok) {
            console.warn('[canvas] 需求树查询失败:', treeRes.status);
            return;
        }
        const tree = await treeRes.json();
        // 查询所有子执行的执行状态
        const taskStatusMap = new Map(); // taskId → execution status
        const taskExecIdMap = new Map(); // taskId → executionId
        try {
            const execRes = await fetch(`/api/executions?requirement_id=${encodeURIComponent(requirementId)}`);
            if (execRes.ok) {
                const execs = await execRes.json();
                for (const ex of execs) {
                    if (ex.subject_type === 'task' && ex.subject_id) {
                        taskStatusMap.set(ex.subject_id, ex.status);
                        taskExecIdMap.set(ex.subject_id, ex.id);
                    }
                }
            }
        }
        catch { /* ignore */ }
        const buildNodes = [];
        const buildEdges = [];
        let x = 0;
        const Y_LEVELS = { epic: 0, feature: 1, story: 2, task: 3 };
        const Y_STEP = 120;
        const X_STEP = 200;
        // 按史诗组织节点，每个史诗一列
        for (const epic of tree.epics || []) {
            const epicId = `epic-${epic.id}`;
            buildNodes.push({
                id: epicId, type: 'agent',
                position: { x: x * X_STEP, y: Y_LEVELS.epic * Y_STEP },
                data: { label: epic.title, status: 'done', agent_binding_ids: [epicId] },
            });
            for (const feat of epic.features || []) {
                const featId = `feat-${feat.id}`;
                buildNodes.push({
                    id: featId, type: 'agent',
                    position: { x: x * X_STEP, y: Y_LEVELS.feature * Y_STEP },
                    data: { label: feat.title, status: 'done', agent_binding_ids: [featId] },
                });
                buildEdges.push({ id: `${epicId}-${featId}`, source: epicId, target: featId, animated: false, markerEnd: 'arrowclosed' });
                for (const story of feat.user_stories || []) {
                    const storyId = `story-${story.id}`;
                    buildNodes.push({
                        id: storyId, type: 'agent',
                        position: { x: x * X_STEP, y: Y_LEVELS.story * Y_STEP },
                        data: { label: story.title, status: 'done', agent_binding_ids: [storyId] },
                    });
                    buildEdges.push({ id: `${featId}-${storyId}`, source: featId, target: storyId, animated: false, markerEnd: 'arrowclosed' });
                    for (const task of story.tasks || []) {
                        const taskId = `task-${task.id}`;
                        const execStatus = taskStatusMap.get(task.id) || 'pending';
                        // 映射 task_execution 状态到画布状态
                        const canvasStatus = execStatus === 'completed' ? 'done'
                            : execStatus === 'running' ? 'running'
                                : execStatus === 'failed' ? 'failed'
                                    : 'pending';
                        buildNodes.push({
                            id: taskId, type: 'agent',
                            position: { x: x * X_STEP, y: Y_LEVELS.task * Y_STEP },
                            data: { label: task.title, status: canvasStatus, agent_binding_ids: [taskId] },
                        });
                        buildEdges.push({ id: `${storyId}-${taskId}`, source: storyId, target: taskId, animated: false, markerEnd: 'arrowclosed' });
                    }
                }
            }
            x++;
        }
        nodes.value = buildNodes;
        edges.value = buildEdges;
        // 用节点状态填充 runtimePhases
        runtimePhases.value = new Map();
        for (const n of buildNodes) {
            runtimePhases.value.set(n.id, n.data.status);
        }
    }
    catch (e) {
        console.error('[canvas] 构建需求树画布失败:', e);
    }
}
async function pollExecution() {
    if (!executionId.value)
        return;
    try {
        const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}`);
        if (!r.ok)
            return;
        const row = await r.json();
        rtMeta.value = { status: row.status, token_in: row.token_in ?? null, token_out: row.token_out ?? null, current_node_id: row.current_node_id, loop_counters: row.loop_counters || {} };
        // 回填已完成节点（phase_outputs）→ done；跳过当前节点，由下方 status 规则染色（running/paused/failed）
        // 修复：旧逻辑仅当节点原本无状态才标 done，已推进的 agent 节点若先被标 running 会永远卡 running
        for (const nid of row.phase_nodes || []) {
            if (nid === row.current_node_id)
                continue;
            runtimePhases.value.set(nid, 'done');
        }
        // 若 execution 整体结束 → 全部标 done（未标的留原态）
        if (row.status === 'completed') {
            for (const n of nodes.value)
                if (!runtimePhases.value.get(n.id))
                    runtimePhases.value.set(n.id, 'done');
        }
        else if (row.status === 'paused' && row.current_node_id) {
            runtimePhases.value.set(row.current_node_id, 'paused');
        }
        else if (row.status === 'failed' && row.current_node_id) {
            runtimePhases.value.set(row.current_node_id, 'failed');
        }
        else if (row.current_node_id && !runtimePhases.value.get(row.current_node_id)) {
            runtimePhases.value.set(row.current_node_id, 'running');
        }
        applyState();
    }
    catch { /* 轮询失败忽略，下次重试 */ }
}
function disconnect() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    connected.value = false;
    rtMeta.value = null;
    runtimePhases.value = new Map();
    applyState();
}
// 上次应用状态的时间戳（用于 throttle）
let lastApplyTime = 0;
const APPLY_THROTTLE_MS = 200; // 最小间隔 200ms
// 更新染色/边动画，不动 dagre 位置（照 framework FlowEditor.vue applyState）
// 优化：throttle + 只更新变化的节点/边
function applyState() {
    const now = Date.now();
    if (now - lastApplyTime < APPLY_THROTTLE_MS)
        return; // throttle
    lastApplyTime = now;
    const lc = rtMeta.value?.loop_counters || {};
    const tokIn = rtMeta.value?.token_in ?? 0;
    const tokOut = rtMeta.value?.token_out ?? 0;
    // 优化：只更新状态变化的节点，避免重建整个数组
    let nodesChanged = false;
    for (let i = 0; i < nodes.value.length; i++) {
        const n = nodes.value[i];
        const status = runtimePhases.value.get(n.id);
        const data = n.data;
        const loop = lc[n.id];
        const isCurrent = rtMeta.value?.current_node_id === n.id;
        const badgeParts = [];
        if (loop)
            badgeParts.push(`第 ${loop} 轮`);
        if (isCurrent && (tokIn || tokOut))
            badgeParts.push(`token ${tokIn}/${tokOut}`);
        const badge = badgeParts.join(' · ') || undefined;
        const newClass = [selectedNode.value?.id === n.id ? 'sel' : '', status ? `st-${status}` : ''].join(' ').trim();
        // 检查是否需要更新（避免不必要的响应式触发）
        if (data.status !== status || data.badge !== badge || n.class !== newClass) {
            nodesChanged = true;
            // 直接修改数组元素（Vue 3 支持）
            nodes.value[i] = {
                ...n,
                data: { ...data, status, badge },
                class: newClass,
            };
        }
    }
    // 优化：只更新 animated 属性变化的边
    let edgesChanged = false;
    for (let i = 0; i < edges.value.length; i++) {
        const e = edges.value[i];
        const newAnimated = runtimePhases.value.get(e.target) === 'running';
        if (e.animated !== newAnimated) {
            edgesChanged = true;
            edges.value[i] = { ...e, animated: newAnimated };
        }
    }
    // 如果有变化，触发响应式更新（通过重新赋值整个数组）
    if (nodesChanged)
        nodes.value = [...nodes.value];
    if (edgesChanged)
        edges.value = [...edges.value];
}
// —— 右键菜单 ——
const ctxMenu = ref({ show: false, x: 0, y: 0, context: null });
function onPaneContextMenu(event) {
    if (mode.value !== 'static')
        return;
    event.preventDefault();
    ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: 'pane' };
}
function onNodeContextMenu({ event, node }) {
    event.preventDefault();
    if (mode.value === 'runtime') {
        // 运行态：暂停/继续菜单
        ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: null };
    }
    else {
        // 编辑态：复制/删除菜单
        ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: 'node', nodeId: node.id };
    }
}
function onEdgeContextMenu({ event, edge }) {
    if (mode.value !== 'static')
        return;
    event.preventDefault();
    ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, context: 'edge', edgeId: edge.id };
}
function hideCtxMenu() { ctxMenu.value.show = false; }
// 节点/边点击 → 打开模态框
function onNodeClick({ node }) {
    if (mode.value !== 'static')
        return;
    modalType.value = 'node';
    modalNodeData.value = { ...node.data, id: node.id };
    modalEdgeData.value = null;
    showModal.value = true;
}
function onEdgeClick({ edge }) {
    if (mode.value !== 'static')
        return;
    modalType.value = 'edge';
    modalEdgeData.value = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceLabel: getNodeLabel(edge.source),
        targetLabel: getNodeLabel(edge.target),
        condition: edge.data?.condition || null,
        loop_max: edge.data?.loop_max ?? 3
    };
    modalNodeData.value = null;
    showModal.value = true;
}
function onModalClose() {
    showModal.value = false;
    modalType.value = null;
    modalNodeData.value = null;
    modalEdgeData.value = null;
}
function onModalSave(type, data) {
    if (type === 'node') {
        updateNodeData(data.id, data);
    }
    else if (type === 'edge') {
        // 更新边条件
        const edgeIndex = edges.value.findIndex(e => e.id === modalEdgeData.value?.id);
        if (edgeIndex !== -1) {
            edges.value[edgeIndex] = {
                ...edges.value[edgeIndex],
                data: {
                    ...edges.value[edgeIndex].data,
                    condition: data.condition,
                    loop_max: data.loop_max
                }
            };
        }
    }
    onModalClose();
}
// 右键菜单操作
function ctxAddNode(type) {
    ctxMenu.value.show = false;
    addNode(type);
}
function ctxCopyNode() {
    if (!ctxMenu.value.nodeId)
        return;
    const node = nodes.value.find(n => n.id === ctxMenu.value.nodeId);
    if (!node)
        return;
    ctxMenu.value.show = false;
    const newNode = {
        ...node,
        id: `${node.type}-${Date.now()}`,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
        data: { ...node.data },
        selected: false
    };
    nodes.value.push(newNode);
}
function ctxDeleteNode() {
    if (!ctxMenu.value.nodeId)
        return;
    ctxMenu.value.show = false;
    nodes.value = nodes.value.filter(n => n.id !== ctxMenu.value.nodeId);
    edges.value = edges.value.filter(e => e.source !== ctxMenu.value.nodeId && e.target !== ctxMenu.value.nodeId);
}
function ctxDeleteEdge() {
    if (!ctxMenu.value.edgeId)
        return;
    ctxMenu.value.show = false;
    edges.value = edges.value.filter(e => e.id !== ctxMenu.value.edgeId);
}
function ctxEditEdge() {
    if (!ctxMenu.value.edgeId)
        return;
    const edge = edges.value.find(e => e.id === ctxMenu.value.edgeId);
    if (!edge)
        return;
    ctxMenu.value.show = false;
    modalType.value = 'edge';
    modalEdgeData.value = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceLabel: getNodeLabel(edge.source),
        targetLabel: getNodeLabel(edge.target),
        condition: edge.data?.condition || null,
        loop_max: edge.data?.loop_max ?? 3
    };
    modalNodeData.value = null;
    showModal.value = true;
}
onMounted(async () => {
    window.addEventListener('click', hideCtxMenu);
    window.addEventListener('scroll', hideCtxMenu, true);
    // 如果有 execution_id 查询参数，自动进入运行态
    const execId = route.query.execution_id;
    const workflowId = route.query.workflow_id;
    if (execId) {
        mode.value = 'runtime';
        executionId.value = execId;
        await connectExecution();
    }
    else if (workflowId) {
        // 静态编辑态：加载指定的 workflow_id
        selectedGraphId.value = workflowId;
        // 同时加载图列表供下拉选择
        await loadGraphDefs();
        await loadSelectedGraph();
    }
    else {
        // 默认：加载图列表，选中第一张
        await loadGraphDefs();
        if (selectedGraphId.value) {
            await loadSelectedGraph();
        }
    }
});
onUnmounted(() => {
    disconnect();
    window.removeEventListener('click', hideCtxMenu);
    window.removeEventListener('scroll', hideCtxMenu, true);
});
async function pauseExecution() {
    ctxMenu.value.show = false;
    if (!executionId.value)
        return;
    try {
        const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}/pause`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'sub' }),
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            alert('暂停失败: ' + (j.error || r.status));
            return;
        }
        await pollExecution();
    }
    catch (e) {
        alert('暂停异常: ' + (e?.message || e));
    }
}
async function resumeExecution() {
    ctxMenu.value.show = false;
    if (!executionId.value)
        return;
    try {
        const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}/resume`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            alert('继续失败: ' + (j.error || r.status));
            return;
        }
        await pollExecution();
    }
    catch (e) {
        alert('继续异常: ' + (e?.message || e));
    }
}
// 人审 gate 审核：POST /gate { decision, comments }（后端异步受理，立即返回）
async function submitGateReview(decision) {
    if (!executionId.value || !selectedNode.value)
        return;
    reviewing.value = true;
    try {
        const r = await fetch(`/api/executions/${encodeURIComponent(executionId.value)}/gate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, comments: reviewComment.value?.trim() || undefined }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
            alert('审核提交失败: ' + (j.error || r.status));
            return;
        }
        reviewComment.value = '';
        // 受理成功：本地立刻把被审 gate 置 done/驳回，节点列表/详情即时流转（不等 3s 轮询）
        const gid = selectedNode.value?.id;
        if (gid)
            runtimePhases.value.set(gid, decision === 'approve' ? 'done' : 'failed');
        applyState();
        pollExecution(); // 非阻塞拉一次 DB：受理后 status='running'，执行信息面板随即流转
    }
    catch (e) {
        alert('审核异常: ' + (e?.message || e));
    }
    finally {
        reviewing.value = false;
    }
}
// —— 编辑态 ——
function onConnect(conn) {
    addEdges([{ id: `${conn.source}-${conn.target}`, ...conn, markerEnd: 'arrowclosed' }]);
}
function onDragStop() { }
function addNode(type) {
    nodes.value.push({
        id: `${type}-${Date.now()}`,
        type,
        position: { x: 200, y: 200 },
        data: { type, label: type },
    });
}
function updateNodeData(id, data) {
    vfUpdate(id, data);
}
function updateEdgeCondition(condition) {
    if (!selectedEdge.value)
        return;
    const edgeIndex = edges.value.findIndex(e => e.id === selectedEdge.value.id);
    if (edgeIndex !== -1) {
        edges.value[edgeIndex] = {
            ...edges.value[edgeIndex],
            data: {
                ...edges.value[edgeIndex].data,
                condition
            }
        };
    }
}
function updateEdgeLoopMax(loopMax) {
    if (!selectedEdge.value)
        return;
    const edgeIndex = edges.value.findIndex(e => e.id === selectedEdge.value.id);
    if (edgeIndex !== -1) {
        edges.value[edgeIndex] = {
            ...edges.value[edgeIndex],
            data: {
                ...edges.value[edgeIndex].data,
                loop_max: loopMax
            }
        };
    }
}
function sayHello() {
    ElMessage.info('Hello 👋');
}
function debugLog() {
    console.log("=== Canvas 调试信息 ===");
    console.log("模式:", mode.value);
    console.log("节点数量:", nodes.value.length);
    console.log("节点列表:", nodes.value);
    console.log("边数量:", edges.value.length);
    console.log("边列表:", edges.value);
    if (mode.value === "runtime") {
        console.log("执行ID:", executionId.value);
        console.log("连接状态:", connected.value);
        console.log("执行元数据:", rtMeta.value);
        console.log("运行阶段:", runtimePhases.value);
    }
    console.log("=== 调试信息结束 ===");
}
async function save() {
    nodes.value = layoutDagre(nodes.value, edges.value); // 保存前布局
    const name = selectedGraphId.value ? (graphDefs.value.find(g => g.id === selectedGraphId.value)?.name || '新建图') : '新建图';
    const def = toGraphDef(nodes.value, edges.value, name, 'ruoyi');
    const saved = await api.save(def);
    // 更新 selectedGraphId 为新建图的 id
    if (saved?.id && !selectedGraphId.value) {
        selectedGraphId.value = saved.id;
    }
    // 刷新列表
    await loadGraphDefs();
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['canvas-main']} */ ;
/** @type {__VLS_StyleScopedClasses['rt-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-review']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-review']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-review']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-review-btns']} */ ;
/** @type {__VLS_StyleScopedClasses['ctx-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['ctx-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['ctx-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['ctx-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['danger']} */ ;
/** @type {__VLS_StyleScopedClasses['node-list-item']} */ ;
/** @type {__VLS_StyleScopedClasses['node-list-item']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status-dot']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "canvas-wrap" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "canvas-main" },
});
const __VLS_0 = {}.VueFlow;
/** @type {[typeof __VLS_components.VueFlow, typeof __VLS_components.VueFlow, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onConnect': {} },
    ...{ 'onNodeDragStop': {} },
    ...{ 'onNodeContextMenu': {} },
    ...{ 'onEdgeContextMenu': {} },
    ...{ 'onPaneContextMenu': {} },
    ...{ 'onNodeClick': {} },
    ...{ 'onEdgeClick': {} },
    nodes: (__VLS_ctx.nodes),
    edges: (__VLS_ctx.edges),
    defaultEdgeOptions: ({ markerEnd: 'arrowclosed', animated: false }),
    nodesConnectable: (__VLS_ctx.mode === 'static'),
    nodesDraggable: (__VLS_ctx.mode === 'static'),
    elementsDeletable: (__VLS_ctx.mode === 'static'),
    fitViewOnInit: (true),
}));
const __VLS_2 = __VLS_1({
    ...{ 'onConnect': {} },
    ...{ 'onNodeDragStop': {} },
    ...{ 'onNodeContextMenu': {} },
    ...{ 'onEdgeContextMenu': {} },
    ...{ 'onPaneContextMenu': {} },
    ...{ 'onNodeClick': {} },
    ...{ 'onEdgeClick': {} },
    nodes: (__VLS_ctx.nodes),
    edges: (__VLS_ctx.edges),
    defaultEdgeOptions: ({ markerEnd: 'arrowclosed', animated: false }),
    nodesConnectable: (__VLS_ctx.mode === 'static'),
    nodesDraggable: (__VLS_ctx.mode === 'static'),
    elementsDeletable: (__VLS_ctx.mode === 'static'),
    fitViewOnInit: (true),
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onConnect: (__VLS_ctx.onConnect)
};
const __VLS_8 = {
    onNodeDragStop: (__VLS_ctx.onDragStop)
};
const __VLS_9 = {
    onNodeContextMenu: (__VLS_ctx.onNodeContextMenu)
};
const __VLS_10 = {
    onEdgeContextMenu: (__VLS_ctx.onEdgeContextMenu)
};
const __VLS_11 = {
    onPaneContextMenu: (__VLS_ctx.onPaneContextMenu)
};
const __VLS_12 = {
    onNodeClick: (__VLS_ctx.onNodeClick)
};
const __VLS_13 = {
    onEdgeClick: (__VLS_ctx.onEdgeClick)
};
__VLS_3.slots.default;
{
    const { 'node-agent': __VLS_thisSlot } = __VLS_3.slots;
    const [props] = __VLS_getSlotParams(__VLS_thisSlot);
    /** @type {[typeof AgentNode, ]} */ ;
    // @ts-ignore
    const __VLS_14 = __VLS_asFunctionalComponent(AgentNode, new AgentNode({
        ...(props),
    }));
    const __VLS_15 = __VLS_14({
        ...(props),
    }, ...__VLS_functionalComponentArgsRest(__VLS_14));
}
{
    const { 'node-gate': __VLS_thisSlot } = __VLS_3.slots;
    const [props] = __VLS_getSlotParams(__VLS_thisSlot);
    /** @type {[typeof GateNode, ]} */ ;
    // @ts-ignore
    const __VLS_17 = __VLS_asFunctionalComponent(GateNode, new GateNode({
        ...(props),
    }));
    const __VLS_18 = __VLS_17({
        ...(props),
    }, ...__VLS_functionalComponentArgsRest(__VLS_17));
}
{
    const { 'node-command': __VLS_thisSlot } = __VLS_3.slots;
    const [props] = __VLS_getSlotParams(__VLS_thisSlot);
    /** @type {[typeof CommandNode, ]} */ ;
    // @ts-ignore
    const __VLS_20 = __VLS_asFunctionalComponent(CommandNode, new CommandNode({
        ...(props),
    }));
    const __VLS_21 = __VLS_20({
        ...(props),
    }, ...__VLS_functionalComponentArgsRest(__VLS_20));
}
{
    const { 'node-subgraph': __VLS_thisSlot } = __VLS_3.slots;
    const [props] = __VLS_getSlotParams(__VLS_thisSlot);
    /** @type {[typeof SubgraphNode, ]} */ ;
    // @ts-ignore
    const __VLS_23 = __VLS_asFunctionalComponent(SubgraphNode, new SubgraphNode({
        ...(props),
    }));
    const __VLS_24 = __VLS_23({
        ...(props),
    }, ...__VLS_functionalComponentArgsRest(__VLS_23));
}
var __VLS_3;
if (__VLS_ctx.ctxMenu.show) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({
        ...{ onClick: () => { } },
        ...{ class: "ctx-menu" },
        ...{ style: ({ left: __VLS_ctx.ctxMenu.x + 'px', top: __VLS_ctx.ctxMenu.y + 'px' }) },
    });
    if (__VLS_ctx.mode === 'runtime') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (__VLS_ctx.pauseExecution) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (__VLS_ctx.resumeExecution) },
        });
    }
    else if (__VLS_ctx.ctxMenu.context === 'pane') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.ctxMenu.show))
                        return;
                    if (!!(__VLS_ctx.mode === 'runtime'))
                        return;
                    if (!(__VLS_ctx.ctxMenu.context === 'pane'))
                        return;
                    __VLS_ctx.ctxAddNode('agent');
                } },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.ctxMenu.show))
                        return;
                    if (!!(__VLS_ctx.mode === 'runtime'))
                        return;
                    if (!(__VLS_ctx.ctxMenu.context === 'pane'))
                        return;
                    __VLS_ctx.ctxAddNode('gate');
                } },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.ctxMenu.show))
                        return;
                    if (!!(__VLS_ctx.mode === 'runtime'))
                        return;
                    if (!(__VLS_ctx.ctxMenu.context === 'pane'))
                        return;
                    __VLS_ctx.ctxAddNode('command');
                } },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.ctxMenu.show))
                        return;
                    if (!!(__VLS_ctx.mode === 'runtime'))
                        return;
                    if (!(__VLS_ctx.ctxMenu.context === 'pane'))
                        return;
                    __VLS_ctx.ctxAddNode('subgraph');
                } },
        });
    }
    else if (__VLS_ctx.ctxMenu.context === 'node') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (__VLS_ctx.ctxCopyNode) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (__VLS_ctx.ctxDeleteNode) },
            ...{ class: "danger" },
        });
    }
    else if (__VLS_ctx.ctxMenu.context === 'edge') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (__VLS_ctx.ctxEditEdge) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            ...{ onClick: (__VLS_ctx.ctxDeleteEdge) },
            ...{ class: "danger" },
        });
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "bottom-toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-left" },
});
const __VLS_26 = {}.ElRadioGroup;
/** @type {[typeof __VLS_components.ElRadioGroup, typeof __VLS_components.elRadioGroup, typeof __VLS_components.ElRadioGroup, typeof __VLS_components.elRadioGroup, ]} */ ;
// @ts-ignore
const __VLS_27 = __VLS_asFunctionalComponent(__VLS_26, new __VLS_26({
    ...{ 'onChange': {} },
    modelValue: (__VLS_ctx.mode),
    size: "small",
}));
const __VLS_28 = __VLS_27({
    ...{ 'onChange': {} },
    modelValue: (__VLS_ctx.mode),
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_27));
let __VLS_30;
let __VLS_31;
let __VLS_32;
const __VLS_33 = {
    onChange: (__VLS_ctx.onModeChange)
};
__VLS_29.slots.default;
const __VLS_34 = {}.ElRadioButton;
/** @type {[typeof __VLS_components.ElRadioButton, typeof __VLS_components.elRadioButton, typeof __VLS_components.ElRadioButton, typeof __VLS_components.elRadioButton, ]} */ ;
// @ts-ignore
const __VLS_35 = __VLS_asFunctionalComponent(__VLS_34, new __VLS_34({
    value: "static",
}));
const __VLS_36 = __VLS_35({
    value: "static",
}, ...__VLS_functionalComponentArgsRest(__VLS_35));
__VLS_37.slots.default;
var __VLS_37;
const __VLS_38 = {}.ElRadioButton;
/** @type {[typeof __VLS_components.ElRadioButton, typeof __VLS_components.elRadioButton, typeof __VLS_components.ElRadioButton, typeof __VLS_components.elRadioButton, ]} */ ;
// @ts-ignore
const __VLS_39 = __VLS_asFunctionalComponent(__VLS_38, new __VLS_38({
    value: "runtime",
}));
const __VLS_40 = __VLS_39({
    value: "runtime",
}, ...__VLS_functionalComponentArgsRest(__VLS_39));
__VLS_41.slots.default;
var __VLS_41;
var __VLS_29;
if (__VLS_ctx.mode === 'static') {
    const __VLS_42 = {}.ElSelect;
    /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
    // @ts-ignore
    const __VLS_43 = __VLS_asFunctionalComponent(__VLS_42, new __VLS_42({
        ...{ 'onChange': {} },
        modelValue: (__VLS_ctx.selectedGraphId),
        size: "small",
        placeholder: "选择图定义",
        ...{ style: {} },
    }));
    const __VLS_44 = __VLS_43({
        ...{ 'onChange': {} },
        modelValue: (__VLS_ctx.selectedGraphId),
        size: "small",
        placeholder: "选择图定义",
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_43));
    let __VLS_46;
    let __VLS_47;
    let __VLS_48;
    const __VLS_49 = {
        onChange: (__VLS_ctx.loadSelectedGraph)
    };
    __VLS_45.slots.default;
    for (const [g] of __VLS_getVForSourceType((__VLS_ctx.graphDefs))) {
        const __VLS_50 = {}.ElOption;
        /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
        // @ts-ignore
        const __VLS_51 = __VLS_asFunctionalComponent(__VLS_50, new __VLS_50({
            key: (g.id),
            label: (g.name),
            value: (g.id),
        }));
        const __VLS_52 = __VLS_51({
            key: (g.id),
            label: (g.name),
            value: (g.id),
        }, ...__VLS_functionalComponentArgsRest(__VLS_51));
    }
    var __VLS_45;
}
if (__VLS_ctx.mode === 'runtime') {
    const __VLS_54 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_55 = __VLS_asFunctionalComponent(__VLS_54, new __VLS_54({
        ...{ 'onKeyup': {} },
        modelValue: (__VLS_ctx.executionId),
        placeholder: "execution ID",
        size: "small",
        ...{ class: "rt-id" },
    }));
    const __VLS_56 = __VLS_55({
        ...{ 'onKeyup': {} },
        modelValue: (__VLS_ctx.executionId),
        placeholder: "execution ID",
        size: "small",
        ...{ class: "rt-id" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_55));
    let __VLS_58;
    let __VLS_59;
    let __VLS_60;
    const __VLS_61 = {
        onKeyup: (__VLS_ctx.connectExecution)
    };
    var __VLS_57;
    const __VLS_62 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_63 = __VLS_asFunctionalComponent(__VLS_62, new __VLS_62({
        ...{ 'onClick': {} },
        size: "small",
        type: (__VLS_ctx.connected ? 'success' : 'default'),
    }));
    const __VLS_64 = __VLS_63({
        ...{ 'onClick': {} },
        size: "small",
        type: (__VLS_ctx.connected ? 'success' : 'default'),
    }, ...__VLS_functionalComponentArgsRest(__VLS_63));
    let __VLS_66;
    let __VLS_67;
    let __VLS_68;
    const __VLS_69 = {
        onClick: (__VLS_ctx.connectExecution)
    };
    __VLS_65.slots.default;
    (__VLS_ctx.connected ? '断开' : '连接');
    var __VLS_65;
    if (__VLS_ctx.rtMeta) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "rt-meta" },
        });
        (__VLS_ctx.rtMeta.status === 'running' ? '运行中' : __VLS_ctx.rtMeta.status === 'completed' ? '已完成' : __VLS_ctx.rtMeta.status === 'paused' ? '已暂停' : __VLS_ctx.rtMeta.status === 'failed' ? '失败' : __VLS_ctx.rtMeta.status);
        (__VLS_ctx.rtMeta.token_in != null ? __VLS_ctx.rtMeta.token_in : '-');
        (__VLS_ctx.rtMeta.token_out != null ? __VLS_ctx.rtMeta.token_out : '-');
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-right" },
});
const __VLS_70 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_71 = __VLS_asFunctionalComponent(__VLS_70, new __VLS_70({
    ...{ 'onClick': {} },
    size: "small",
}));
const __VLS_72 = __VLS_71({
    ...{ 'onClick': {} },
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_71));
let __VLS_74;
let __VLS_75;
let __VLS_76;
const __VLS_77 = {
    onClick: (__VLS_ctx.debugLog)
};
__VLS_73.slots.default;
var __VLS_73;
const __VLS_78 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_79 = __VLS_asFunctionalComponent(__VLS_78, new __VLS_78({
    ...{ 'onClick': {} },
    size: "small",
}));
const __VLS_80 = __VLS_79({
    ...{ 'onClick': {} },
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_79));
let __VLS_82;
let __VLS_83;
let __VLS_84;
const __VLS_85 = {
    onClick: (__VLS_ctx.sayHello)
};
__VLS_81.slots.default;
var __VLS_81;
if (__VLS_ctx.mode === 'static') {
    const __VLS_86 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_87 = __VLS_asFunctionalComponent(__VLS_86, new __VLS_86({
        ...{ 'onClick': {} },
        size: "small",
        type: "primary",
        ...{ class: "save-btn" },
    }));
    const __VLS_88 = __VLS_87({
        ...{ 'onClick': {} },
        size: "small",
        type: "primary",
        ...{ class: "save-btn" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_87));
    let __VLS_90;
    let __VLS_91;
    let __VLS_92;
    const __VLS_93 = {
        onClick: (__VLS_ctx.save)
    };
    __VLS_89.slots.default;
    var __VLS_89;
}
/** @type {[typeof NodeEditModal, ]} */ ;
// @ts-ignore
const __VLS_94 = __VLS_asFunctionalComponent(NodeEditModal, new NodeEditModal({
    ...{ 'onClose': {} },
    ...{ 'onSave': {} },
    visible: (__VLS_ctx.showModal),
    editType: (__VLS_ctx.modalType),
    nodeData: (__VLS_ctx.modalNodeData),
    edgeData: (__VLS_ctx.modalEdgeData),
}));
const __VLS_95 = __VLS_94({
    ...{ 'onClose': {} },
    ...{ 'onSave': {} },
    visible: (__VLS_ctx.showModal),
    editType: (__VLS_ctx.modalType),
    nodeData: (__VLS_ctx.modalNodeData),
    edgeData: (__VLS_ctx.modalEdgeData),
}, ...__VLS_functionalComponentArgsRest(__VLS_94));
let __VLS_97;
let __VLS_98;
let __VLS_99;
const __VLS_100 = {
    onClose: (__VLS_ctx.onModalClose)
};
const __VLS_101 = {
    onSave: (__VLS_ctx.onModalSave)
};
var __VLS_96;
if (__VLS_ctx.mode === 'runtime') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "runtime-panel" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-title" },
    });
    if (__VLS_ctx.rtMeta) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "panel-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "label" },
        });
        const __VLS_102 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_103 = __VLS_asFunctionalComponent(__VLS_102, new __VLS_102({
            type: (__VLS_ctx.rtMeta.status === 'running' ? 'primary' : __VLS_ctx.rtMeta.status === 'completed' ? 'success' : __VLS_ctx.rtMeta.status === 'failed' ? 'danger' : __VLS_ctx.rtMeta.status === 'paused' ? 'warning' : 'info'),
            size: "small",
        }));
        const __VLS_104 = __VLS_103({
            type: (__VLS_ctx.rtMeta.status === 'running' ? 'primary' : __VLS_ctx.rtMeta.status === 'completed' ? 'success' : __VLS_ctx.rtMeta.status === 'failed' ? 'danger' : __VLS_ctx.rtMeta.status === 'paused' ? 'warning' : 'info'),
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_103));
        __VLS_105.slots.default;
        (__VLS_ctx.rtMeta.status === 'running' ? '运行中' : __VLS_ctx.rtMeta.status === 'completed' ? '已完成' : __VLS_ctx.rtMeta.status === 'paused' ? '已暂停' : __VLS_ctx.rtMeta.status === 'failed' ? '失败' : __VLS_ctx.rtMeta.status);
        var __VLS_105;
        if (__VLS_ctx.rtMeta.token_in != null) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "panel-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "value" },
            });
            (__VLS_ctx.rtMeta.token_in);
            (__VLS_ctx.rtMeta.token_out);
        }
        if (__VLS_ctx.rtMeta.current_node_id) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "panel-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "value" },
            });
            (__VLS_ctx.rtMeta.current_node_id);
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-title" },
        ...{ style: {} },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "node-list" },
    });
    for (const [n] of __VLS_getVForSourceType((__VLS_ctx.nodes))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.mode === 'runtime'))
                        return;
                    __VLS_ctx.selectNodeById(n.id);
                } },
            key: (n.id),
            ...{ class: "node-list-item" },
            ...{ class: (__VLS_ctx.runtimePhases.get(n.id) || 'pending') },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "node-status-dot" },
            ...{ class: (__VLS_ctx.runtimePhases.get(n.id) || 'pending') },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "node-list-label" },
        });
        (n.data?.label || n.id);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "node-list-status" },
        });
        (__VLS_ctx.nodeStatusLabel(n.type, __VLS_ctx.runtimePhases.get(n.id)));
    }
    if (__VLS_ctx.selectedNode) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "panel-title" },
            ...{ style: {} },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "panel-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "value" },
        });
        (__VLS_ctx.selectedNode.id);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "panel-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "value" },
        });
        (__VLS_ctx.selectedNode.type);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "panel-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "label" },
        });
        const __VLS_106 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_107 = __VLS_asFunctionalComponent(__VLS_106, new __VLS_106({
            type: (__VLS_ctx.selectedNode.data?.status === 'running' ? 'primary' : __VLS_ctx.selectedNode.data?.status === 'done' ? 'success' : __VLS_ctx.selectedNode.data?.status === 'failed' ? 'danger' : __VLS_ctx.selectedNode.data?.status === 'paused' ? 'warning' : 'info'),
            size: "small",
        }));
        const __VLS_108 = __VLS_107({
            type: (__VLS_ctx.selectedNode.data?.status === 'running' ? 'primary' : __VLS_ctx.selectedNode.data?.status === 'done' ? 'success' : __VLS_ctx.selectedNode.data?.status === 'failed' ? 'danger' : __VLS_ctx.selectedNode.data?.status === 'paused' ? 'warning' : 'info'),
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_107));
        __VLS_109.slots.default;
        (__VLS_ctx.statusLabel(__VLS_ctx.selectedNode.data?.status));
        var __VLS_109;
        if (__VLS_ctx.selectedNode.data?.badge) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "panel-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "value" },
            });
            (__VLS_ctx.selectedNode.data.badge);
        }
        if (__VLS_ctx.selectedNode.data?.agent_binding_ids?.length) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "panel-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "value" },
            });
            (__VLS_ctx.selectedNode.data.agent_binding_ids.join(', '));
        }
        if (__VLS_ctx.isGateReviewable) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "gate-review" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "panel-title" },
            });
            const __VLS_110 = {}.ElInput;
            /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
            // @ts-ignore
            const __VLS_111 = __VLS_asFunctionalComponent(__VLS_110, new __VLS_110({
                type: "textarea",
                modelValue: (__VLS_ctx.reviewComment),
                rows: (3),
                resize: "none",
                placeholder: "审核意见（可选）",
                ...{ class: "gate-comment" },
            }));
            const __VLS_112 = __VLS_111({
                type: "textarea",
                modelValue: (__VLS_ctx.reviewComment),
                rows: (3),
                resize: "none",
                placeholder: "审核意见（可选）",
                ...{ class: "gate-comment" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_111));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "gate-review-btns" },
            });
            const __VLS_114 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_115 = __VLS_asFunctionalComponent(__VLS_114, new __VLS_114({
                ...{ 'onClick': {} },
                type: "success",
                size: "small",
                loading: (__VLS_ctx.reviewing),
            }));
            const __VLS_116 = __VLS_115({
                ...{ 'onClick': {} },
                type: "success",
                size: "small",
                loading: (__VLS_ctx.reviewing),
            }, ...__VLS_functionalComponentArgsRest(__VLS_115));
            let __VLS_118;
            let __VLS_119;
            let __VLS_120;
            const __VLS_121 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.mode === 'runtime'))
                        return;
                    if (!(__VLS_ctx.selectedNode))
                        return;
                    if (!(__VLS_ctx.isGateReviewable))
                        return;
                    __VLS_ctx.submitGateReview('approve');
                }
            };
            __VLS_117.slots.default;
            var __VLS_117;
            const __VLS_122 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_123 = __VLS_asFunctionalComponent(__VLS_122, new __VLS_122({
                ...{ 'onClick': {} },
                type: "danger",
                size: "small",
                loading: (__VLS_ctx.reviewing),
            }));
            const __VLS_124 = __VLS_123({
                ...{ 'onClick': {} },
                type: "danger",
                size: "small",
                loading: (__VLS_ctx.reviewing),
            }, ...__VLS_functionalComponentArgsRest(__VLS_123));
            let __VLS_126;
            let __VLS_127;
            let __VLS_128;
            const __VLS_129 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.mode === 'runtime'))
                        return;
                    if (!(__VLS_ctx.selectedNode))
                        return;
                    if (!(__VLS_ctx.isGateReviewable))
                        return;
                    __VLS_ctx.submitGateReview('reject');
                }
            };
            __VLS_125.slots.default;
            var __VLS_125;
        }
    }
    else if (!__VLS_ctx.selectedNode) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "panel-hint" },
        });
    }
}
if (__VLS_ctx.mode === 'runtime' && __VLS_ctx.connected) {
    /** @type {[typeof LiveEventStream, ]} */ ;
    // @ts-ignore
    const __VLS_130 = __VLS_asFunctionalComponent(LiveEventStream, new LiveEventStream({
        executionId: (__VLS_ctx.executionId),
        ...{ class: "rt-stream" },
    }));
    const __VLS_131 = __VLS_130({
        executionId: (__VLS_ctx.executionId),
        ...{ class: "rt-stream" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_130));
}
/** @type {__VLS_StyleScopedClasses['canvas-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['canvas-main']} */ ;
/** @type {__VLS_StyleScopedClasses['ctx-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['danger']} */ ;
/** @type {__VLS_StyleScopedClasses['danger']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-left']} */ ;
/** @type {__VLS_StyleScopedClasses['rt-id']} */ ;
/** @type {__VLS_StyleScopedClasses['rt-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-right']} */ ;
/** @type {__VLS_StyleScopedClasses['save-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['runtime-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-title']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['value']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['value']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-title']} */ ;
/** @type {__VLS_StyleScopedClasses['node-list']} */ ;
/** @type {__VLS_StyleScopedClasses['node-list-item']} */ ;
/** @type {__VLS_StyleScopedClasses['node-status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['node-list-label']} */ ;
/** @type {__VLS_StyleScopedClasses['node-list-status']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-title']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['value']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['value']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['value']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-row']} */ ;
/** @type {__VLS_StyleScopedClasses['label']} */ ;
/** @type {__VLS_StyleScopedClasses['value']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-review']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-title']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-comment']} */ ;
/** @type {__VLS_StyleScopedClasses['gate-review-btns']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['rt-stream']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            VueFlow: VueFlow,
            AgentNode: AgentNode,
            GateNode: GateNode,
            CommandNode: CommandNode,
            SubgraphNode: SubgraphNode,
            NodeEditModal: NodeEditModal,
            LiveEventStream: LiveEventStream,
            nodes: nodes,
            edges: edges,
            selectedNode: selectedNode,
            isGateReviewable: isGateReviewable,
            reviewComment: reviewComment,
            reviewing: reviewing,
            showModal: showModal,
            modalType: modalType,
            modalNodeData: modalNodeData,
            modalEdgeData: modalEdgeData,
            selectNodeById: selectNodeById,
            statusLabel: statusLabel,
            nodeStatusLabel: nodeStatusLabel,
            graphDefs: graphDefs,
            selectedGraphId: selectedGraphId,
            loadSelectedGraph: loadSelectedGraph,
            mode: mode,
            executionId: executionId,
            connected: connected,
            runtimePhases: runtimePhases,
            rtMeta: rtMeta,
            onModeChange: onModeChange,
            connectExecution: connectExecution,
            ctxMenu: ctxMenu,
            onPaneContextMenu: onPaneContextMenu,
            onNodeContextMenu: onNodeContextMenu,
            onEdgeContextMenu: onEdgeContextMenu,
            onNodeClick: onNodeClick,
            onEdgeClick: onEdgeClick,
            onModalClose: onModalClose,
            onModalSave: onModalSave,
            ctxAddNode: ctxAddNode,
            ctxCopyNode: ctxCopyNode,
            ctxDeleteNode: ctxDeleteNode,
            ctxDeleteEdge: ctxDeleteEdge,
            ctxEditEdge: ctxEditEdge,
            pauseExecution: pauseExecution,
            resumeExecution: resumeExecution,
            submitGateReview: submitGateReview,
            onConnect: onConnect,
            onDragStop: onDragStop,
            sayHello: sayHello,
            debugLog: debugLog,
            save: save,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
