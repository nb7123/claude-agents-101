// s05 — Skills
// Motto: "Load knowledge when you need it, not upfront"
//
// 问题：把所有知识塞进 system prompt 有三个缺陷：
//   1. 浪费 token（每次请求都要带着所有知识，不管用不用）
//   2. 降低质量（无关知识会分散 LLM 注意力）
//   3. 难维护（system prompt 越来越长）
//
// 解法：Skills = 按需加载的知识单元
//   - 知识存储在 .md 文件里（skills/ 目录）
//   - agent 通过 load_skill 工具按名字加载
//   - 知识以 tool_result 形式注入 context，按需使用
//
// 关键洞察：知识注入的时机由 LLM 自己决定
//   system prompt 只告诉它"有哪些 skill 可以加载"
//   而不是把知识内容全部放进去

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";
import { join } from "path";

const client = new Anthropic();
const SKILLS_DIR = join(import.meta.dir, "skills");

// ─────────────────────────────────────────────
// Skill 注册表
// 只在 system prompt 里暴露 skill 名称和描述
// 内容在被加载时才读取——懒加载
// ─────────────────────────────────────────────
const SKILL_REGISTRY: Record<string, string> = {
  "typescript-conventions": "TypeScript 编码规范：命名、类型、异步、导入规范",
  "anthropic-api-tips":     "Anthropic API 使用要点：模型选择、关键参数、Tool Use 最佳实践",
  "code-review-checklist":  "代码审查清单：安全性、可靠性、可维护性、性能、测试",
};

// ─────────────────────────────────────────────
// 工具定义
// ─────────────────────────────────────────────

// list_skills：让 agent 知道有哪些知识可以加载
const listSkillsTool = betaZodTool({
  name: "list_skills",
  description:
    "List all available skills (knowledge modules) that can be loaded. " +
    "Call this first to discover what knowledge is available before loading.",
  inputSchema: z.object({}),
  run: async () => {
    const entries = Object.entries(SKILL_REGISTRY)
      .map(([name, desc]) => `- ${name}: ${desc}`)
      .join("\n");
    log.tool("list_skills");
    return `Available skills:\n${entries}`;
  },
});

// load_skill：按需加载知识内容
// 知识以 tool_result 形式出现在 messages 历史中
// LLM 读取它，用完这个对话后不再占用后续 context
const loadSkillTool = betaZodTool({
  name: "load_skill",
  description:
    "Load a specific skill (knowledge module) by name. " +
    "The skill content will be injected into the conversation context. " +
    "Only load skills that are relevant to the current task.",
  inputSchema: z.object({
    name: z.string().describe("Skill name from list_skills"),
  }),
  run: async ({ name }) => {
    if (!SKILL_REGISTRY[name]) {
      return `Error: skill "${name}" not found. Use list_skills to see available skills.`;
    }
    const path = join(SKILLS_DIR, `${name}.md`);
    try {
      const content = await Bun.file(path).text();
      log.tool(`load_skill: ${name} (${content.length} chars)`);
      return `=== SKILL: ${name} ===\n\n${content}`;
    } catch {
      return `Error: could not read skill file for "${name}"`;
    }
  },
});

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
// Agent
// system prompt 只告诉 agent "有 skills 可用"
// 不暴露任何知识内容——内容在 load_skill 时才注入
// ─────────────────────────────────────────────
async function runAgent(userPrompt: string): Promise<void> {
  log.info(`User: ${userPrompt}\n`);

  const tools = [listSkillsTool, loadSkillTool, bashTool];

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You are a helpful coding assistant. " +
      "You have access to knowledge modules (skills) that you can load on demand. " +
      "When a task requires specific knowledge, use list_skills to discover " +
      "what's available and load_skill to retrieve relevant content. " +
      "Only load skills that are actually needed for the current task.",
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

  log.ok("Agent finished.");
}

// ─────────────────────────────────────────────
// 演示：三个不同任务，观察 agent 按需加载不同 skill
//
// 任务1：需要 typescript-conventions
// 任务2：需要 anthropic-api-tips
// 任务3：需要 code-review-checklist
// ─────────────────────────────────────────────

console.log("\n" + "═".repeat(60));
console.log("任务 1：代码风格审查");
console.log("═".repeat(60) + "\n");

await runAgent(
  "请审查以下 TypeScript 代码是否符合最佳实践，指出问题：\n\n" +
  "```typescript\n" +
  "const getData = async (ID: string) => {\n" +
  "  const res = await fetch(`http://api.example.com/data/${ID}`)\n" +
  "  const d = await res.json()\n" +
  "  return d\n" +
  "}\n" +
  "```"
);

console.log("\n" + "═".repeat(60));
console.log("任务 2：API 使用咨询");
console.log("═".repeat(60) + "\n");

await runAgent(
  "我想用 Claude 构建一个需要长时间运行的 agent，" +
  "应该选哪个模型？调用时有什么需要注意的参数？"
);
