---
name: security-and-hardening
description: 加固代码防止漏洞。在处理用户输入、认证、数据存储或外部集成时使用。在构建任何接受不可信数据、管理用户会话或与第三方服务交互的功能时使用。
---

# 安全与加固

## 概述

Web 应用的安全优先开发实践。将每个外部输入视为敌对的，每个密钥视为神圣的，每个授权检查视为强制的。安全不是一个阶段——它是涉及用户数据、认证或外部系统的每行代码的约束。

## 何时使用

- 构建任何接受用户输入的东西
- 实现认证或授权
- 存储或传输敏感数据
- 与外部 API 或服务集成
- 添加文件上传、webhook 或回调
- 处理支付或 PII 数据

## 流程：先做威胁建模

没有威胁模型的控制只是猜测。加固前，花五分钟像攻击者一样思考：

1. **映射信任边界。** 不可信数据在哪里进入你的系统？HTTP 请求、表单字段、文件上传、webhook、第三方 API、消息队列和 **LLM 输出**。每个边界都是攻击面。
2. **命名资产。** 什么值得偷或破坏？凭证、PII、支付数据、管理员操作、资金流动。
3. **对每个边界运行 STRIDE** —— 一个快速透镜，不是仪式：

| 威胁 | 问 | 典型缓解 |
|---|---|---|
| **S**欺骗（Spoofing） | 有人能冒充用户/服务吗？ | 认证、签名验证 |
| **T**篡改（Tampering） | 数据能在传输中或静态被修改吗？ | 完整性检查、参数化查询、HTTPS |
| **R**否认（Repudiation） | 行为能被事后否认吗？ | 安全事件的审计日志 |
| **I**信息泄露（Information disclosure） | 数据能泄露吗？ | 加密、字段白名单、通用错误 |
| **D**拒绝服务（Denial of service） | 能被过载吗？ | 速率限制、输入大小上限、超时 |
| **E**权限提升（Elevation of privilege） | 用户能获得不该有的权限吗？ | 授权检查、最小权限 |

4. **在用例旁边写滥用案例。** 对每个功能，问"我会如何滥用它？"——然后把它作为第一个测试。

如果你无法命名功能的信任边界，你还没准备好保护它。这是 OWASP **A04: 不安全设计** —— 大多数入侵始于设计，不是代码。

## 三层边界系统

### 始终执行（无例外）

- **在系统边界验证所有外部输入**（API 路由、表单处理器）
- **参数化所有数据库查询** —— 永远不要拼接用户输入到 SQL
- **编码输出** 以防止 XSS（使用框架自动转义，不要绕过它）
- **所有外部通信使用 HTTPS**
- **使用 bcrypt/scrypt/argon2 哈希密码**（永不存储明文）
- **设置安全头**（CSP、HSTS、X-Frame-Options、X-Content-Type-Options）
- **会话使用 httpOnly、secure、sameSite cookie**
- **每次发布前对提交的锁文件运行检测到的包管理器原生审计**

### 先询问（需要人工批准）

- 添加新认证流程或更改认证逻辑
- 存储新类别的敏感数据（PII、支付信息）
- 添加新的外部服务集成
- 更改 CORS 配置
- 添加文件上传处理器
- 修改速率限制或节流
- 授予提升的权限或角色

### 绝不执行

- **永不提交密钥** 到版本控制（API key、密码、token）
- **永不记录敏感数据**（密码、token、完整信用卡号）
- **永不信任客户端验证** 作为安全边界
- **永不为便利禁用安全头**
- **永不使用 `eval()` 或 `innerHTML`** 处理用户提供的数据
- **永不将会话存储在客户端可访问的存储中**（localStorage 存认证 token）
- **永不向用户暴露堆栈跟踪** 或内部错误详情

## OWASP Top 10 防护模式

这些是防护模式，不是排名。关于 2021 年排序，见 `../../references/security-checklist.md` 的快速参考表。

### 注入（SQL、NoSQL、OS 命令）

```typescript
// 坏：通过字符串拼接进行 SQL 注入
const query = `SELECT * FROM users WHERE id = '${userId}'`;

// 好：参数化查询
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// 好：带参数化输入的 ORM
const user = await prisma.user.findUnique({ where: { id: userId } });
```

### 认证失效

