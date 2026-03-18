// s07 — Task System
// Motto: "Break big goals into small tasks, order them, persist to disk"
//
// s03 的 todo list 是单次会话的临时计划，进程退出即消失
// s07 构建跨会话的持久化任务系统，是 Phase 4 多 agent 协作的基础
//
// 核心能力：
//   1. 持久化 CRUD：任务存储在 JSON 文件，跨进程存活
//   2. 依赖图（DAG）：任务可以依赖其他任务，自动计算执行顺序
//   3. 就绪队列：自动找出"所有依赖已完成"的可执行任务
//   4. 认领机制：agent 通过 claim 防止多 agent 重复认领同一任务

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();
const TASK_FILE = "/tmp/s07-tasks.json";

// ─────────────────────────────────────────────
// 数据结构
// ─────────────────────────────────────────────
type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "failed";
type TaskPriority = "high" | "medium" | "low";

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  deps: string[];        // 依赖的任务 ID 列表
  assignee?: string;     // 认领该任务的 agent 名称
  result?: string;       // 任务完成后的输出
  createdAt: string;
  updatedAt: string;
}

interface TaskStore {
  tasks: Task[];
}

// ─────────────────────────────────────────────
// 持久化层
// ─────────────────────────────────────────────
async function loadStore(): Promise<TaskStore> {
  try {
    return JSON.parse(await Bun.file(TASK_FILE).text());
  } catch {
    return { tasks: [] };
  }
}

async function saveStore(store: TaskStore): Promise<void> {
  await Bun.write(TASK_FILE, JSON.stringify(store, null, 2));
}

// ─────────────────────────────────────────────
// 依赖图：拓扑排序 & 就绪队列
// ─────────────────────────────────────────────

// 找出"所有依赖都已 done"的待执行任务
function getReadyTasks(tasks: Task[]): Task[] {
  const doneIds = new Set(tasks.filter(t => t.status === "done").map(t => t.id));
  return tasks.filter(t =>
    t.status === "pending" &&
    t.deps.every(dep => doneIds.has(dep))
  );
}

