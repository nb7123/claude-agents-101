# s03 — Planning

> **Motto:** "An agent without a plan drifts"

## 一句话

给 agent 工具集加入 `todo_write` / `todo_update`，让 LLM 先制定计划，再按计划执行，避免在复杂任务中迷失方向。

## 核心概念

**问题：** s01/s02 的 agent 拿到任务就执行，没有全局规划。任务一复杂，容易跳步骤、重复操作。

**解法：** Todo list 工具作为 agent 的外部记忆——不是给用户看的，是给 LLM 自己看的。它出现在 messages 历史里，让 LLM 每轮都知道"还剩什么要做"。

**关键洞察：** 结构化 todo list 引导 LLM 的思维模式——从"当前能做什么"转变为"计划是什么、执行到哪了"。

## 本课要点

| 要点 | 说明 |
|------|------|
| `TodoItem` | `{ id, title, status, priority }` — 状态机驱动的任务项 |
| 持久化 | `/tmp/todos.json`，进程重启后可继续 |
| `todo_write` | 创建或覆盖整个 todo list |
| `todo_update` | 更新单条任务的 status / priority |
| System prompt | 明确要求 agent "先写 todo，再执行" |

## 数据结构

```typescript
interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
}
```

## Agent 行为模式

```
用户请求 →
  [todo_write]  制定计划（3-5 个步骤）→
  [tool_use]    执行步骤 1 →
  [todo_update] 标记 step-1 为 done →
  [tool_use]    执行步骤 2 →
  ...
  [todo_update] 所有步骤 done → 汇报结果
```

## 运行

```sh
bun run s03
```

---

**上一课：** [s02 — Tool System](../s02-tool-system/) — betaZodTool 工具体系
**下一课：** [s04 — Subagents](../s04-subagents/) — 任务分发给独立 agent，隔离 context
