// s11 — Autonomous Agents
// Motto: "Give it a goal, not a script"
//
// s08 的任务是预先定义好的，s10 的流程是结构化的
// s11 让 agent 自主决定做什么：给定高层目标，agent 探索、规划、执行、反思
//
// 核心概念：
//   1. 目标导向：接受模糊的高层目标，自主分解为具体行动
//   2. 自主探索：agent 决定看哪些文件、搜索什么内容
//   3. 自我反思：完成一步后评估进度，决定下一步
//   4. 预算控制：max_turns 防止无限循环，permissionMode 控制写权限
//
// 实现方式：Claude Agent SDK query()
//   - 内置 Read / Glob / Grep / Bash 工具，无需手动定义
//   - 自动处理 agentic loop
//   - 通过消息流观察 agent 的每一步行动

import { query } from "@anthropic-ai/claude-agent-sdk";
import { log } from "@learn/shared";

// ─────────────────────────────────────────────
// 消息类型（Agent SDK 返回的消息流）
// ─────────────────────────────────────────────
// query() 返回 AsyncIterable，每条消息是以下类型之一：
//   system   → 会话初始化信息（含 session_id）
//   assistant → agent 的文字输出和工具调用
//   user      → 工具结果（SDK 内部处理，偶尔暴露）
//   result    → 最终结果（stop_reason + 用量统计）

// ─────────────────────────────────────────────
// 运行自主 agent
// ─────────────────────────────────────────────
async function runAutonomousAgent(goal: string, opts: {
  label: string;
  maxTurns: number;
  allowWrite?: boolean;
  cwd?: string;
}): Promise<void> {
  const { label, maxTurns, allowWrite = false, cwd = process.cwd() } = opts;

  log.info(`\n${"═".repeat(56)}`);
  log.info(`[${label}] Goal: "${goal}"`);
  log.info(`Max turns: ${maxTurns} | Write: ${allowWrite ? "enabled" : "read-only"}`);
  log.info(`${"═".repeat(56)}\n`);

  let turnCount = 0;
  let toolCallCount = 0;
  let sessionId = "";

  const stream = query({
    prompt: goal,
    options: {
      cwd,
      maxTurns,
      // 只读模式：只给读取类工具
      // 写入模式：加入 Write / Edit / Bash
      allowedTools: allowWrite
        ? ["Read", "Glob", "Grep", "Bash", "Write", "Edit"]
        : ["Read", "Glob", "Grep"],
      permissionMode: allowWrite ? "acceptEdits" : "default",
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      systemPrompt:
        "You are an autonomous agent. You have a goal and must accomplish it by " +
        "exploring the codebase, gathering information, and producing clear findings. " +
        "Think step by step. After each action, reflect on what you've learned and " +
        "what you still need to do. Be thorough but efficient.",
    },
  });

  for await (const message of stream) {
    // system 消息：会话初始化
    if (message.type === "system" && "session_id" in message) {
      sessionId = message.session_id as string;
      log.agent(`Session: ${sessionId.slice(0, 8)}...`);
      continue;
    }

    // assistant 消息：agent 的输出
    // Agent SDK 结构：message.message.content（而非 message.content）
    if (message.type === "assistant") {
      turnCount++;
      const msg = message as { type: string; message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } };
      const content = msg.message?.content ?? [];
      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) {
          // 只打印较短的中间思考（避免刷屏）
          const text = block.text.trim();
          const preview = text.length > 300 ? text.slice(0, 300) + "…" : text;
          process.stdout.write(`  │ ${preview}\n`);
        }
        if (block.type === "tool_use") {
          toolCallCount++;
          log.tool(`  [${block.name}] ${JSON.stringify(block.input).slice(0, 80)}`);
        }
      }
      continue;
    }

    // result 消息：最终结果
    if ("result" in message) {
      const result = message as { result: string; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } };
      log.info(`\n${"─".repeat(56)}`);
      log.info(`Stop reason: ${result.stop_reason}`);
      if (result.usage) {
        log.info(`Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
      }
      log.info(`Turns: ${turnCount} | Tool calls: ${toolCallCount}`);
      log.info(`${"─".repeat(56)}\n`);
      log.ok("Final Result:");
      process.stdout.write(result.result + "\n");
    }
  }
}

// ─────────────────────────────────────────────
// 演示 1：自主代码审计（只读）
//
// Agent 自主决定：
//   - 先看哪些文件
//   - 搜索什么模式
//   - 如何组织发现
// ─────────────────────────────────────────────
await runAutonomousAgent(
  "审计 startup-ai 项目的代码质量。请自主探索项目结构，" +
  "检查各个 session 的实现模式，找出跨 session 的共性问题或改进点，" +
  "最终输出一份简洁的审计报告（包括：架构亮点、潜在问题、改进建议）。",
  {
    label: "Code Auditor",
    maxTurns: 20,
    allowWrite: false,
    cwd: "/Users/xiaodongliu/Projects/startup-ai",
  }
);

// ─────────────────────────────────────────────
// 演示 2：自主目标拆解（展示自我规划能力）
//
// 给 agent 一个更抽象的技术问题，观察它如何自主规划
// ─────────────────────────────────────────────
log.info("\n" + "═".repeat(56));
log.info("Demo 2: Autonomous Problem Solver");
log.info("═".repeat(56));

await runAutonomousAgent(
  "分析 startup-ai 的 12 个 session，找出每个 phase 的核心学习曲线。" +
  "具体来说：每个 phase 引入了哪些新概念？各 session 之间如何递进？" +
  "给出一个适合初学者的学习路径建议。",
  {
    label: "Curriculum Analyzer",
    maxTurns: 15,
    allowWrite: false,
    cwd: "/Users/xiaodongliu/Projects/startup-ai",
  }
);
