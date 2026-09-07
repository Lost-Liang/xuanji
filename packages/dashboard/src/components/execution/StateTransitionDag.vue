<template>
  <!-- StateTransitionDag：checkpoint 时间线 + 拖游标定格回看（spec §9.4 回溯重放） -->
  <div class="std-wrap">
    <div class="std-header">
      <span class="std-title">状态转换时间线</span>
      <span class="std-meta" :class="state">{{ stateLabel }}</span>
      <span v-if="checkpoints.length" class="std-count">共 {{ checkpoints.length }} 个快照</span>
    </div>
    <div class="std-body">
      <div v-if="!checkpoints.length && state === 'idle'" class="std-empty">输入 execution ID 后加载</div>
      <div v-else-if="!checkpoints.length && state === 'loading'" class="std-empty">加载中…</div>
      <div v-else-if="!checkpoints.length && state === 'error'" class="std-empty">加载失败，请检查 execution ID 或后端</div>
      <div v-else class="std-timeline">
        <div
          v-for="(cp, i) in checkpoints"
          :key="cp.checkpoint_id"
          class="std-cp"
          :class="{ active: i === activeIdx }"
          @click="pick(i)"
        >
          <span class="std-idx">#{{ i }}</span>
          <span class="std-next" :title="cp.next?.join(',') || 'END'">{{ cp.next?.length ? cp.next.join(',') : 'END' }}</span>
          <span class="std-ts">{{ fmtTime(cp.created_at) }}</span>
        </div>
      </div>
    </div>
    <div v-if="activeSnap" class="std-snap">
      <div class="std-snap-h">定格快照 #{{ activeIdx }} <span class="std-snap-ts">{{ fmtTime(activeSnap.created_at) }}</span></div>
      <pre class="std-snap-v">{{ prettyValues }}</pre>
      <div class="std-snap-next">下一节点：{{ activeSnap.next?.length ? activeSnap.next.join(', ') : '(END)' }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
// core/web/src/components/execution/StateTransitionDag.vue
// checkpoint 时间线游标：拖/点 checkpoint 定格 → 展示 snap.values 摘要（spec §9.4 回溯重放，只读不改 state）
// props 仅 executionId，内部 fetch（照 LiveEventStream 模式）
import { ref, computed, watch } from 'vue'

const props = defineProps<{ executionId?: string }>()

type Cp = { checkpoint_id: string; values: any; next: string[]; created_at: string }
const checkpoints = ref<Cp[]>([])
const activeIdx = ref<number>(-1)
const state = ref<'idle' | 'loading' | 'error'>('idle')
const stateLabel = ref('未加载')
const activeSnap = computed(() => activeIdx.value >= 0 ? checkpoints.value[activeIdx.value] : null)
const prettyValues = computed(() => {
  const v = activeSnap.value?.values
  try { return v == null ? '(空)' : JSON.stringify(v, null, 2) } catch { return String(v) }
})

function setState(s: 'idle' | 'loading' | 'error') {
  state.value = s
  stateLabel.value = s === 'loading' ? '加载中' : s === 'error' ? '加载错误' : '未加载'
}

function fmtTime(t?: string): string {
  if (!t) return ''
  try { return new Date(t).toLocaleString('zh-CN', { hour12: false }) } catch { return t }
}

async function load(id: string) {
  if (!id) { checkpoints.value = []; activeIdx.value = -1; setState('idle'); return }
  setState('loading')
  checkpoints.value = []
  activeIdx.value = -1
  try {
    const r = await fetch(`/api/executions/${encodeURIComponent(id)}/checkpoints`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const list = await r.json() as Cp[]
    checkpoints.value = Array.isArray(list) ? list : []
    setState('idle')
    if (checkpoints.value.length) pick(0)
  } catch {
    setState('error')
  }
}

function pick(i: number) {
  activeIdx.value = i
}

watch(() => props.executionId, (id) => load(id || ''), { immediate: true })
</script>
<style scoped>
.std-wrap { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); overflow: hidden; }
.std-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.std-title { font-size: 12px; font-weight: 600; color: var(--text); font-family: var(--font-ui); }
.std-meta { font-size: 10px; padding: 2px 7px; border-radius: 4px; background: var(--surface); color: var(--muted); font-family: var(--font-mono); }
.std-meta.loading { background: rgba(245,158,11,.12); color: var(--st-paused); }
.std-meta.error { background: rgba(239,68,68,.12); color: var(--st-failed); }
.std-count { margin-left: auto; font-size: 11px; color: var(--faint); font-family: var(--font-mono); }
.std-body { flex: 1; overflow-y: auto; padding: 8px 12px; }
.std-empty { font-size: 12px; color: var(--faint); text-align: center; padding: 24px 0; }
.std-timeline { display: flex; flex-direction: column; gap: 4px; }
.std-cp { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; transition: border-color .15s, background .15s; }
.std-cp:hover { background: var(--surface); }
.std-cp.active { border-color: var(--accent); background: var(--surface-2); }
.std-idx { font-family: var(--font-mono); color: var(--faint); flex-shrink: 0; }
.std-next { font-family: var(--font-mono); color: var(--accent); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.std-ts { color: var(--faint); font-variant-numeric: tabular-nums; flex-shrink: 0; font-family: var(--font-mono); font-size: 11px; }
.std-snap { border-top: 1px solid var(--border); padding: 10px 12px; background: var(--surface); }
.std-snap-h { font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 6px; display: flex; align-items: center; gap: 8px; font-family: var(--font-ui); }
.std-snap-ts { font-weight: 400; color: var(--faint); font-family: var(--font-mono); }
.std-snap-v { margin: 0; max-height: 200px; overflow: auto; font-size: 11px; font-family: var(--font-mono); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px; white-space: pre-wrap; word-break: break-all; color: var(--text); }
.std-snap-next { margin-top: 5px; font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
</style>
