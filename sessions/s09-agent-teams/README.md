# s09 — Agent Teams

> **Motto:** "Specialized roles, shared blackboard"

## 一句话

构建有角色分工的 agent 团队：每个 agent 有专属 system prompt，通过共享黑板（Blackboard）传递协作上下文。

## 核心概念

**Blackboard Pattern（黑板模式）：**
- 黑板：所有 agent 可读写的共享工作区
- 角色：不同的 system prompt 定义专业分工
- 编排：orchestrator 按顺序调用专家 agent

**s04 vs s09：**

| | s04 Subagents | s09 Agent Teams |
|---|---|---|
| 协作方式 | 主 agent 直接分发任务 | 共享黑板传递上下文 |
| 角色 | 无固定角色 | 专属 system prompt |
| 上下文传递 | 主 agent 汇总 | 每个 agent 主动读板 |

## 团队结构

```
researcher → outliner → writer → editor
   ↕            ↕          ↕         ↕
            共享黑板（Blackboard）
```

每个 agent 读取前一个 agent 在黑板上的输出，再写入自己的贡献。

## 黑板接口

```typescript
class Blackboard {
  post(author: string, tag: string, content: string): void
  read(tags?: string[]): BoardEntry[]
  format(tags?: string[]): string
}
```

## 工具

每个 agent 获得两个黑板工具：

| 工具 | 说明 |
|------|------|
| `post_to_board` | 发布输出（带 tag 标签） |
| `read_board` | 读取指定 tag 的条目 |

## 示例流程（技术文章写作）

```
researcher  → post: tag="research"  (5-7 个关键洞察)
outliner    → read: "research"
            → post: tag="outline"   (文章结构)
writer      → read: "research", "outline"
            → post: tag="draft"     (400-600 字草稿)
editor      → read: "draft"
            → post: tag="final"     (润色后终稿)
```

## 运行

```sh
bun run s09
```

---

**上一课：** [s08 — Background Tasks](../s08-background-tasks/) — 并发任务执行
**下一课：** [s10 — Team Protocols](../s10-team-protocols/) — 结构化消息通信与共识机制
