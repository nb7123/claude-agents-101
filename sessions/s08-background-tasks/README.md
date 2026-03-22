# s08 — Background Tasks

> **Motto:** "Plan once, execute concurrently"

## 一句话

在 s07 的任务系统之上，实现依赖驱动的并发调度器：多个 worker agent 同时认领任务，依赖解锁后自动继续。

## 核心概念

**s07 vs s08：**

| | s07 | s08 |
|---|---|---|
| 角色 | LLM 创建任务计划 | Worker agents 执行任务 |
| 执行 | 无 | 并发调度 |
| 依赖处理 | 展示就绪列表 | 自动解锁、继续调度 |

**工作原理：**

```
初始化：读取 s07 任务文件
  ↓
找出所有就绪任务（deps 全部 done）
  ↓
Promise.all(ready.map(runWorker))  ← 并发认领并执行
  ↓
一批完成 → 重新查找就绪任务
  ↓
重复直到没有 pending 任务
```

## 关键机制

### 认领（Claim）

防止多个 worker 重复执行同一任务：

```typescript
async function claimTask(taskId: string, workerName: string): Promise<boolean> {
  const store = loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (task?.status !== "pending") return false;  // 已被认领
  task.status = "in_progress";
  task.assignee = workerName;
  saveStore(store);
  return true;
}
```

### Worker Agent

每个 worker 是一个独立的 Claude agent，通过 `get_dep_results` 工具读取依赖输出：

```typescript
const getDepResults = betaZodTool({
  name: "get_dep_results",
  run: async () => /* 读取所有依赖任务的 result */,
});
```

### 调度循环

```typescript
while (true) {
  const ready = getReadyTasks();
  if (ready.length === 0) break;
  await Promise.all(ready.map(task => runWorker(task)));
}
```

## 运行

```sh
bun run s08
```

> 需要先运行 `bun run s07` 生成任务文件。

---

**上一课：** [s07 — Task System](../s07-task-system/) — 任务持久化与 DAG
**下一课：** [s09 — Agent Teams](../s09-agent-teams/) — 有角色分工的 agent 团队
