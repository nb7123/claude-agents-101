# s11 — Autonomous Agents

> **Motto:** "Give it a goal, not a script"

## 一句话

用 Claude Agent SDK 的 `query()` 实现真正的自主 agent：给定高层目标，agent 自主探索、规划、执行、反思。

## 核心概念

**s10 vs s11：**

| | s10 Team Protocols | s11 Autonomous |
|---|---|---|
| 流程 | 预定义的评审协议 | Agent 自主决定下一步 |
| 工具 | 消息收发 | Read / Glob / Grep / Bash（内置） |
| 计划 | 代码硬编码 | Agent 自己制定 |

**关键能力：**
1. **目标导向**：接受模糊的高层目标，自主分解为具体行动
2. **自主探索**：agent 决定看哪些文件、搜索什么内容
3. **自我反思**：完成一步后评估进度，决定下一步
4. **预算控制**：`maxTurns` 防止无限循环，`permissionMode` 控制写权限

## Agent SDK `query()` 消息流

```
AsyncIterable<message>
  system    → 会话初始化（含 session_id）
  assistant → { message: { content: [TextBlock | ToolUseBlock, ...] } }
  result    → { result: string, stop_reason, usage }
```

> ⚠️ 注意：assistant 消息的内容在 `message.message.content`，不是 `message.content`。

## 内置工具

无需手动定义，直接在 `allowedTools` 中声明即可使用：

| 工具 | 用途 |
|------|------|
| `Read` | 读取文件 |
| `Glob` | 按模式匹配文件路径 |
| `Grep` | 搜索文件内容 |
| `Bash` | 执行 shell 命令 |
| `Write` | 写入文件（需 `allowWrite: true`） |
| `Edit` | 编辑文件（需 `allowWrite: true`） |

## 配置模板

```typescript
const stream = query({
  prompt: goal,
  options: {
    cwd: "/path/to/project",
    maxTurns: 20,
    allowedTools: ["Read", "Glob", "Grep"],
    permissionMode: "default",           // "acceptEdits" 可自动接受写操作
    model: "claude-sonnet-4-6",
    systemPrompt: "You are an autonomous agent...",
  },
});
```

## 运行

```sh
bun run s11
```

演示场景：
1. **Code Auditor**（只读，20 轮）：自主审计整个项目，输出架构亮点/问题/改进建议
2. **Curriculum Analyzer**（只读，15 轮）：分析 12 个 session 的学习曲线与递进关系

---

**上一课：** [s10 — Team Protocols](../s10-team-protocols/) — 结构化多 agent 协议
**下一课：** [s12 — Worktree Isolation](../s12-worktree-isolation/) — 为每个 agent 提供独立的 git 沙盒
