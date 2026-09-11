# PRODUCT.md · 璇玑 (Xuanji) Console

## Register

**product** — admin/monitoring dashboard for long-running AI agent orchestration

## Users

- **开发者 / AI 工程师**：配置 agent、定义工作流、查看执行细节
- **QA**：验证 AI 交付质量、审查测试结果
- **项目经理**：跟踪需求拆解进度、任务完成情况
- **运维 / SRE**：监控系统健康、处理限流和僵尸执行

## Product Purpose

管理长时运行（30 分钟到数小时）AI Agent 的研发流程：
- 需求被拆解为树形结构，逐层调度执行
- 每个任务经过多阶段流水线（开发→测试→审查→修复→终审）
- Agent 可以中途向人类提问（人机交互）
- 人类可以暂停、继续、取消、重试任何执行

## Core User Tasks

1. **监控**：某个任务跑到哪一步了？花了多久？
2. **复盘**：AI 这次做了什么？输出了什么代码/测试？
3. **介入**：AI 问了问题，我要回答；或者我要暂停/重试
4. **审计**：为什么这个任务失败了？卡在哪个阶段？

## Brand / Tone

- 名字"璇玑"取自古代天文仪器，运转有序、周而复始
- **深色终端风**（#0B0F1A 深空底色 + 青色强调）
- Swiss Minimalism：强对比、克制、信息密度高但不拥挤
- 状态色语义化：done 绿 / running 青（动画）/ pending 灰 / failed 红 / paused 黄
- AI 语义色：紫色（#7C3AED）
- 中文界面，面向中文用户
- 字体：Space Grotesk（UI） + JetBrains Mono（代码）

## Anti-references

- 不要 SaaS cream/beige
- 不要玻璃态（glassmorphism）
- 不要侧条纹强调
- 不要大数字英雄区
- 不要千篇一律的卡片网格

## Strategic Principles

1. **状态优先**：用户在 dashboard 的第一眼必须是"这个任务现在怎么样了"
2. **可见的工作**：AI 的实际产出应该直接展示，不要藏在抽屉里
3. **时间线感**：长时运行任务需要让用户感受到"时间流过"，时间戳和耗时是关键信息
4. **可干预**：任何阶段都能暂停/继续/重试，操作要触手可及
5. **审计可追溯**：完整对话记录 + 决策留痕 + 阶段产出物
