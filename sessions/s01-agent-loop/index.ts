// s01 — Agent Loop
// Motto: "One loop & Bash is all you need"
//
// 目标：手写最小可运行的 agentic loop，不依赖任何框架
// 只用 @anthropic-ai/sdk 原始 API + 一个 bash 工具
//
// 核心结构：
//   user input → LLM → stop_reason?
//     "end_turn"  → 任务完成，结束循环
//     "tool_use"  → 执行工具 → 追加结果到 messages → 继续循环
//
// 关键洞察：messages 数组是 loop 的全部状态
//   它随着每次迭代增长，LLM 通过它"记住"之前做了什么

import Anthropic from "@anthropic-ai/sdk";
import { log } from "@learn/shared";

const client = new Anthropic();
// ANTHROPIC_API_KEY 由 Bun 从 .env 自动加载，无需任何配置

// ─────────────────────────────────────────────
// 1. 工具定义
//    input_schema 是告诉 Claude 如何调用这个工具的 JSON Schema
//    description 非常重要：Claude 依赖它决定何时用、怎么用这个工具
// ─────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: "bash",
    description:
      "Execute a bash command and return its stdout. " +
      "Use for file operations, running scripts, checking system info, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
      },
      required: ["command"],
    },
  },
];

// ─────────────────────────────────────────────
// 2. 工具执行函数
//    接收工具名和参数，返回结果字符串
//    使用 Bun.$`...` 执行 shell 命令（Bun 内置，无需 execa）
// ─────────────────────────────────────────────
async function executeTool(
  name: string,
  input: Record<string, string>
): Promise<string> {
  if (name === "bash") {
    const { command } = input;
    log.tool(`$ ${command}`);
    try {
      // Bun.$`...` 执行 shell 命令，.text() 返回 stdout 字符串
      const output = await Bun.$`bash -c ${command}`.text();
      return output || "(no output)";
    } catch (err: any) {
      // stderr 也要返回给 LLM，让它知道命令失败了
      return `Error (exit ${err.exitCode}): ${err.stderr?.toString() ?? err.message}`;
    }
  }
  return `Error: unknown tool "${name}"`;
}

// ─────────────────────────────────────────────
// 3. Agentic Loop
//    这是整个 s01 的核心，请仔细阅读每一步
// ─────────────────────────────────────────────
async function runAgent(userPrompt: string): Promise<void> {
  log.info(`User: ${userPrompt}\n`);

  // messages 是 loop 的核心状态
  // 每次迭代后它会增长：assistant 回复 + tool_result
  // LLM 每次都能看到完整历史，这就是它"记忆"的来源
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  let iteration = 0;

  while (true) {
    iteration++;
    log.agent(`── iteration ${iteration} ──────────────────────`);

    // ① 调用 LLM，使用 streaming（防止长回复超时）
    //   stream.on("text") 实时打印文字，finalMessage() 等待完整响应
    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      tools: TOOLS,
      messages,
    });

    // 实时输出 LLM 正在生成的文字
    stream.on("text", (delta) => process.stdout.write(delta));

    // 等待完整响应（包含 stop_reason 和完整的 content blocks）
    const response = await stream.finalMessage();
    process.stdout.write("\n");

    log.agent(`stop_reason: ${response.stop_reason}`);

    // ② 根据 stop_reason 决定下一步
    if (response.stop_reason === "end_turn") {
      // LLM 认为任务完成，退出循环
      log.ok("Agent finished.");
      return;
    }

    if (response.stop_reason === "tool_use") {
      // ③ 把 assistant 的完整回复追加到 messages
      //    注意：必须追加整个 content 数组（包含 tool_use blocks）
      //    不能只追加文字，否则后续 API 调用会报错
      messages.push({ role: "assistant", content: response.content });

      // ④ 找出所有 tool_use block，执行并收集结果
      //    Claude 可能在一次回复中请求多个工具调用
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          log.tool(`calling: ${block.name}(${JSON.stringify(block.input)})`);

          const result = await executeTool(
            block.name,
            block.input as Record<string, string>
          );

          log.tool(`result: ${result.slice(0, 300)}${result.length > 300 ? "..." : ""}`);

          // 每个 tool_result 必须携带对应的 tool_use_id
          // 这是 Claude 知道哪个工具返回了什么的方式
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // ⑤ 把工具结果作为 user 消息追加
      //    API 规定：tool_result 必须放在 role: "user" 的消息里
      messages.push({ role: "user", content: toolResults });

      // → 继续下一次循环，messages 已包含完整上下文
    }
  }
}

// ─────────────────────────────────────────────
// 4. 运行
//    把 prompt 改成任何你想让 agent 做的事情
// ─────────────────────────────────────────────
await runAgent(
  "用中文回答：当前目录有哪些文件？然后告诉我 package.json 里定义了哪些 scripts"
);
