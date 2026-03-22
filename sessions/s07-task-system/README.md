# s07 — Task System

> **Motto:** "Break big goals into small tasks, order them, persist to disk"

## 一句话

构建跨会话的持久化任务系统：带依赖图（DAG）的任务 CRUD，是 Phase 4 多 agent 协作的基础设施。

## 核心概念

**s03 vs s07：**

| | s03 Todo | s07 Task System |
|---|---|---|
| 生命周期 | 单次会话 | 跨进程持久化 |
| 依赖关系 | 无 | DAG（有向无环图） |
| 执行顺序 | 线性 | 拓扑排序 |
| 多 agent | 不支持 | 认领机制防重复 |

**关键洞察：** 任务的 `deps` 字段构成 DAG，"就绪任务" = 所有依赖都已 `done` 的任务。这是 s08 并发调度的核心依据。

## 数据结构

```typescript
interface Task {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked" | "failed";
  priority: "high" | "medium" | "low";
  deps: string[];       // 依赖的任务 ID
  assignee?: string;    // 认领的 agent 名称
  result?: string;      // 完成后的输出
}
```

## 核心功能

| 功能 | 工具 | 说明 |
|------|------|------|
| 创建任务 | `task_create` | 支持指定 deps |
| 查询任务 | `task_list` | 支持按 status 过滤 |
| 认领任务 | `task_claim` | 原子操作，防多 agent 重复认领 |
| 完成任务 | `task_complete` | 写入 result，解锁后续任务 |
| 就绪列表 | `get_ready_tasks` | 返回所有 deps 已完成的任务 |

## 持久化

任务存储在 `/tmp/s07-tasks.json`，供 s08 的并发 executor 直接使用。

## 运行

```sh
bun run s07
```

演示场景：AI 研究报告生成——调研、写作、审校、发布四个任务，带依赖关系。

---

**上一课：** [s06 — Context Compact](../s06-context-compact/) — context 压缩策略
**下一课：** [s08 — Background Tasks](../s08-background-tasks/) — 让任务真正并发执行
