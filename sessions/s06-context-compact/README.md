# s06 — Context Compact

> **Motto:** "Context will fill up; you need a way to make room"

## 一句话

long-running agent 的 messages 数组会无限增长，本课对比三种压缩策略：截断、摘要、SDK Compaction。

## 核心概念

**问题：** 每轮迭代追加 assistant + tool_result，几十轮后撞上 200K token 限制，agent 无法继续工作。

**关键洞察：** compaction block 是有状态的——必须把整个 `response.content` 追加回 messages（不能只保留文字），API 依赖它恢复被压缩的历史。

## 三种策略对比

| 策略 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **截断** | 只保留最近 N 条 | 简单，零成本 | 早期信息完全丢失 |
| **摘要** | LLM 将历史压缩成摘要 | 保留语义，灵活 | 额外 API 调用，摘要质量不稳定 |
| **SDK Compaction** | API beta，服务端自动压缩 | 无损，透明，自动 | 需要 beta header，Opus 4.6 专属 |

## 策略 1：截断

```typescript
function truncateMessages(messages, keepLast = 20) {
  if (messages.length <= keepLast) return messages;
  return messages.slice(-keepLast);
}
```

## 策略 2：摘要

```typescript
// 用 LLM 压缩历史
const summary = await summarizeHistory(oldMessages);
// 重建：只保留摘要 + 最近几条
messages = [
  { role: "user", content: `Previous context summary:\n${summary}` },
  { role: "assistant", content: "Understood." },
  ...recentMessages,
];
```

## 策略 3：SDK Compaction（推荐）

```typescript
// 关键：必须追加整个 response.content，不能只取文字
messages.push({ role: "assistant", content: response.content });
// compaction block 混在 content 里，API 下次请求时用它恢复历史
```

```typescript
// satisfies 模式：编译期验证类型字面量
const COMPACTION_TYPE = "compaction" satisfies BetaCompactionBlock["type"];
const hasCompaction = response.content.some(
  (b): b is BetaCompactionBlock => b.type === COMPACTION_TYPE
);
```

## 运行

```sh
bun run s06
```

---

**上一课：** [s05 — Skills](../s05-skills/) — 按需加载知识
**下一课：** [s07 — Task System](../s07-task-system/) — 持久化任务系统，Phase 3 起点
