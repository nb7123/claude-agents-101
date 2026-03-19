// s08 — Background Tasks
// Motto: "Plan once, execute concurrently"
//
// s07 构建了任务计划系统，任务只存在于文件里
// s08 让任务真正执行：worker agent 认领任务、并发运行、依赖解锁后继续调度
//
// 核心概念：
//   1. 认领机制：claim = status:in_progress + assignee，防止重复执行
//   2. 并发调度：Promise.all 同时运行所有 ready 任务
//   3. 依赖驱动：一批完成 → 解锁新的 ready 任务 → 继续执行
//   4. worker agent：每个任务由独立的 Claude agent 完成并写入 result

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();
const TASK_FILE = "/tmp/s07-tasks.json"; // 复用 s07 的持久化层

// ─────────────────────────────────────────────
// 数据结构（与 s07 保持一致）
// ─────────────────────────────────────────────
type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "failed";
type TaskPriority = "high" | "medium" | "low";

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  deps: string[];
  assignee?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskStore {
  tasks: Task[];
}

// ─────────────────────────────────────────────
// 持久化层（与 s07 相同）
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
// 调度器：找出可执行任务
// ─────────────────────────────────────────────
function getReadyTasks(tasks: Task[]): Task[] {
  const doneIds = new Set(tasks.filter(t => t.status === "done").map(t => t.id));
  return tasks.filter(t =>
    t.status === "pending" &&
    t.deps.every(dep => doneIds.has(dep))
  );
}

function hasPendingTasks(tasks: Task[]): boolean {
  return tasks.some(t => t.status === "pending" || t.status === "in_progress");
}

// ─────────────────────────────────────────────
// 认领机制：原子性地 claim 一个任务
// 返回 true 表示认领成功，false 表示已被他人认领
// ─────────────────────────────────────────────
async function claimTask(taskId: string, workerName: string): Promise<boolean> {
  const store = await loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task || task.status !== "pending") return false; // 已被认领

  task.status = "in_progress";
  task.assignee = workerName;
  task.updatedAt = new Date().toISOString();
  await saveStore(store);
  return true;
}

async function completeTask(taskId: string, workerName: string, result: string): Promise<void> {
  const store = await loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.status = "done";
  task.assignee = workerName;
  task.result = result;
  task.updatedAt = new Date().toISOString();
  await saveStore(store);
}

async function failTask(taskId: string, reason: string): Promise<void> {
  const store = await loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.status = "failed";
  task.result = `ERROR: ${reason}`;
  task.updatedAt = new Date().toISOString();
  await saveStore(store);
}

// ─────────────────────────────────────────────
// Worker Agent：认领并执行单个任务
// ─────────────────────────────────────────────

// worker 可用的工具：读取依赖任务的结果
const getDepResultsTool = betaZodTool({
  name: "get_dep_results",
  description: "Get the results of completed dependency tasks to inform your work.",
  inputSchema: z.object({
    task_ids: z.array(z.string()).describe("Task IDs to retrieve results for"),
  }),
  run: async ({ task_ids }) => {
    const store = await loadStore();
    const results = task_ids.map(id => {
      const task = store.tasks.find(t => t.id === id);
      if (!task) return `Task "${id}" not found`;
      return `[${id}] ${task.title}: ${task.result ?? "(no result yet)"}`;
    });
    return results.join("\n");
  },
});

