// s03 — Planning
// Motto: "An agent without a plan drifts"
//
// 问题：s01/s02 的 agent 拿到任务就执行，没有全局规划
//       任务一复杂，agent 容易跳步骤、重复操作、迷失方向
//
// 解法：在工具集里加入 todo_write / todo_update
//       agent 被引导先制定计划，再按计划执行
//
// 关键洞察：todo list 不是给用户看的，是给 LLM 自己看的
//           它出现在 messages 历史里，让 LLM 每轮都知道"还剩什么"
//
// 数据结构：
//   TodoItem { id, title, status: "pending"|"in_progress"|"done", priority }
//   持久化到 /tmp/todos.json，agent 重启后可继续

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();
const TODO_FILE = "/tmp/s03-todos.json";

// ─────────────────────────────────────────────
// Todo 数据结构
// ─────────────────────────────────────────────
type Status = "pending" | "in_progress" | "done";
type Priority = "high" | "medium" | "low";

interface TodoItem {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
}

// ─────────────────────────────────────────────
// 持久化：读写 JSON 文件
// ─────────────────────────────────────────────
async function loadTodos(): Promise<TodoItem[]> {
  try {
    return JSON.parse(await Bun.file(TODO_FILE).text());
  } catch {
    return [];
  }
}

async function saveTodos(todos: TodoItem[]): Promise<void> {
  await Bun.write(TODO_FILE, JSON.stringify(todos, null, 2));
}

function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "(no todos)";
  const icon: Record<Status, string> = {
    pending: "○",
    in_progress: "◎",
    done: "●",
  };
  return todos
    .map((t) => `${icon[t.status]} [${t.priority}] ${t.id}: ${t.title} (${t.status})`)
    .join("\n");
}

// ─────────────────────────────────────────────
// 工具定义
// ─────────────────────────────────────────────

// todo_write：一次性写入整个计划（替换现有列表）
// agent 在任务开始时调用，把大任务拆解成有序步骤
const todoWriteTool = betaZodTool({
  name: "todo_write",
  description:
    "Write the full todo list for the current task. " +
    "Call this FIRST before doing any work to create a clear plan. " +
    "Each todo item should be a concrete, actionable step.",
  inputSchema: z.object({
    todos: z.array(
      z.object({
        id: z.string().describe("Unique identifier, e.g. '1', '2a', 'setup'"),
        title: z.string().describe("Clear description of what needs to be done"),
        priority: z.enum(["high", "medium", "low"]),
        status: z.enum(["pending", "in_progress", "done"]).default("pending"),
      })
    ).describe("The complete ordered list of steps to complete the task"),
  }),
  run: async ({ todos }) => {
    await saveTodos(todos as TodoItem[]);
    log.tool(`todo_write: ${todos.length} items`);
    return `Plan created:\n${formatTodos(todos as TodoItem[])}`;
  },
});

// todo_update：更新单个条目的状态
// agent 在开始某步骤时标记 in_progress，完成后标记 done
const todoUpdateTool = betaZodTool({
  name: "todo_update",
  description:
    "Update the status of a todo item. " +
    "Mark 'in_progress' when starting a step, 'done' when completed. " +
    "Always update status to reflect current progress.",
  inputSchema: z.object({
    id: z.string().describe("The todo item id to update"),
    status: z.enum(["pending", "in_progress", "done"]),
  }),
  run: async ({ id, status }) => {
    const todos = await loadTodos();
    const item = todos.find((t) => t.id === id);
    if (!item) return `Error: todo "${id}" not found`;
    item.status = status;
    await saveTodos(todos);
    log.tool(`todo_update: ${id} → ${status}`);
    return `Updated "${id}" to ${status}\n\nCurrent plan:\n${formatTodos(todos)}`;
  },
});

// todo_read：读取当前计划（让 agent 随时查看进度）
const todoReadTool = betaZodTool({
  name: "todo_read",
  description: "Read the current todo list to check what has been done and what remains.",
  inputSchema: z.object({}),
  run: async () => {
    const todos = await loadTodos();
    return formatTodos(todos);
  },
});

// bash：执行实际任务（和 s02 一样）
const bashTool = betaZodTool({
  name: "bash",
  description: "Execute a bash command and return its output.",
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
  }),
  run: async ({ command }) => {
    log.tool(`$ ${command}`);
    try {
      return await Bun.$`bash -c ${command}`.text() || "(no output)";
    } catch (err: any) {
      return `Error (exit ${err.exitCode}): ${err.stderr?.toString() ?? err.message}`;
    }
  },
});

// ─────────────────────────────────────────────
// Agent：带计划的 loop
//
// system prompt 非常关键：
//   明确告诉 LLM"先写计划，再执行，边执行边更新状态"
//   没有这个指令，LLM 可能会跳过 todo_write 直接干活
// ─────────────────────────────────────────────
async function runAgent(userPrompt: string): Promise<void> {
  log.info(`User: ${userPrompt}\n`);

  const tools = [todoWriteTool, todoUpdateTool, todoReadTool, bashTool];

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You are a methodical assistant. " +
      "Before doing ANY work, call todo_write to break the task into steps. " +
      "As you work, call todo_update to mark steps in_progress then done. " +
      "This helps you stay organized and not miss anything.",
    tools,
    messages: [{ role: "user", content: userPrompt }],
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

  // 任务完成后打印最终 todo 状态
  const finalTodos = await loadTodos();
  log.ok(`\nFinal plan status:\n${formatTodos(finalTodos)}`);
}

// ─────────────────────────────────────────────
// 演示：一个需要多步骤的任务
// 观察 agent 如何先规划、再执行、保持跟踪
// ─────────────────────────────────────────────
await runAgent(
  "分析这个项目：" +
  "1) 统计每个 session 目录下有多少 .ts 文件和 .json 文件 " +
  "2) 找出代码行数最多的 .ts 文件 " +
  "3) 把统计结果写入 /tmp/s03-report.txt"
);
