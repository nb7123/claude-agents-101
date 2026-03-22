# s01 — Agent Loop

> **Motto:** "One loop & Bash is all you need"

## 一句话

手写最小可运行的 agentic loop，不依赖任何框架，理解 agent 的本质结构。

## 核心概念

**Agent loop 的本质是一个 while 循环：**

```
user input → LLM → stop_reason?
  "end_turn"  → 任务完成，退出循环
  "tool_use"  → 执行工具 → 追加结果到 messages → 继续循环
```

**关键洞察：messages 数组是 loop 的全部状态。**
它随着每次迭代增长，LLM 通过它"记住"之前做了什么。没有数据库，没有状态机——只有一个不断增长的消息列表。

## 本课要点

| 要点 | 说明 |
|------|------|
| `Anthropic.Tool` | 工具定义：JSON Schema 描述参数，`description` 告诉 LLM 何时用 |
| `stop_reason` | `"end_turn"` = 结束，`"tool_use"` = 继续 |
| `messages` 追加 | 每次迭代都 push assistant 响应 + tool_result，LLM 靠这个记忆 |
| Bash 工具 | 最小化工具集：一个 bash 就能做文件操作、执行脚本 |

## 代码结构

```typescript
while (true) {
  const response = await client.messages.create({ tools, messages });

  messages.push({ role: "assistant", content: response.content });

  if (response.stop_reason === "end_turn") break;

  // 执行工具，收集结果
  const results = await executeTools(response.content);
  messages.push({ role: "user", content: results });
}
```

## 运行

```sh
bun run s01
```

---

**下一课：** [s02 — Tool System](../s02-tool-system/) — 用 `betaZodTool` 重构，消除手写 dispatch
