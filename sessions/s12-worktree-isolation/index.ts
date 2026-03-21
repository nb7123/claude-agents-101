// s12 — Worktree Isolation
// Motto: "Each agent gets its own sandbox"
//
// s11 的 agent 直接在主目录操作文件，多个 agent 共享 cwd 会相互干扰
// s12 引入 git worktree：每个 agent 在独立的 worktree 中工作，互不影响
//
// 核心概念：
//   1. Git Worktree：一个仓库可以有多个工作目录，各自独立 checkout
//   2. 隔离执行：每个 agent 拥有自己的 cwd，写操作互不干扰
//   3. 结果合并：agent 完成后，可以 diff / cherry-pick 合并成果
//   4. 清理策略：任务完成后自动删除 worktree，保持仓库整洁
//
// 实现方式：
//   - git worktree add / remove 管理沙盒
//   - Anthropic SDK + betaZodTool 实现文件读写工具
//   - 每个 agent 只能读写其 worktree 内的文件路径
//   - 顺序运行两个隔离 agent，验证主仓库保持干净

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const client = new Anthropic();
const REPO_ROOT = "/Users/xiaodongliu/Projects/startup-ai";

// ─────────────────────────────────────────────
// Worktree 管理
// ─────────────────────────────────────────────
interface Worktree {
  name: string;
  path: string;
  branch: string;
}

async function createWorktree(name: string): Promise<Worktree> {
  const ts = Date.now();
  const worktreePath = `/tmp/worktree-${name}-${ts}`;
  const branch = `agent/${name}-${ts}`;

  log.info(`[worktree] creating: ${name}`);

  const isGitRepo = existsSync(join(REPO_ROOT, ".git"));
  if (isGitRepo) {
    await $`git -C ${REPO_ROOT} worktree add -b ${branch} ${worktreePath} HEAD`.quiet();
    log.ok(`[worktree] ready: ${worktreePath} (branch: ${branch})`);
    return { name, path: worktreePath, branch };
  }

  // 非 git 仓库：降级到目录复制
  await $`mkdir -p ${worktreePath}`.quiet();
  await $`cp -r ${REPO_ROOT}/sessions ${worktreePath}/`.quiet();
  log.ok(`[worktree] ready (copy): ${worktreePath}`);
  return { name, path: worktreePath, branch: "copy" };
}

async function removeWorktree(wt: Worktree): Promise<void> {
  if (wt.branch === "copy") {
    await $`rm -rf ${wt.path}`.quiet();
  } else {
    try {
      await $`git -C ${REPO_ROOT} worktree remove --force ${wt.path}`.quiet();
      await $`git -C ${REPO_ROOT} branch -D ${wt.branch}`.quiet();
    } catch {
      await $`rm -rf ${wt.path}`.quiet().catch(() => {});
    }
  }
  log.info(`[worktree] removed: ${wt.name}`);
}

