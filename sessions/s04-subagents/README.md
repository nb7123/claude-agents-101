# s04 — Subagents

> **Motto:** "Break big tasks down; each subtask gets a clean context"

## 一句话

将大任务分解给多个独立的子代理执行，每个子代理拥有完全隔离的 context，互不污染。

## 核心概念

**问题：** 单个 agent 处理复杂任务时，messages 越来越长，不同子任务的信息互相污染，影响质量。

**解法：** 子代理模式——主 agent 负责分解和协调，子代理各自独立完成子任务，context 完全隔离。

**首次使用 Claude Agent SDK `query()`**，它运行在 Claude Code CLI 之上，内置文件/命令访问能力，无需手动定义 Read/Bash 等工具。

## 两种调用方式

### 方式一：Programmatic（代码直接 spawn）

主程序完全控制子代理的生命周期：

```typescript
async function runSubagent(task: string): Promise<string> {
  for await (const message of query({ prompt: task, options: { ... } })) {
    if ("result" in message) return message.result;
  }
}
// 并发执行
const results = await Promise.all(tasks.map(runSubagent));
```

### 方式二：Via Agent Tool（LLM 自己决定）

把 `query` 封装成工具，让 LLM 自主决定何时 spawn 子代理：

```typescript
const spawnSubagentTool = betaZodTool({
  name: "spawn_subagent",
  run: async ({ task }) => runSubagent(task),
});
```

## 本课要点

| 要点 | 说明 |
|------|------|
| `query()` | Agent SDK 入口，返回 AsyncIterable 消息流 |
| `allowedTools` | 控制子代理可用的工具集 |
| `maxTurns` | 防止子代理无限运行的预算控制 |
| Context 隔离 | 每个子代理有独立的 messages 数组，互不干扰 |
| `Promise.all` | 多个子代理并发执行，加速处理 |

## 运行

```sh
bun run s04
```

---

**上一课：** [s03 — Planning](../s03-planning/) — agent 内部规划
**下一课：** [s05 — Skills](../s05-skills/) — 按需加载知识，而不是塞满 system prompt
