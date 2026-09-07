// core/web/src/router.ts —— 路由配置
import { createRouter, createWebHistory } from 'vue-router'
import Canvas from './views/Canvas.vue'
import Requirements from './views/Requirements.vue'
import Tasks from './views/Tasks.vue'
import TaskDetail from './views/TaskDetail.vue'
import ExecutionOverview from './views/ExecutionOverview.vue'
import AgentConfig from './views/AgentConfig.vue'
import AgentDetail from './views/AgentDetail.vue'
import SkillConfig from './views/SkillConfig.vue'
import SkillDetail from './views/SkillDetail.vue'
import WorkflowList from './views/WorkflowList.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Requirements },
    { path: '/canvas', component: Canvas },
    { path: '/requirements', component: Requirements },
    { path: '/tasks', component: Tasks },
    { path: '/tasks/:id', component: TaskDetail },
    { path: '/executions', component: ExecutionOverview },
    { path: '/agents', component: AgentConfig },
    { path: '/agents/new', component: AgentDetail },
    { path: '/agents/:id', component: AgentDetail },
    { path: '/skills', component: SkillConfig },
    { path: '/skills/new', component: SkillDetail },
    { path: '/skills/:id', component: SkillDetail },
    { path: '/workflows', component: WorkflowList },
  ],
})