// ─────────────────────────────────────────────
// 沙盒工具：限制文件访问到 worktree 路径内
// ─────────────────────────────────────────────
function makeSandboxedTools(wt: Worktree) {
  // 安全路径检查：确保操作不逃出 worktree
  function safePath(relativePath: string): string {
    const resolved = join(wt.path, relativePath.replace(/^\//, ""));
    if (!resolved.startsWith(wt.path)) {
      throw new Error(`Path escape attempt: ${relativePath}`);
    }
    return resolved;
  }

  const readFile = betaZodTool({
    name: "read_file",
    description: "Read a file within this agent's sandboxed workspace.",
    inputSchema: z.object({
      path: z.string().describe("Relative path from workspace root"),
    }),
    run: async ({ path }) => {
      const full = safePath(path);
      if (!existsSync(full)) return `[not found: ${path}]`;
      log.tool(`  [read] ${path}`);
      return readFileSync(full, "utf-8");
    },
  });

  const writeFile = betaZodTool({
    name: "write_file",
    description: "Write a file to this agent's sandboxed workspace. Does NOT affect the main repository.",
    inputSchema: z.object({
      path: z.string().describe("Relative path from workspace root"),
      content: z.string().describe("File content"),
    }),
    run: async ({ path, content }) => {
      const full = safePath(path);
      writeFileSync(full, content, "utf-8");
      log.tool(`  [write] ${path} (${content.length} chars)`);
      return `Written to sandbox: ${path}`;
    },
  });

  const listFiles = betaZodTool({
    name: "list_files",
    description: "List files in a directory within this agent's workspace.",
    inputSchema: z.object({
      directory: z.string().describe("Relative directory path"),
    }),
    run: async ({ directory }) => {
      const full = safePath(directory);
      if (!existsSync(full)) return `[directory not found: ${directory}]`;
      const { stdout } = await $`ls ${full}`.quiet();
      log.tool(`  [list] ${directory}`);
      return stdout.toString().trim();
    },
  });

  return [readFile, writeFile, listFiles];
}

// ─────────────────────────────────────────────
// 在 worktree 中运行 agent
// ─────────────────────────────────────────────
interface AgentTask {
  name: string;
  sessions: string[];   // 要审查的 session 目录
  outputFile: string;   // 写入审查报告的文件名
}

async function runIsolatedAgent(task: AgentTask): Promise<{ result: string; reportContent: string }> {
  const wt = await createWorktree(task.name);
  log.info(`\n[${task.name}] starting in worktree: ${wt.path}`);

  const tools = makeSandboxedTools(wt);

  const sessionList = task.sessions.map(s => `sessions/${s}/index.ts`).join(", ");
  const prompt =
    `You are a code reviewer. Read these session files: ${sessionList}. ` +
    `Then write a review report to ${task.outputFile} with: ` +
    `(1) patterns demonstrated, (2) one strength, (3) one improvement. ` +
    `Finally, respond with a 2-3 sentence summary of your findings.`;

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 2048,
    system:
      "You are a senior engineer reviewing a learning curriculum codebase. " +
      "Be concise and constructive. Use the tools to read files and write your report.",
    tools,
    messages: [{ role: "user", content: prompt }],
  });

  let lastText = "";
  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) {
        lastText = block.text.trim();
      }
    }
  }

  // 读取写入的报告（演示 worktree 内确实有内容）
  const reportPath = join(wt.path, task.outputFile);
  const reportContent = existsSync(reportPath)
    ? readFileSync(reportPath, "utf-8")
    : "(no report file written)";

  // 验证隔离：主仓库中不存在此文件
  const inMainRepo = existsSync(join(REPO_ROOT, task.outputFile));
  log.info(`[isolation] ${task.outputFile} in worktree: ✓ | in main repo: ${inMainRepo ? "⚠️ YES" : "✓ NO"}`);

  await removeWorktree(wt);
  return { result: lastText, reportContent };
}

// ─────────────────────────────────────────────
// 演示
// ─────────────────────────────────────────────
log.info("\n" + "═".repeat(56));
log.info("s12 — Worktree Isolation");
log.info("Motto: \"Each agent gets its own sandbox\"");
log.info("═".repeat(56));

log.info("\nScenario: Two agents review different phases of startup-ai.");
log.info("Each writes a report file. Main repo stays clean.\n");

const tasks: AgentTask[] = [
  {
    name: "reviewer-a",
    sessions: ["s01-agent-loop", "s02-tool-system"],
    outputFile: "review-phase1.md",
  },
  {
    name: "reviewer-b",
    sessions: ["s09-agent-teams", "s10-team-protocols"],
    outputFile: "review-phase4.md",
  },
];

const results: { name: string; result: string; reportContent: string }[] = [];

for (const task of tasks) {
  log.info("─".repeat(56));
  const { result, reportContent } = await runIsolatedAgent(task);
  results.push({ name: task.name, result, reportContent });
}

// ── 汇总 ──
log.info("\n" + "═".repeat(56));
log.info("Agent Results");
log.info("═".repeat(56));

for (const { name, result, reportContent } of results) {
  log.info(`\n── ${name} ──`);
  process.stdout.write(result + "\n");
  log.info(`\nReport preview (first 200 chars):\n${reportContent.slice(0, 200)}…`);
}

// ── 最终验证：主仓库干净 ──
log.info("\n" + "─".repeat(56));
const dirty = tasks.map(t => t.outputFile).filter(f => existsSync(join(REPO_ROOT, f)));
if (dirty.length === 0) {
  log.ok("Main repository is clean — no agent files leaked.");
} else {
  log.error(`Files leaked to main repo: ${dirty.join(", ")}`);
}

log.ok("\nWorktree isolation demo complete.");
log.info("Key insight: git worktrees give each agent a full repo copy");
log.info("with its own branch — file writes never touch the main workspace.");
