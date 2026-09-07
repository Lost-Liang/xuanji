<template>
  <!-- PhaseTimelineGantt：phase 产出物时间线甘特图（spec §9.1/§9.4，自研 MVP） -->
  <div class="gnt-wrap">
    <div class="gnt-header">
      <span class="gnt-title">Phase 产出物甘特图</span>
      <span class="gnt-meta" :class="state">{{ stateLabel }}</span>
      <span v-if="outputs.length" class="gnt-count">共 {{ outputs.length }} 条产出</span>
    </div>
    <div class="gnt-body">
      <div v-if="!outputs.length && state === 'idle'" class="gnt-empty">输入 execution ID 后加载</div>
      <div v-else-if="!outputs.length && state === 'loading'" class="gnt-empty">加载中…</div>
      <div v-else-if="!outputs.length && state === 'error'" class="gnt-empty">加载失败，请检查 execution ID 或后端</div>
      <table v-else class="gnt-table">
        <thead>
          <tr>
            <th>节点 / Phase</th>
            <th>迭代</th>
            <th>文件变更</th>
            <th>Diff</th>
            <th>PR</th>
            <th>测试</th>
            <th>审查</th>
            <th>编译</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(o, i) in outputs" :key="i">
            <td class="gnt-node" :title="o.node_id">{{ o.node_id }}</td>
            <td class="gnt-iter">{{ o.iteration }}</td>
            <td class="gnt-fc">{{ fmtFileChanges(o.file_changes) }}</td>
            <td class="gnt-diff">
              <a v-if="o.diff_content" href="javascript:void(0)" @click="showDiff(o)">查看</a>
              <span v-else>-</span>
            </td>
            <td class="gnt-pr">
              <a v-if="o.pr_url" :href="o.pr_url" target="_blank" rel="noopener">PR</a>
              <span v-else>-</span>
            </td>
            <td class="gnt-cell" :class="cellClass(o.test_result)">{{ fmtResult(o.test_result) }}</td>
            <td class="gnt-cell" :class="cellClass(o.review_result)">{{ fmtResult(o.review_result) }}</td>
            <td class="gnt-cell" :class="cellClass(o.compile_result)">{{ fmtResult(o.compile_result) }}</td>
            <td class="gnt-ts">{{ fmtTime(o.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
<script setup lang="ts">
// core/web/src/components/execution/PhaseTimelineGantt.vue
// phase 产出物甘特（spec §9.1 自研 MVP）：列 node_id × 迭代，行级 diff/PR/测试/审查/编译结果
// token 量叠加按 spec §9.4 裁定：execution 级聚合已有（graph_executions.token_in/out），节点级无数据源——不造，省略
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{ executionId?: string }>()

type Out = {
  id: string; execution_id: string; node_id: string; iteration: number;
  file_changes: any; diff_content: string | null; pr_url: string | null;
  test_result: any; review_result: any; compile_result: any; created_at: string;
}
const outputs = ref<Out[]>([])
const state = ref<'idle' | 'loading' | 'error'>('idle')
const stateLabel = ref('未加载')

function setState(s: 'idle' | 'loading' | 'error') {
  state.value = s
  stateLabel.value = s === 'loading' ? '加载中' : s === 'error' ? '加载错误' : '未加载'
}

function fmtTime(t?: string | null): string {
  if (!t) return '-'
  try { return new Date(t).toLocaleString('zh-CN', { hour12: false }) } catch { return t }
}
function fmtFileChanges(fc: any): string {
  if (!fc) return '-'
  try {
    const a = Array.isArray(fc) ? fc : [fc]
    const n = a.length
    const paths = a.map((x: any) => typeof x === 'string' ? x : (x?.path || x?.file || JSON.stringify(x))).filter(Boolean)
    if (paths.length <= 2) return paths.join(', ')
    return `${paths.slice(0, 2).join(', ')} +${paths.length - 2}`
  } catch { return String(fc).slice(0, 30) }
}
function fmtResult(r: any): string {
  if (r == null) return '-'
  try {
    if (typeof r === 'boolean') return r ? '通过' : '失败'
    if (typeof r === 'object') {
      const status = r.status || r.pass || r.success
      if (status != null) return status ? '通过' : '失败'
      return r.summary || r.message || JSON.stringify(r).slice(0, 24)
    }
    return String(r).slice(0, 24)
  } catch { return String(r) }
}
function cellClass(r: any): string {
  if (r == null) return ''
  let ok = false
  if (typeof r === 'boolean') ok = r
  else if (typeof r === 'object') ok = r.status === 'pass' || r.status === 'success' || r.pass === true || r.success === true
  return ok ? 'gnt-ok' : 'gnt-fail'
}
function showDiff(o: Out) {
  ElMessage({ message: o.diff_content || '(空 diff)', type: 'info', duration: 5000, showClose: true })
}

async function load(id: string) {
  if (!id) { outputs.value = []; setState('idle'); return }
  setState('loading')
  outputs.value = []
  try {
    const r = await fetch(`/api/executions/${encodeURIComponent(id)}/outputs`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const list = await r.json() as Out[]
    outputs.value = Array.isArray(list) ? list : []
    setState('idle')
  } catch {
    setState('error')
  }
}

watch(() => props.executionId, (id) => load(id || ''), { immediate: true })
</script>
<style scoped>
.gnt-wrap { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); overflow: hidden; }
.gnt-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.gnt-title { font-size: 12px; font-weight: 600; color: var(--text); font-family: var(--font-ui); }
.gnt-meta { font-size: 10px; padding: 2px 7px; border-radius: 4px; background: var(--surface); color: var(--muted); font-family: var(--font-mono); }
.gnt-meta.loading { background: rgba(245,158,11,.12); color: var(--st-paused); }
.gnt-meta.error { background: rgba(239,68,68,.12); color: var(--st-failed); }
.gnt-count { margin-left: auto; font-size: 11px; color: var(--faint); font-family: var(--font-mono); }
.gnt-body { flex: 1; overflow: auto; }
.gnt-empty { font-size: 12px; color: var(--faint); text-align: center; padding: 24px 0; }
.gnt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gnt-table th { position: sticky; top: 0; background: var(--surface-2); color: var(--muted); font-weight: 600; padding: 7px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; z-index: 1; font-family: var(--font-ui); font-size: 11px; letter-spacing: .02em; }
.gnt-table td { padding: 7px 8px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; color: var(--text); }
.gnt-table tr:hover td { background: var(--surface); }
.gnt-node { font-family: var(--font-mono); color: var(--accent); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gnt-iter { font-variant-numeric: tabular-nums; color: var(--faint); text-align: center; font-family: var(--font-mono); }
.gnt-fc { color: var(--muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gnt-diff a, .gnt-pr a { color: var(--accent); text-decoration: none; }
.gnt-diff a:hover, .gnt-pr a:hover { text-decoration: underline; }
.gnt-cell { text-align: center; font-size: 11.5px; }
.gnt-cell.gnt-ok { color: var(--st-done); }
.gnt-cell.gnt-fail { color: var(--st-failed); }
.gnt-ts { color: var(--faint); font-variant-numeric: tabular-nums; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; }
</style>
