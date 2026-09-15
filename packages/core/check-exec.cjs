const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  const exec = await db.task_executions.findUnique({
    where: { execution_id: "e71c420f-c4dc-42fb-ae4e-4808d7efee07" },
    select: {
      status: true,
      stage: true,
      thread_id: true,
      session_id: true,
      error_message: true,
      loop_counters: true,
      node_outputs: true,
      completed_at: true
    }
  });
  
  console.log("执行状态:", JSON.stringify(exec, null, 2));
  console.log("\nloop_counters type:", typeof exec?.loop_counters);
  console.log("node_outputs type:", typeof exec?.node_outputs);

  await db.$disconnect();
}
main();
