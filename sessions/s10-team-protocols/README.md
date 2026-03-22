# s10 — Team Protocols

> **Motto:** "Agree before you ship"

## 一句话

在 agent 团队间引入结构化消息协议与共识机制：提案 → 独立评审 → 投票 → 通过或打回修改。

## 核心概念

**s09 vs s10：**

| | s09 Blackboard | s10 Protocols |
|---|---|---|
| 通信方式 | 读写共享黑板 | 结构化消息总线 |
| 流程 | 固定顺序流水线 | 动态 + 可重试 |
| 质量控制 | 无 | 评分阈值 + 否决重写 |

**共识机制：** 两个独立评审 agent 各自打分（1-10），平均分 ≥ 7.0 才通过；否则打回 proposer 修改，最多 3 轮。

## 消息协议

```typescript
type MessageType = "proposal" | "review" | "revision" | "approved" | "rejected";

interface TeamMessage {
  id: string;
  from: string;
  to: string;       // "all" 或具体 agent 名
  type: MessageType;
  payload: string;  // JSON 字符串
}
```

## 评审流程

```
Round N:
  proposer  → send("all", "proposal"|"revision", content)
  reviewer-a → read → send("orchestrator", "review", { score, strengths, weaknesses, suggestion })
  reviewer-b → read → send("orchestrator", "review", { score, ... })
  orchestrator → 计算平均分
    ≥ 7.0 → send("all", "approved") → 结束
    < 7.0 → 继续下一轮（proposer 读取评审意见修改）
    轮数耗尽 → send("all", "rejected")
```

## 消息总线

```typescript
class MessageBus {
  send(from, to, type, payload): TeamMessage
  getFor(agent, type?): TeamMessage[]   // 筛选发给某 agent 的消息
  getLast(type): TeamMessage | undefined
}
```

## 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `PASS_THRESHOLD` | 7.0 | 平均分达到此值才通过 |
| `MAX_ROUNDS` | 3 | 最多修改轮数 |

## 运行

```sh
bun run s10
```

演示场景：设计支持百万并发的实时消息推送系统技术方案。

---

**上一课：** [s09 — Agent Teams](../s09-agent-teams/) — 黑板模式团队协作
**下一课：** [s11 — Autonomous Agents](../s11-autonomous-agents/) — 给 agent 一个目标，让它自主探索
