# claude-agents-101

A progressive, hands-on course for building AI agent applications with the Claude API and Claude Agent SDK — 12 sessions, from a raw agentic loop to a full multi-agent team.

> **Language note:** Course content (session READMEs and inline code comments) is written in Chinese, targeting the Chinese developer community. The code itself is TypeScript and fully readable regardless of language.

## What you'll build

Each session introduces one new mechanism. By the end you'll have implemented:

- A minimal agentic loop from scratch (~50 lines, no framework)
- A declarative tool system with automatic schema generation
- A planning layer that keeps agents on track
- Subagent spawning with isolated contexts
- On-demand skill loading to avoid bloated system prompts
- Three context compaction strategies for long-running agents
- A persistent task system with a dependency graph (DAG)
- A dependency-driven concurrent scheduler with worker agents
- A multi-agent team communicating via a shared blackboard
- A structured review protocol with consensus voting
- An autonomous agent powered by the Claude Agent SDK
- Git worktree sandboxing so concurrent agents never interfere

## Tech stack

| | |
|---|---|
| Runtime | [Bun](https://bun.sh) — native TypeScript, no compile step |
| Language | TypeScript (strict mode) |
| Module system | ESM |
| Claude SDK | `@anthropic-ai/sdk` + `@anthropic-ai/claude-agent-sdk` |
| Schema | Zod + `betaZodTool` |

## Curriculum

### Phase 1 — The Loop

| Session | Topic | Key mechanism | Motto |
|---------|-------|---------------|-------|
| [s01](sessions/s01-agent-loop/) | Agent Loop | Hand-written agentic loop | "One loop & Bash is all you need" |
| [s02](sessions/s02-tool-system/) | Tool System | `betaZodTool` + tool runner | "Adding a tool means adding one handler" |

### Phase 2 — Planning & Knowledge

| Session | Topic | Key mechanism | Motto |
|---------|-------|---------------|-------|
| [s03](sessions/s03-planning/) | Planning | Todo list as agent working memory | "An agent without a plan drifts" |
| [s04](sessions/s04-subagents/) | Subagents | Claude Agent SDK `query()` | "Break big tasks down; each subtask gets a clean context" |
| [s05](sessions/s05-skills/) | Skills | Lazy-loaded knowledge files | "Load knowledge when you need it, not upfront" |
| [s06](sessions/s06-context-compact/) | Context Compact | Truncation / summarization / SDK compaction | "Context will fill up; you need a way to make room" |

### Phase 3 — Persistence

| Session | Topic | Key mechanism | Motto |
|---------|-------|---------------|-------|
| [s07](sessions/s07-task-system/) | Task System | Persistent CRUD + DAG dependency graph | "Break big goals into small tasks, order them, persist to disk" |
| [s08](sessions/s08-background-tasks/) | Background Tasks | Dependency-driven concurrent scheduler | "Plan once, execute concurrently" |

### Phase 4 — Teams

| Session | Topic | Key mechanism | Motto |
|---------|-------|---------------|-------|
| [s09](sessions/s09-agent-teams/) | Agent Teams | Blackboard pattern + role specialization | "Specialized roles, shared blackboard" |
| [s10](sessions/s10-team-protocols/) | Team Protocols | Typed message bus + consensus review | "Agree before you ship" |
| [s11](sessions/s11-autonomous-agents/) | Autonomous Agents | Agent SDK `query()` with built-in tools | "Give it a goal, not a script" |
| [s12](sessions/s12-worktree-isolation/) | Worktree Isolation | Git worktree sandboxing per agent | "Each agent gets its own sandbox" |

## Quick start

**1. Install Bun**

```bash
curl -fsSL https://bun.sh/install | bash
```

**2. Install dependencies**

```bash
bun install
```

**3. Set up environment**

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY
```

**4. Run any session**

```bash
bun run s01
bun run s02
# ... through s12
```

Each session is self-contained. Sessions s07→s08 share a task file; all others are independent.

## Project structure

```
claude-agents-101-js/
├── shared/                  # @learn/shared — logger and common utilities
├── sessions/
│   ├── s01-agent-loop/      # Each session: package.json + index.ts + README.md
│   ├── s02-tool-system/
│   ├── s03-planning/
│   ├── s04-subagents/
│   ├── s05-skills/
│   ├── s06-context-compact/
│   ├── s07-task-system/
│   ├── s08-background-tasks/
│   ├── s09-agent-teams/
│   ├── s10-team-protocols/
│   ├── s11-autonomous-agents/
│   └── s12-worktree-isolation/
├── package.json             # Bun workspace root
└── tsconfig.json
```

Each session is an independent workspace package. Dependencies are declared per-session; shared utilities come from `@learn/shared`.

## References

- [Anthropic API Documentation](https://docs.anthropic.com)
- [Claude Agent SDK — TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Anthropic SDK — TypeScript](https://github.com/anthropics/anthropic-sdk-typescript)
- [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) — original Python version this course is based on
