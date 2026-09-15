import { db } from './src/db.mjs';

async function main() {
  // 查找最新的 task execution
  const latest = await db.task_executions.findFirst({
    where: { task_id: { not: null } },
    orderBy: { created_at: 'desc' },
    select: {
      execution_id: true,
      task_id: true,
      status: true,
      stage: true,
      graph_definition_id: true,
      thread_id: true,
      session_id: true,
      created_at: true,
      started_at: true,
      completed_at: true,
      error_message: true,
      tasks: { select: { title: true, description: true } },
    },
  });

  console.log('=== 最新 Task Execution ===');
  console.log(JSON.stringify(latest, null, 2));

  if (latest) {
    // 查询 phase_instances
    const phases = await db.phase_instances.findMany({
      where: { execution_id: latest.execution_id },
      orderBy: { started_at: 'asc' },
    });
    console.log('\n=== Phase Instances ===');
    console.log(JSON.stringify(phases, null, 2));

    // 查询 execution_events
    const events = await db.execution_events.findMany({
      where: { execution_id: latest.execution_id },
      orderBy: { created_at: 'asc' },
      take: 50,
    });
    console.log('\n=== Execution Events ===');
    console.log(JSON.stringify(events, null, 2));

    // 查询 conversation_events (最近100条)
    const convEvents = await db.conversation_events.findMany({
      where: { execution_id: latest.execution_id },
      orderBy: { created_at: 'asc' },
      take: 100,
      select: {
        id: true,
        event_type: true,
        role: true,
        content: true,
        node_id: true,
        created_at: true,
      },
    });
    console.log('\n=== Conversation Events (summary) ===');
    console.log(JSON.stringify(convEvents.map(e => ({
      type: e.event_type,
      role: e.role,
      node: e.node_id,
      time: e.created_at,
      content_preview: typeof e.content === 'string' ? e.content.slice(0, 150) : '(object)'
    })), null, 2));
  }

  await db.$disconnect();
}

main().catch(console.error);