```typescript
// 密码哈希
import { hash, compare } from 'bcrypt';

const SALT_ROUNDS = 12;
const hashedPassword = await hash(plaintext, SALT_ROUNDS);
const isValid = await compare(plaintext, hashedPassword);

// 会话管理
app.use(session({
  secret: process.env.SESSION_SECRET,  // 来自环境，不是代码
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,     // 不能通过 JavaScript 访问
    secure: true,       // 仅 HTTPS
    sameSite: 'lax',    // CSRF 保护
    maxAge: 24 * 60 * 60 * 1000,  // 24 小时
  },
}));
```

### 跨站脚本（XSS）

```typescript
// 坏：将用户输入渲染为 HTML
element.innerHTML = userInput;

// 好：使用框架自动转义（React 默认这样做）
return <div>{userInput}</div>;

// 如果必须渲染 HTML，先净化
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(userInput);
```

### 访问控制失效

```typescript
// 始终检查授权，不只是认证
app.patch('/api/tasks/:id', authenticate, async (req, res) => {
  const task = await taskService.findById(req.params.id);

  // 检查认证用户拥有此资源
  if (task.ownerId !== req.user.id) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: '无权修改此任务' }
    });
  }

  // 继续更新
  const updated = await taskService.update(req.params.id, req.body);
  return res.json(updated);
});
```

### 安全配置错误

```typescript
// 安全头（Express 使用 helmet）
import helmet from 'helmet';
app.use(helmet());

// 内容安全策略
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],  // 如果可能收紧
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
  },
}));

// CORS —— 限制为已知来源
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
  credentials: true,
}));
```

### 敏感数据泄露

```typescript
// 永远不要在 API 响应中返回敏感字段
function sanitizeUser(user: UserRecord): PublicUser {
  const { passwordHash, resetToken, ...publicFields } = user;
  return publicFields;
}

// 使用环境变量存储密钥
const API_KEY = process.env.STRIPE_API_KEY;
if (!API_KEY) throw new Error('STRIPE_API_KEY 未配置');
```

### 服务端请求伪造（SSRF）

任何时候服务器获取用户影响的 URL——webhook、"从 URL 导入"、图片代理、链接预览——攻击者可以将其指向内部服务（云元数据、`localhost`、私有 IP）。

```typescript
// 坏：获取用户给你的任何东西
await fetch(req.body.webhookUrl);

// 好：白名单 scheme + host，拒绝任何解析为私有 IP，禁止重定向
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const ALLOWED_HOSTS = new Set(['hooks.example.com']);

async function assertSafeUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('仅允许 https');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('host 不允许');
  // 解析所有记录；单个私有/保留地址就会失败
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.some((a) => ipaddr.parse(a.address).range() !== 'unicast')) {
    throw new Error('私有/保留 IP');
  }
  return url;
}

await fetch(await assertSafeUrl(req.body.webhookUrl), { redirect: 'error' });
```

`range() !== 'unicast'` 检查覆盖回环、链路本地 `169.254.169.254`（云元数据，#1 SSRF 目标）、私有和唯一本地范围，涵盖 IPv4 和 IPv6。

**注意事项 —— 这仍有 TOCTOU 缺口。** `fetch` 在检查后再次解析 DNS，所以使用短 TTL 记录的攻击者可以在验证和连接之间重新绑定到内部 IP。对于高风险表面，解析一次并连接到固定的 IP，或在前面放过滤代理（`request-filtering-agent` / `ssrf-req-filter`）。

## 输入验证模式

### 边界模式验证

```typescript
import { z } from 'zod';

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().datetime().optional(),
});

// 在路由处理器验证
app.post('/api/tasks', async (req, res) => {
  const result = CreateTaskSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: '输入无效',
        details: result.error.flatten(),
      },
    });
  }
  // result.data 现在已类型化并验证
  const task = await taskService.create(result.data);
  return res.status(201).json(task);
});
```

### 文件上传安全

```typescript
// 限制文件类型和大小
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function validateUpload(file: UploadedFile) {
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    throw new ValidationError('文件类型不允许');
  }
  if (file.size > MAX_SIZE) {
    throw new ValidationError('文件太大（最大 5MB）');
  }
  // 不信任文件扩展名 —— 如关键检查魔数
}
```

## 分类依赖审计结果

包管理器审计报告已知公告；它们不证明包可信或易受攻击代码可达。使用此决策树：

```
原生包管理器审计报告漏洞
├── 严重性：严重或高
│   ├── 易受攻击代码在运行时、构建、测试或部署路径中可达吗？
│   │   ├── 是 --> 立即修复（更新、打补丁或替换依赖）
│   │   └── 否（确认在这些路径中未使用） --> 尽快修复，但非阻塞
│   └── 有修复可用吗？
│       ├── 是 --> 更新到已修补版本
│       └── 否 --> 检查变通方案，考虑替换依赖，或添加到白名单并设置审查日期
├── 严重性：中
│   ├── 生产环境可达？ --> 在下一个发布周期修复
│   └── 仅开发环境？ --> 方便时修复，在待办事项中跟踪
└── 严重性：低
    └── 跟踪并在常规依赖更新期间修复
```

