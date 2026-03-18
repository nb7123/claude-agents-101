// s02 — Tool System
// Motto: "Adding a tool means adding one handler"
//
// s01 回顾：我们手写了 loop + if/else 工具分发
// s02 目标：用 betaZodTool + tool runner 重构，
//           让每个工具成为独立单元，loop 不再需要修改
//
// 核心对比：
//   s01: 工具 = JSON Schema + if/else dispatch + 手写 while loop
//   s02: 工具 = betaZodTool(name, desc, ZodSchema, fn) → 注册完事
//
// 关键洞察：tool runner 把 s01 的 while loop 内化了
//   你只需要定义"工具做什么"，不需要关心"工具何时被调用"

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();

// ─────────────────────────────────────────────
// 工具定义
//
// betaZodTool(name, description, inputSchema, run)
//
// 对比 s01：
//   s01 需要手写 JSON Schema + executeTool 里的 if 分支
//   s02 只需要一个 betaZodTool 调用，schema 由 Zod 自动生成
//
// 新增工具只需要复制这个模式，不改任何其他代码
// ─────────────────────────────────────────────

const bashTool = betaZodTool({
  name: "bash",
  description:
    "Execute a bash command and return its output. " +
    "Use for file operations, running scripts, checking system info.",
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
  }),
  run: async ({ command }) => {
    log.tool(`$ ${command}`);
    try {
      const output = await Bun.$`bash -c ${command}`.text();
      return output || "(no output)";
    } catch (err: any) {
      return `Error (exit ${err.exitCode}): ${err.stderr?.toString() ?? err.message}`;
    }
  },
});

const readFileTool = betaZodTool({
  name: "read_file",
  description: "Read the content of a file at the given path.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
  }),
  run: async ({ path }) => {
    log.tool(`read_file: ${path}`);
    try {
      return await Bun.file(path).text();
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
});

const writeFileTool = betaZodTool({
  name: "write_file",
  description: "Write content to a file, creating it if it doesn't exist.",
  inputSchema: z.object({
    path: z.string().describe("Path to write to"),
    content: z.string().describe("Content to write"),
  }),
  run: async ({ path, content }) => {
    log.tool(`write_file: ${path} (${content.length} chars)`);
    try {
      await Bun.write(path, content);
      return `Written ${content.length} characters to ${path}`;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
});

// ─────────────────────────────────────────────
// Tool Runner
//
// 对比 s01 的手写 while loop：
//
//   s01:                          s02:
//   while (true) {                const result =
//     const res = await ...          await client.beta.messages
//     if end_turn → break              .toolRunner({ tools, ... })
//     if tool_use →                    .finalMessage();
//       execute tools
//       messages.push(...)
//   }
//
// tool runner 把那个 while loop 完全内化，
// 你拿到的直接是最终的 Message（stop_reason = "end_turn"）
// ─────────────────────────────────────────────
async function runAgent(userPrompt: string): Promise<void> {
  log.info(`User: ${userPrompt}\n`);

  const tools = [bashTool, readFileTool, writeFileTool];

  // toolRunner 返回一个异步迭代器
  // 每次迭代对应 loop 的一轮（包含工具调用和工具结果）
  // 用 for await 可以观察每一轮的中间 message
  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4096,
    tools,
    messages: [{ role: "user", content: userPrompt }],
  });

  // 观察每一轮迭代（等价于 s01 的 iteration log）
  let iteration = 0;
  for await (const message of runner) {
    iteration++;
    log.agent(`── iteration ${iteration} | stop_reason: ${message.stop_reason}`);

    // 打印 LLM 在这一轮说了什么
    for (const block of message.content) {
      if (block.type === "text" && block.text) {
        process.stdout.write(block.text + "\n");
      }
    }
  }

  log.ok("Agent finished.");
}

// ─────────────────────────────────────────────
// 演示：让 agent 同时使用多个工具完成任务
// ─────────────────────────────────────────────
await runAgent(
  "用中文：" +
  "1. 用 bash 列出 sessions/ 目录下的所有子目录 " +
  "2. 用 read_file 读取 sessions/s01-agent-loop/index.ts 的前30行内容（用 bash head 命令）" +
  "3. 用 write_file 把你的总结写入 /tmp/s02-summary.txt"
);
