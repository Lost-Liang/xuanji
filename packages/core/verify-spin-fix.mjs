// 验证：调度器空转修复
//
// 复现"僵尸回收后"的执行状态：status=pending + graph_definition_id 已设 + 无 worker。
// 这正是旧代码会无限空转的输入。
//
// 旧代码：workerNode 见到 graph_definition_id 就 `return {status:'idle'}`，
//         不写库 —— 执行仍是 pending，scheduleNode 下一轮又捞起，无限循环。
// 新代码：重新派发给 graphRunner —— 无论成功/失败，执行都会离开 pending，循环终止。
import { db } from './dist/db.mjs';
import { workerNode } from './dist/graph/worker-graph.mjs';

const EXEC_ID = 'spin-repro-test-0001';
const FLOW = '__spin_repro_nonexistent_flow__';

async function main() {
  await db.task_executions.deleteMany({ where: { execution_id: EXEC_ID } });
  await db.task_executions.create({
    data: {
      execution_id: EXEC_ID,
      subject_type: 'task',
      subject_id: 'none',
      target_project_id: 'default',
      target_repo_path: process.cwd(),
      status: 'pending',
      graph_definition_id: FLOW,
    },
  });

  const before = await db.task_executions.findUnique({ where: { execution_id: EXEC_ID } });
  console.log(`造数完成: status=${before.status}, graph_definition_id=${before.graph_definition_id}, worker_id=${before.worker_id}`);

  const result = await workerNode({
    executionId: EXEC_ID,
    taskId: null,
    status: 'dispatched',
    error: undefined,
  });
  console.log('workerNode 返回:', JSON.stringify(result));

  const after = await db.task_executions.findUnique({ where: { execution_id: EXEC_ID } });
  console.log(`调用后: status=${after.status}, error_message=${after.error_message}`);

  const spinBroken = after.status !== 'pending';
  console.log(
    spinBroken
      ? '✅ 空转已破除：执行已离开 pending，scheduleNode 不会再捞起它'
      : '❌ 仍停在 pending —— 空转依旧',
  );

  await db.task_executions.deleteMany({ where: { execution_id: EXEC_ID } });
  console.log('已清理测试数据');
  process.exit(spinBroken ? 0 : 1);
}

main().catch((e) => {
  console.error('脚本出错:', e);
  process.exit(2);
});