**关键问题：**

- 易受攻击的函数在你的代码路径中实际被调用吗？
- 依赖是运行时依赖还是仅开发环境？
- 考虑你的部署上下文，漏洞可利用吗（如客户端应用中的服务端漏洞）？

当延期修复时，记录原因并设置审查日期。

### 供应链卫生

不要假设 npm 或将最近的清单视为安装根。应用此顺序：

1. **找到安装边界和管理器。** 使用拥有锁文件的工作区根，或仅当独立嵌套项目在工作区外时才使用它。在那里，验证 `packageManager`（当存在时）、锁文件和 CI；发现不一致或竞争锁文件时停止。固定管理器版本并使用 `../../references/security-checklist.md` 中的矩阵。
2. **在首次执行前阻止依赖脚本。** 以禁用脚本或有文档记录的失败关闭策略启动，检查待执行脚本源，仅批准最低要求的包，提交策略，然后用干净的冻结/不可变安装验证。永不全批准脚本。

审计只发现已知公告；它们不捕获新恶意或抢注包。因此：

- **永不自动应用强制审计修复**（`npm audit fix --force` 或等效）。预览修复，阅读变更日志，测试每个升级；强制修复可能跨越声明的依赖范围。
- **在支持的地方验证注册表签名和来源**（`npm audit signatures`、`pnpm audit signatures`），将缺失视为调查信号，不是自动证明受损。
- **一起审查新依赖、锁文件 diff 和脚本策略变更** —— 所有权、维护、发布年龄、来源、传递图和抢注如 `cross-env` vs `crossenv`（OWASP **A06**、**LLM03**）。

## 速率限制

```typescript
import rateLimit from 'express-rate-limit';

// 通用 API 速率限制
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100,                   // 每 15 分钟 100 次请求
  standardHeaders: true,
  legacyHeaders: false,
}));

// 认证端点更严格的限制
app.use('/api/auth/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,  // 每 15 分钟 10 次尝试
}));
```

## 密钥管理

```
.env 文件:
  ├── .env.example  → 已提交（带占位值的模板）
  ├── .env          → 未提交（包含真实密钥）
  └── .env.local    → 未提交（本地覆盖）

.gitignore 必须包含:
  .env
  .env.local
  .env.*.local
  *.pem
  *.key
```

**提交前始终检查：**

```bash
# 检查意外暂存的密钥
git diff --cached | grep -i "password\|secret\|api_key\|token"
```

**如果密钥曾被提交，轮换它。** 删除行或重写历史不够——假设它在到达远程的那一刻就已泄露。先撤销并重新签发密钥，然后从历史中清除。

## 保护 AI / LLM 功能

