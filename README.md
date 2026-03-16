# startup-ai

使用 Claude API 和 Claude Agent SDK 构建 Agent 应用的渐进式学习项目。

共 12 课，每课引入一个新机制，从零开始手写 agentic loop，最终实现多 Agent 协作系统。

## 技术栈

- **运行时**: [Bun](https://bun.sh) — 原生 TypeScript，无需编译步骤
- **语言**: TypeScript（strict mode）
- **模块系统**: ESM
- **核心 SDK**: `@anthropic-ai/sdk` + `@anthropic-ai/claude-agent-sdk`
- **Schema 验证**: Zod

## 课程结构

### Phase 1 — The Loop（基础循环）

| 课程 | 主题 | 核心机制 | 格言 |
|------|------|----------|------|
| s01 | Agent Loop | 手写最小 agentic loop | "One loop & Bash is all you need" |
| s02 | Tool System | `betaZodTool` + tool runner | "Adding a tool means adding one handler" |

### Phase 2 — Planning & Knowledge（规划与知识）

| 课程 | 主题 | 核心机制 | 格言 |
|------|------|----------|------|
| s03 | Planning | TodoWrite 计划层 | "An agent without a plan drifts" |
| s04 | Subagents | Claude Agent SDK 子代理 | "Break big tasks down; each subtask gets a clean context" |
| s05 | Skills | 动态知识注入 | "Load knowledge when you need it, not upfront" |
| s06 | Context Compact | 上下文压缩 | "Context will fill up; you need a way to make room" |

### Phase 3 — Persistence（持久化）

| 课程 | 主题 | 核心机制 | 格言 |
|------|------|----------|------|
| s07 | Task System | 文件型任务 CRUD + 依赖图 | "Break big goals into small tasks, order them, persist to disk" |
| s08 | Background Tasks | 异步后台任务 | "Run slow operations in the background; the agent keeps thinking" |

### Phase 4 — Teams（团队协作）

| 课程 | 主题 | 核心机制 | 格言 |
|------|------|----------|------|
| s09 | Agent Teams | 多 Agent + JSONL 邮箱通信 | "When the task is too big for one, delegate to teammates" |
| s10 | Team Protocols | 统一请求/响应协议 + FSM | "Teammates need shared communication rules" |
| s11 | Autonomous Agents | Agent 自主认领任务 | "Teammates scan the board and claim tasks themselves" |
| s12 | Worktree Isolation | Git worktree 任务隔离 | "Each works in its own directory, no interference" |

## 快速开始

**1. 安装 Bun**

```bash
curl -fsSL https://bun.sh/install | bash
```

**2. 安装依赖**

```bash
bun install
```

**3. 配置环境变量**

```bash
cp .env.example .env
# 编辑 .env，填入你的 ANTHROPIC_API_KEY
```

**4. 运行课程**

```bash
bun run s01   # 运行 s01
bun run s02   # 运行 s02
# ...

# 开发模式（热重载）
bun --watch run sessions/s01-agent-loop/index.ts
```

## 项目结构

```
startup-ai/
├── shared/                     # @learn/shared — 公共工具（logger 等）
├── sessions/
│   ├── s01-agent-loop/         # 每课独立的 package.json + index.ts
│   ├── s02-tool-system/
│   └── ...
├── package.json                # Workspace root
└── tsconfig.json               # Bun 最优 TS 配置
```

每个 session 是独立的 workspace package，拥有自己的依赖声明，通过 `@learn/shared` 共享公共工具。

## 参考

- [Anthropic API Docs](https://docs.anthropic.com)
- [Claude Agent SDK (TypeScript)](https://github.com/anthropics/claude-agent-sdk-typescript)
- 课程设计参考：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)（Python 版本）
