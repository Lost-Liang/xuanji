// core/server/src/graph/nodes/gate-node.mts —— review gate interrupt 挂起等人审（spec §4.2/§5，调研 C1/C3）
import { interrupt } from '@langchain/langgraph'

export function makeGateNode(opts: { gateId: string }) {
  return async (_state: any) => {
    // interrupt 同步抛 GraphInterrupt 挂起；Command(resume={decision,comments}) 后这里返回该值
    const review = interrupt<{ gate_id: string }, { decision: 'approve' | 'reject'; comments?: string }>({
      gate_id: opts.gateId,
    })
    return { review_decisions: [review] }  // 条件边 path 读 review_decisions 路由
  }
}
