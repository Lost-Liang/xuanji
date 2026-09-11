# DESIGN.md · 璇玑 Console

## Palette (OKLCH-inspired, source of truth = theme.css)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0B0F1A` | 页面底（深空） |
| `--panel` | `#11161F` | 卡片 / 侧栏 |
| `--surface` | `#161C28` | 次级面 / hover |
| `--surface-2` | `#1C2433` | 激活态 |
| `--border` | `#1E293B` | 主边框 |
| `--border-soft` | `#16202F` | 弱分割 |
| `--text` | `#F8FAFC` | 正文 |
| `--muted` | `#94A3B8` | 次要文字 |
| `--faint` | `#64748B` | 禁用 / 占位 |
| `--accent` | `#22D3EE` | 品牌青 / running / 主操作 |
| `--accent-dim` | `#0E7490` | 青的 hover / 暗态 |
| `--ai` | `#7C3AED` | 紫 / AI / agent 语义 |
| `--ai-dim` | `#4C1D95` | 紫暗 |
| `--st-done` | `#22C55E` | 完成绿 |
| `--st-running` | `#22D3EE` | 执行中青（带 pulse 动画） |
| `--st-pending` | `#64748B` | 待执行灰 |
| `--st-failed` | `#EF4444` | 失败红 |
| `--st-paused` | `#F59E0B` | 暂停黄 |

## Typography

| Role | Family | Size |
|---|---|---|
| UI (labels, titles) | Space Grotesk | 11–16px |
| Body | system-ui | 13–14px |
| Mono (code, ids) | JetBrains Mono | 11–13px |

Scale ratio: ≥1.25 between steps. Line cap: 65–75ch for body.

## Radius

- `--radius: 9px`（卡片）
- `--radius-sm: 6px`（按钮、pill、内嵌元素）

## Components

### Status pill (`.st-pill`)

Status badge across all pages. Border + tinted bg + dot.
- `.running` — 青色，带发光 dot（pulse）
- `.done` — 绿色
- `.failed` — 红色
- `.paused` — 黄色
- `.pending` — 灰

### Vue Flow nodes (`.vf-node`)

- `t-agent` — 紫底
- `t-gate` — 黄底
- `t-command` — 灰底
- `t-subgraph` — 紫底（加深）
- Status overlay: `st-done` / `st-running` / `st-failed` / `st-paused`

### Canvas aside panel (`.canvas-aside`)

- 10.5px 大写字母标签
- Mono 字体字段
- 列表项带 mono 图标（青色）

## Motion

- Ease-out-quart / expo for transitions
- `v2-pulse`：running dot 发光
- `v2-noderun`：running node 边框 glow
- `prefers-reduced-motion` 已支持

## Anti-patterns (project-specific)

- 不要侧条纹（border-left accent）
- 不要渐变文字
- 不要玻璃态
- 不要大数字英雄区
- 不要重复卡片网格
- 中文界面不要用 em dash
