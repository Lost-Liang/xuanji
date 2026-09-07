// 画布编辑态简易 store
import { ref } from 'vue'
import type { GraphDef } from '../api/graph'
import { api } from '../api/graph'

export const currentDef = ref<GraphDef | null>(null)

export async function loadGraph(id: string) {
  const row = await api.get(id)
  if (row) currentDef.value = row.definition_json
}

export async function saveGraph(def: GraphDef) {
  await api.save(def)
  currentDef.value = def
}