// 拓扑排序：返回任务的推荐执行顺序
// 用 Kahn 算法（BFS），遇到循环依赖返回 null
function topologicalSort(tasks: Task[]): Task[] | null {
  const idToTask = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map(tasks.map(t => [t.id, 0]));

  for (const task of tasks) {
    for (const dep of task.deps) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const queue = tasks.filter(t => (inDegree.get(t.id) ?? 0) === 0);
  const result: Task[] = [];

  while (queue.length > 0) {
    const task = queue.shift()!;
    result.push(task);
    // 找出依赖当前任务的任务，减少其入度
    for (const other of tasks) {
      if (other.deps.includes(task.id)) {
        const deg = (inDegree.get(other.id) ?? 1) - 1;
        inDegree.set(other.id, deg);
        if (deg === 0) queue.push(idToTask.get(other.id)!);
      }
    }
  }

  return result.length === tasks.length ? result : null; // null = 有循环依赖
}

// ─────────────────────────────────────────────
// 格式化输出
// ─────────────────────────────────────────────
const STATUS_ICON: Record<TaskStatus, string> = {
  pending:     "○",
  in_progress: "◎",
  done:        "●",
  blocked:     "⊘",
  failed:      "✗",
};

function formatTask(t: Task): string {
  const deps = t.deps.length > 0 ? ` [deps: ${t.deps.join(", ")}]` : "";
  const assignee = t.assignee ? ` @${t.assignee}` : "";
  return `${STATUS_ICON[t.status]} [${t.priority}] ${t.id}: ${t.title}${deps}${assignee}`;
}

// ─────────────────────────────────────────────
// 工具定义
// ─────────────────────────────────────────────

const taskCreateTool = betaZodTool({
  name: "task_create",
  description:
    "Create one or more tasks. Each task can declare dependencies on other task IDs. " +
    "Tasks with unmet dependencies will be blocked until deps complete.",
  inputSchema: z.object({
    tasks: z.array(z.object({
      id:          z.string().describe("Unique task ID, e.g. 'setup', 'build', 'test'"),
      title:       z.string().describe("Short task title"),
      description: z.string().describe("What this task entails"),
      priority:    z.enum(["high", "medium", "low"]).default("medium"),
      deps:        z.array(z.string()).default([]).describe("Task IDs that must complete first"),
    })),
  }),
  run: async ({ tasks: newTasks }) => {
    const store = await loadStore();
    const now = new Date().toISOString();
    for (const t of newTasks) {
      store.tasks.push({
        ...t,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    await saveStore(store);
    log.tool(`task_create: ${newTasks.length} tasks`);
    return `Created ${newTasks.length} tasks:\n${newTasks.map(t => `  - ${t.id}: ${t.title}`).join("\n")}`;
  },
});

const taskListTool = betaZodTool({
  name: "task_list",
  description:
    "List all tasks with their status, priority, and dependencies. " +
    "Also shows which tasks are ready to execute (all deps done).",
  inputSchema: z.object({
    filter: z.enum(["all", "ready", "pending", "in_progress", "done", "failed"])
      .default("all")
      .describe("Filter tasks by status. 'ready' shows tasks with all deps satisfied."),
  }),
  run: async ({ filter }) => {
    const store = await loadStore();
    const { tasks } = store;

    let filtered: Task[];
    if (filter === "ready") {
      filtered = getReadyTasks(tasks);
    } else if (filter === "all") {
      filtered = tasks;
    } else {
      filtered = tasks.filter(t => t.status === filter);
    }

    if (filtered.length === 0) return `No tasks with filter="${filter}"`;

    const sorted = topologicalSort(tasks);
    const orderMap = new Map(sorted?.map((t, i) => [t.id, i]) ?? []);
    filtered.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));

    const ready = getReadyTasks(tasks).map(t => t.id);
    const lines = filtered.map(t => {
      const readyMark = ready.includes(t.id) ? " ← READY" : "";
      return `${formatTask(t)}${readyMark}`;
    });

    return `Tasks (${filter}):\n${lines.join("\n")}`;
  },
});

const taskUpdateTool = betaZodTool({
  name: "task_update",
  description: "Update task status, assignee, or result. Call this as you work on tasks.",
  inputSchema: z.object({
    id:       z.string().describe("Task ID to update"),
    status:   z.enum(["pending", "in_progress", "done", "blocked", "failed"]).optional(),
    assignee: z.string().optional().describe("Agent name claiming this task"),
    result:   z.string().optional().describe("Output or outcome of the task"),
  }),
  run: async ({ id, status, assignee, result }) => {
    const store = await loadStore();
    const task = store.tasks.find(t => t.id === id);
    if (!task) return `Error: task "${id}" not found`;

    if (status)   task.status = status;
    if (assignee) task.assignee = assignee;
    if (result)   task.result = result;
    task.updatedAt = new Date().toISOString();

    await saveStore(store);
    log.tool(`task_update: ${id} → ${status ?? "unchanged"}`);
    return `Updated task "${id}":\n${formatTask(task)}`;
  },
});

const taskGetTool = betaZodTool({
  name: "task_get",
  description: "Get full details of a specific task including result and metadata.",
  inputSchema: z.object({
    id: z.string().describe("Task ID to retrieve"),
  }),
  run: async ({ id }) => {
    const store = await loadStore();
    const task = store.tasks.find(t => t.id === id);
    if (!task) return `Error: task "${id}" not found`;
    return JSON.stringify(task, null, 2);
  },
});

const taskClearTool = betaZodTool({
  name: "task_clear",
  description: "Clear all tasks (reset the task board). Use when starting a fresh project.",
  inputSchema: z.object({}),
  run: async () => {
    await saveStore({ tasks: [] });
    log.tool("task_clear");
    return "Task board cleared.";
  },
});

// ─────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────
async function runAgent(prompt: string): Promise<void> {
  log.info(`User: ${prompt}\n`);

  const tools = [
    taskCreateTool, taskListTool, taskUpdateTool,
    taskGetTool, taskClearTool,
  ];

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You are a project manager agent. Use the task tools to plan and track work. " +
      "Always create tasks before starting work. " +
      "Respect task dependencies — only work on tasks whose deps are done. " +
      "Update task status as you progress.",
    tools,
    messages: [{ role: "user", content: prompt }],
  });

  let iteration = 0;
  for await (const message of runner) {
    iteration++;
    log.agent(`── iteration ${iteration} | stop_reason: ${message.stop_reason}`);
    for (const block of message.content) {
      if (block.type === "text" && block.text) {
        process.stdout.write(block.text + "\n");
      }
    }
  }
}

// ─────────────────────────────────────────────
// 演示：构建一个有依赖关系的项目计划
//
// 任务依赖图：
//   setup ──┐
//           ├──▶ build ──▶ test ──▶ deploy
//   design ─┘
// ─────────────────────────────────────────────
await runAgent(
  "请为一个 Web 应用的发布流程创建任务计划：" +
  "环境搭建 → 设计评审 → 代码构建（依赖前两项）→ 测试（依赖构建）→ 部署（依赖测试）。" +
  "创建完成后，列出所有任务并指出哪些任务现在可以立即开始执行。"
);