如果你的应用调用 LLM——聊天机器人、摘要器、agent、RAG——它继承了新的攻击面。将其映射到 [OWASP LLM 应用 Top 10 (2025)](https://genai.owasp.org/llm-top-10/)：

- **将所有模型输出视为不可信输入（LLM05：不当输出处理）。** 永不将 LLM 输出直接传入 `eval`、SQL、shell、`innerHTML` 或文件路径。像处理原始用户输入一样验证和编码它。
- **假设提示可能被劫持（LLM01：提示注入）。** 上下文窗口中的不可信文本——用户消息、获取的网页、PDF——可能携带指令。系统提示不是安全边界；在代码中强制权限，不在提示中。
- **将密钥和其他用户数据排除在提示外（LLM02 / LLM07）。** 上下文中的任何东西都可能被回显。不要把 API key、跨租户数据或完整系统提示放在模型能重复的地方。
- **约束工具和 agent 权限（LLM06：过度代理）。** 将工具限定在最小范围，对破坏性或不可逆操作要求确认，验证每个工具参数。
- **限制消耗（LLM10：无限消耗）。** 限制 token、请求速率和循环/递归深度，使精心构造的输入无法推高成本或挂起系统。
- **隔离检索数据（LLM08：向量和嵌入弱点）。** 在 RAG 中，将向量存储视为信任边界：按租户分区嵌入，使用户无法检索另一个用户的数据，并在索引前验证文档，使投毒内容无法引导答案。

```typescript
// 坏：信任模型输出作为命令或标记
const sql = await llm.generate(`为以下内容编写 SQL: ${userQuestion}`);
await db.query(sql);                                   // 任意查询执行
container.innerHTML = await llm.reply(userMessage);   // 存储 XSS，通过模型

// 好：模型输出是数据 —— 防御性解析，然后验证，然后编码
let intent;
try {
  intent = CommandSchema.parse(JSON.parse(await llm.replyJson(userMessage)));
} catch {
  throw new ValidationError('意外的模型输出'); // JSON.parse 或模式失败
}
await runAllowlistedAction(intent.action, intent.params);
container.textContent = await llm.reply(userMessage);
```

## 安全审查检查清单

```markdown
### 认证
- [ ] 密码用 bcrypt/scrypt/argon2 哈希（盐轮数 ≥ 12）
- [ ] 会话 token 是 httpOnly、secure、sameSite
- [ ] 登录有速率限制
- [ ] 密码重置 token 会过期

### 授权
- [ ] 每个端点检查用户权限
- [ ] 用户只能访问自己的资源
- [ ] 管理操作需要管理员角色验证

### 输入
- [ ] 所有用户输入在边界验证
- [ ] SQL 查询参数化
- [ ] HTML 输出编码/转义
- [ ] 服务端 URL 获取白名单（无 SSRF 到内部服务）

### 数据
- [ ] 代码或版本控制中无密钥
- [ ] API 响应排除敏感字段
- [ ] PII 静态加密（如适用）

### 基础设施
- [ ] 安全头配置（CSP、HSTS 等）
- [ ] CORS 限制为已知来源
- [ ] 依赖审计漏洞
- [ ] 错误消息不暴露内部信息

### 供应链
- [ ] 一个权威锁文件已提交；CI 使用该管理器的冻结/不可变安装
- [ ] 原生审计按可达性和修复风险分类；依赖安装脚本被阻止除非明确批准
- [ ] 新依赖已审查（所有权、来源、发布年龄、传递图）

### AI / LLM（如使用）
- [ ] 模型输出视为不可信（无 eval/SQL/innerHTML/shell）
- [ ] 密钥和其他用户数据排除在提示外
- [ ] 工具/agent 权限限定；破坏性操作需要确认
```

## 参见

详细安全检查清单和预提交验证步骤见 `../../references/security-checklist.md`。

## 常见的合理化借口

| 合理化借口 | 现实 |
|---|---|
| "这是内部工具，安全不重要" | 内部工具会被攻破。攻击者针对最薄弱环节。 |
| "我们以后再加安全" | 安全改造比一开始就做难 10 倍。现在加。 |
| "没人会尝试利用这个" | 自动扫描器会发现它。隐匿安全不是安全。 |
| "框架处理安全" | 框架提供工具，不保证。你仍需正确使用它们。 |
| "只是原型" | 原型会变成生产。从第一天就有安全习惯。 |
| "威胁建模在这里过度" | 五分钟的"我会如何攻击它？"防止设计缺陷——那是任何控制都无法后期修补的。 |
| "只是 LLM 输出，只是文本" | 那"文本"可能是 SQL 语句、script 标签或 shell 命令。像处理任何不可信输入一样处理它。 |
| "审计通过了，所以依赖安全" | 审计匹配已知公告。它们不检测新恶意包或让未审查的安装脚本安全执行。 |

## 危险信号

- 用户输入直接传入数据库查询、shell 命令或 HTML 渲染
- 源代码或提交历史中的密钥
- 无认证或授权检查的 API 端点
- 缺少 CORS 配置或通配符（`*`）来源
- 认证端点无速率限制
- 向用户暴露堆栈跟踪或内部错误
- 有已知严重漏洞的依赖、一个安装边界有竞争锁文件、不可复现安装或全批准脚本
- 服务端获取用户提供的 URL 无白名单（SSRF）
- LLM/模型输出传入查询、DOM、shell 或 `eval`
- 密钥、PII 或完整系统提示放在 LLM 上下文窗口中

## 验证

实现安全相关代码后：

- [ ] 原生审计无未缓解的可达严重/高发现；CI 保留权威锁文件并阻止未审查的依赖脚本
- [ ] 源代码或 git 历史中无密钥
- [ ] 所有用户输入在系统边界验证
- [ ] 每个受保护端点检查认证和授权
- [ ] 响应中存在安全头（用浏览器 DevTools 检查）
- [ ] 错误响应不暴露内部细节
- [ ] 认证端点启用速率限制
- [ ] 服务端 URL 获取对照白名单验证（无 SSRF）
- [ ] LLM/模型输出在使用前验证和编码（如存在 AI 功能）