// s09 — Agent Teams
// Motto: "Specialized roles, shared blackboard"
//
// s04 的 subagent 是一次性任务分发
// s09 构建真正的 agent 团队：每个 agent 有固定角色，通过共享黑板传递上下文
//
// 核心模式：Blackboard Pattern
//   黑板（Blackboard）：所有 agent 可读写的共享工作区
//   角色（Role）：不同的 system prompt 定义专业分工
//   编排（Orchestration）：orchestrator 按顺序调用专家 agent
//
// 演示：技术文章写作团队
//   researcher → outliner → writer → editor
//   每个角色读取前面角色的成果，输出自己的贡献

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();

// ─────────────────────────────────────────────
// 黑板：所有 agent 共享的写板
// ─────────────────────────────────────────────
interface BoardEntry {
  author: string;   // 写入者（agent 角色名）
  tag: string;      // 内容标签，如 "research" | "outline" | "draft" | "final"
  content: string;
  timestamp: string;
}

class Blackboard {
  private entries: BoardEntry[] = [];

  post(author: string, tag: string, content: string): void {
    this.entries.push({ author, tag, content, timestamp: new Date().toISOString() });
  }

  read(tags?: string[]): BoardEntry[] {
    if (!tags || tags.length === 0) return this.entries;
    return this.entries.filter(e => tags.includes(e.tag));
  }

  format(tags?: string[]): string {
    const entries = this.read(tags);
    if (entries.length === 0) return "(empty)";
    return entries
      .map(e => `[${e.tag} by ${e.author}]\n${e.content}`)
      .join("\n\n---\n\n");
  }
}

// ─────────────────────────────────────────────
// 黑板工具：注入到每个 agent
// ─────────────────────────────────────────────
function makeBlackboardTools(board: Blackboard, agentName: string) {
  const postTool = betaZodTool({
    name: "post_to_board",
    description: "Post your output to the shared blackboard for other agents to read.",
    inputSchema: z.object({
      tag: z.string().describe("Content tag, e.g. 'research', 'outline', 'draft', 'final'"),
      content: z.string().describe("Your output content"),
    }),
    run: async ({ tag, content }) => {
      board.post(agentName, tag, content);
      log.tool(`  [board] ${agentName} posted "${tag}" (${content.length} chars)`);
      return `Posted to board with tag "${tag}"`;
    },
  });

  const readTool = betaZodTool({
    name: "read_board",
    description: "Read entries from the shared blackboard. Filter by tags to see specific outputs.",
    inputSchema: z.object({
      tags: z.array(z.string()).optional()
        .describe("Filter by tags (e.g. ['research', 'outline']). Omit for all entries."),
    }),
    run: async ({ tags }) => {
      const content = board.format(tags);
      log.tool(`  [board] ${agentName} read board${tags ? ` (tags: ${tags.join(", ")})` : ""}`);
      return content;
    },
  });

  return [postTool, readTool];
}

// ─────────────────────────────────────────────
// Agent 角色定义
// ─────────────────────────────────────────────
interface AgentRole {
  name: string;
  title: string;
  systemPrompt: string;
  buildPrompt: (topic: string) => string;
  readTags?: string[];  // 运行前预读的黑板标签（方便 debug）
}

