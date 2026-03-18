// s04 — Subagents
// Motto: "Break big tasks down; each subtask gets a clean context"
//
// 前三课都是单 agent：一个 messages 数组承载所有历史
// 问题：任务越复杂，context 越长，不同子任务的信息互相污染
//
// s04 引入子代理模式：
//   主 agent  负责分解任务、协调、汇总结果
//   子代理    每个拿到一个独立子任务，context 完全隔离
//
// 首次使用 @anthropic-ai/claude-agent-sdk 的 query()
// query() 运行在 Claude Code CLI 之上，内置文件/命令访问能力
//
// 两种子代理调用方式（本课都会演示）：
//   方式一：直接在代码里 spawn —— 主 agent 是 orchestrator
//   方式二：通过 Agent 工具 —— LLM 自己决定何时 spawn 子代理

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();

// ─────────────────────────────────────────────
// 方式一：Programmatic Subagent
// 主程序直接调用 query()，完全控制子代理的生命周期
//
// query() 返回 AsyncIterable，消费它得到最终结果
// ─────────────────────────────────────────────
async function runSubagent(
  task: string,
  label: string
): Promise<string> {
  log.agent(`spawning subagent [${label}]: ${task.slice(0, 60)}...`);

  let result = "";

  for await (const message of query({
    prompt: task,
    options: {
      // 子代理只需要读文件和执行命令的能力
      // 明确限制工具集是最佳实践：最小权限原则
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      permissionMode: "acceptEdits",
    },
  })) {
    // ResultMessage 是 query() 迭代结束时的最终消息
    if ("result" in message) {
      result = message.result;
      log.ok(`subagent [${label}] done`);
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// 方式一演示：Orchestrator 模式
// 主程序把大任务拆成子任务，并发或串行 spawn 子代理
// ─────────────────────────────────────────────
async function orchestratorDemo(): Promise<void> {
  log.info("=== 方式一：Orchestrator 模式 ===\n");

  // 把分析任务拆成三个独立子任务，并发执行
  // 每个子代理 context 完全隔离，互不干扰
  const [resultA, resultB, resultC] = await Promise.all([
    runSubagent(
      "分析 sessions/s01-agent-loop/index.ts：" +
      "用一段话说明这个文件的核心功能和设计思路",
      "analyst-s01"
    ),
    runSubagent(
      "分析 sessions/s02-tool-system/index.ts：" +
      "用一段话说明这个文件相比 s01 引入了什么新机制",
      "analyst-s02"
    ),
    runSubagent(
      "分析 sessions/s03-planning/index.ts：" +
      "用一段话说明这个文件的计划机制是如何工作的",
      "analyst-s03"
    ),
  ]);

  log.info("\n汇总结果：");
  console.log("\n--- s01 分析 ---\n" + resultA);
  console.log("\n--- s02 分析 ---\n" + resultB);
  console.log("\n--- s03 分析 ---\n" + resultC);
}

// ─────────────────────────────────────────────
// 方式二：通过 Agent 工具让 LLM 自己 spawn 子代理
// 主 agent 拿到一个 "delegate" 工具
// 它自己决定何时委托、委托什么任务
// ─────────────────────────────────────────────
const delegateTool = betaZodTool({
  name: "delegate",
  description:
    "Spawn a subagent to handle a specific subtask. " +
    "Use this to break complex work into isolated pieces. " +
    "Each subagent gets a clean context with no memory of previous tasks.",
  inputSchema: z.object({
    task: z.string().describe("Clear, self-contained task for the subagent"),
    label: z.string().describe("Short identifier for logging, e.g. 'file-analyzer'"),
  }),
  run: async ({ task, label }) => {
    return await runSubagent(task, label);
  },
});

const bashTool = betaZodTool({
  name: "bash",
  description: "Execute a bash command.",
  inputSchema: z.object({
    command: z.string(),
  }),
  run: async ({ command }) => {
    log.tool(`$ ${command}`);
    try {
      return await Bun.$`bash -c ${command}`.text() || "(no output)";
    } catch (err: any) {
      return `Error: ${err.stderr?.toString() ?? err.message}`;
    }
  },
});

async function agentToolDemo(): Promise<void> {
  log.info("\n=== 方式二：Agent 工具模式 ===\n");

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You are an orchestrator. For any analysis task, use the 'delegate' tool " +
      "to spawn specialized subagents rather than doing the work yourself. " +
      "Collect their results and synthesize a final summary.",
    tools: [delegateTool, bashTool],
    messages: [{
      role: "user",
      content:
        "分别分析 sessions/s01-agent-loop 和 sessions/s02-tool-system 这两个目录的代码，" +
        "然后写一段对比总结说明两者的核心区别。用中文回答。",
    }],
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
// 运行两种模式，感受区别：
//
// 方式一：你（代码）决定拆分策略，子任务并发，适合结构已知的流水线
// 方式二：LLM 决定何时委托，更灵活，适合任务结构不确定的场景
// ─────────────────────────────────────────────
await orchestratorDemo();
await agentToolDemo();
