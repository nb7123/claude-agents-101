# s02 — Tool System

> **Motto:** "Adding a tool means adding one handler"

## 一句话

用 `betaZodTool` + tool runner 重构 s01，让每个工具成为独立单元，添加工具无需修改循环逻辑。

## 核心概念

**s01 vs s02 的对比：**

| | s01 | s02 |
|---|---|---|
| 工具定义 | 手写 JSON Schema | `betaZodTool(name, desc, ZodSchema, fn)` |
| 工具分发 | `if/else` dispatch | 自动 |
| Loop | 手写 `while` | tool runner 内置 |
| 添加工具 | 改 Schema + 改 dispatch | 只加一个 `betaZodTool` |

**关键洞察：tool runner 把 s01 的 while loop 内化了。**
你只需要定义"工具做什么"，不需要关心"工具何时被调用"。

## 本课要点

| 要点 | 说明 |
|------|------|
| `betaZodTool` | name + description + Zod schema + run fn，一体化工具定义 |
| `client.beta.messages.toolRunner()` | 自动处理 tool_use 循环，返回 AsyncIterable |
| Zod schema | 自动生成 JSON Schema，TypeScript 类型同步 |
| 扩展性 | 新增工具只需添加 `betaZodTool`，其他代码不变 |

## 代码结构

```typescript
const myTool = betaZodTool({
  name: "tool_name",
  description: "When and how to use this tool",
  inputSchema: z.object({ param: z.string() }),
  run: async ({ param }) => {
    // 工具逻辑
    return result;
  },
});

const runner = client.beta.messages.toolRunner({
  model, max_tokens, tools: [myTool, ...], messages,
});

for await (const message of runner) {
  // 处理每轮输出
}
```

## 运行

```sh
bun run s02
```

---

**上一课：** [s01 — Agent Loop](../s01-agent-loop/) — 手写 loop，理解底层原理
**下一课：** [s03 — Planning](../s03-planning/) — 给 agent 加上 todo list，引导它先计划再执行