const ROLES: AgentRole[] = [
  {
    name: "researcher",
    title: "Research Specialist",
    systemPrompt:
      "You are a research specialist. Your job is to gather key insights and facts about a topic. " +
      "Be thorough but concise. Focus on concrete, actionable insights. " +
      "Always post your research to the blackboard using post_to_board with tag 'research'.",
    buildPrompt: (topic) =>
      `Research the topic: "${topic}"\n\n` +
      `Identify 5-7 key insights, trends, and concrete examples. ` +
      `Then post your research to the blackboard.`,
  },
  {
    name: "outliner",
    title: "Content Strategist",
    systemPrompt:
      "You are a content strategist. Your job is to create clear, logical article outlines. " +
      "Read the research from the blackboard, then craft a compelling structure. " +
      "Always post your outline to the blackboard using post_to_board with tag 'outline'.",
    buildPrompt: (topic) =>
      `Create an article outline for: "${topic}"\n\n` +
      `First, read the research from the blackboard (tag: research). ` +
      `Then create a structured outline with sections and key points. ` +
      `Post your outline to the blackboard.`,
    readTags: ["research"],
  },
  {
    name: "writer",
    title: "Technical Writer",
    systemPrompt:
      "You are a technical writer. Your job is to write engaging, informative articles. " +
      "Read the research and outline from the blackboard, then write the full article. " +
      "Always post your draft to the blackboard using post_to_board with tag 'draft'.",
    buildPrompt: (topic) =>
      `Write a technical article about: "${topic}"\n\n` +
      `First, read the research and outline from the blackboard (tags: research, outline). ` +
      `Then write a complete article draft (400-600 words). ` +
      `Post your draft to the blackboard.`,
    readTags: ["research", "outline"],
  },
  {
    name: "editor",
    title: "Senior Editor",
    systemPrompt:
      "You are a senior editor. Your job is to polish articles for clarity, flow, and impact. " +
      "Read the draft from the blackboard, improve it, and post the final version. " +
      "Always post your final version using post_to_board with tag 'final'.",
    buildPrompt: (topic) =>
      `Edit and finalize the article about: "${topic}"\n\n` +
      `First, read the draft from the blackboard (tag: draft). ` +
      `Improve clarity, fix any issues, strengthen the opening and conclusion. ` +
      `Post the polished final version to the blackboard.`,
    readTags: ["draft"],
  },
];

// ─────────────────────────────────────────────
// 运行单个 agent 角色
// ─────────────────────────────────────────────
async function runAgent(role: AgentRole, topic: string, board: Blackboard): Promise<void> {
  log.info(`\n┌─ [${role.title}] ${role.name} starting...`);

  const tools = makeBlackboardTools(board, role.name);

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 2048,
    system: role.systemPrompt,
    tools,
    messages: [{ role: "user", content: role.buildPrompt(topic) }],
  });

  let iterations = 0;
  for await (const message of runner) {
    iterations++;
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) {
        // 只打印较短的文字（工具调用的确认信息等）
        if (block.text.length < 200) {
          process.stdout.write(`│  ${block.text.trim()}\n`);
        }
      }
    }
  }

  log.ok(`└─ [${role.title}] done (${iterations} iterations)`);
}

// ─────────────────────────────────────────────
// 团队编排：顺序执行各角色
// ─────────────────────────────────────────────
async function runTeam(topic: string): Promise<void> {
  const board = new Blackboard();

  log.info(`\n${"═".repeat(50)}`);
  log.info(`Topic: "${topic}"`);
  log.info(`Team: ${ROLES.map(r => r.name).join(" → ")}`);
  log.info(`${"═".repeat(50)}`);

  // 顺序执行：每个 agent 完成后，下一个才开始（可以读到完整上下文）
  for (const role of ROLES) {
    await runAgent(role, topic, board);
  }

  // ─────────────────────────────────────────────
  // 输出最终成果
  // ─────────────────────────────────────────────
  log.info(`\n${"═".repeat(50)}`);
  log.info("Final Article");
  log.info(`${"═".repeat(50)}\n`);

  const finalEntries = board.read(["final"]);
  if (finalEntries.length > 0) {
    process.stdout.write(finalEntries[0].content + "\n");
  } else {
    log.error("No final content found on blackboard");
  }

  // 黑板摘要
  log.info(`\n${"─".repeat(50)}`);
  log.info("Blackboard summary:");
  for (const entry of board.read()) {
    log.info(`  [${entry.tag}] by ${entry.author} — ${entry.content.length} chars`);
  }
}

// ─────────────────────────────────────────────
// 演示
// ─────────────────────────────────────────────
await runTeam("如何用 AI Agent 提升软件开发团队的效率");