async function runWorker(task: Task): Promise<void> {
  const workerName = `worker-${task.id}`;

  // 认领任务
  const claimed = await claimTask(task.id, workerName);
  if (!claimed) {
    log.info(`  ${workerName}: task already claimed, skipping`);
    return;
  }

  log.agent(`  ${workerName} claimed "${task.title}"`);

  try {
    // 构建上下文：把依赖任务 ID 告诉 agent
    const depContext = task.deps.length > 0
      ? `\nThis task depends on: ${task.deps.join(", ")}. Use get_dep_results to read their outputs.`
      : "";

    const runner = client.beta.messages.toolRunner({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1024,
      system:
        "You are a specialized worker agent. Complete the assigned task concisely. " +
        "Return a brief but concrete result (2-4 sentences) describing what was accomplished.",
      tools: [getDepResultsTool],
      messages: [{
        role: "user",
        content:
          `Task: ${task.title}\n` +
          `Description: ${task.description}` +
          depContext +
          `\n\nComplete this task and report your result.`,
      }],
    });

    let result = "";
    for await (const message of runner) {
      for (const block of message.content) {
        if (block.type === "text") result = block.text;
      }
    }

    await completeTask(task.id, workerName, result);
    log.ok(`  ${workerName} done: "${task.title}"`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failTask(task.id, reason);
    log.error(`  ${workerName} failed: ${reason}`);
  }
}

// ─────────────────────────────────────────────
// 调度循环：依赖驱动的并发执行
//
//   while 还有未完成的任务:
//     找出所有 ready 任务
//     并发执行这批任务（Promise.all）
//     等待这批全部完成
//     → 新任务可能已解锁，继续循环
// ─────────────────────────────────────────────
async function runScheduler(): Promise<void> {
  log.info("Scheduler started\n");
  let round = 0;

  while (true) {
    const store = await loadStore();

    if (!hasPendingTasks(store.tasks)) {
      log.ok("All tasks completed!");
      break;
    }

    const ready = getReadyTasks(store.tasks);
    if (ready.length === 0) {
      // 有任务在 in_progress，等它们完成
      await Bun.sleep(500);
      continue;
    }

    round++;
    log.info(`\n── Round ${round}: dispatching ${ready.length} task(s) in parallel ──`);
    for (const t of ready) {
      log.info(`  • ${t.id}: ${t.title}${t.deps.length ? ` (deps: ${t.deps.join(", ")})` : ""}`);
    }

    // 并发执行这批 ready 任务
    await Promise.all(ready.map(task => runWorker(task)));
  }
}

// ─────────────────────────────────────────────
// 初始化：重置任务板并创建演示任务
// ─────────────────────────────────────────────
async function initTasks(): Promise<void> {
  const now = new Date().toISOString();
  const make = (
    id: string,
    title: string,
    description: string,
    deps: string[] = [],
    priority: TaskPriority = "medium"
  ): Task => ({ id, title, description, status: "pending", priority, deps, createdAt: now, updatedAt: now });

  const store: TaskStore = {
    tasks: [
      make("setup",   "环境搭建",   "搭建开发、测试、生产三套环境，包括 CI/CD 流水线配置"),
      make("design",  "设计评审",   "完成 UI/UX 设计方案评审，输出设计规范文档"),
      make("build",   "代码构建",   "编译源码、打包产物、生成 Docker 镜像", ["setup", "design"]),
      make("test",    "测试验证",   "执行单元测试、集成测试、E2E 测试，生成覆盖率报告", ["build"]),
      make("deploy",  "生产部署",   "蓝绿部署到生产环境，更新 CDN，发送上线通知", ["test"], "high"),
    ],
  };

  await saveStore(store);
  log.info("Task board initialized with 5 tasks:\n");
  for (const t of store.tasks) {
    const deps = t.deps.length ? ` → deps: [${t.deps.join(", ")}]` : "";
    log.info(`  ${t.id}: ${t.title}${deps}`);
  }
  log.info("");
}

// ─────────────────────────────────────────────
// 结果汇报
// ─────────────────────────────────────────────
async function printSummary(): Promise<void> {
  const store = await loadStore();
  log.info("\n═══════════════════════════════════════");
  log.info("Final Results");
  log.info("═══════════════════════════════════════");
  for (const task of store.tasks) {
    const icon = task.status === "done" ? "●" : task.status === "failed" ? "✗" : "○";
    log.info(`\n${icon} [${task.id}] ${task.title} @${task.assignee ?? "unassigned"}`);
    if (task.result) {
      // 缩进显示结果
      task.result.split("\n").forEach(line => process.stdout.write(`  ${line}\n`));
    }
  }
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
await initTasks();
await runScheduler();
await printSummary();
