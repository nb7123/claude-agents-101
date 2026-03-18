// s06 — Context Compact
// Motto: "Context will fill up; you need a way to make room"
//
// 问题：long-running agent 的 messages 数组会无限增长
//   每轮迭代追加 assistant + tool_result，几十轮后就撞上 200K token 限制
//
// 三种策略（复杂度递增）：
//   策略 1：截断（Truncation）  — 只保留最近 N 条，简单粗暴
//   策略 2：摘要（Summarize）   — 用 LLM 把历史压缩成摘要，再继续
//   策略 3：SDK Compaction      — Claude API beta，服务端自动滚动压缩
//
// 关键洞察：compaction block 是有状态的
//   必须把整个 response.content 追加回 messages（不能只要文字）
//   compaction block 会替换掉被压缩的历史，API 依赖它恢复上下文

import Anthropic from "@anthropic-ai/sdk";
import { log } from "@learn/shared";

const client = new Anthropic();

// ─────────────────────────────────────────────
// 工具函数：统计当前 messages 的 token 估算
// ─────────────────────────────────────────────
function estimateTokens(messages: Anthropic.MessageParam[]): number {
  const text = JSON.stringify(messages);
  // 粗略估算：4 字符 ≈ 1 token
  return Math.floor(text.length / 4);
}

function showStats(messages: Anthropic.MessageParam[], label: string): void {
  const tokens = estimateTokens(messages);
  log.info(`[${label}] messages: ${messages.length}, ~${tokens} tokens`);
}

// ─────────────────────────────────────────────
// 策略 1：截断（Truncation）
//
// 最简单的方案：超过阈值时，只保留 system + 最近 N 条消息
// 缺点：早期信息完全丢失，agent 会"忘记"之前做过的事
// ─────────────────────────────────────────────
function truncateMessages(
  messages: Anthropic.MessageParam[],
  keepLast: number
): Anthropic.MessageParam[] {
  if (messages.length <= keepLast) return messages;

  const truncated = messages.slice(-keepLast);

  // 确保第一条是 user（API 要求）
  const firstUserIdx = truncated.findIndex((m) => m.role === "user");
  return firstUserIdx > 0 ? truncated.slice(firstUserIdx) : truncated;
}

// ─────────────────────────────────────────────
// 策略 2：摘要（Summarize）
//
// 用 LLM 把历史压缩成一段摘要，再用摘要作为新对话的起点
// 保留语义，但需要额外一次 API 调用，且摘要会损失细节
// ─────────────────────────────────────────────
async function summarizeAndReset(
  messages: Anthropic.MessageParam[]
): Promise<Anthropic.MessageParam[]> {
  log.info("Summarizing conversation history...");

  const historyText = messages
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
    .join("\n\n");

  const summaryResp = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content:
        "Please summarize the following conversation history concisely, " +
        "preserving all important facts, decisions, and outcomes:\n\n" +
        historyText,
    }],
  });

  const summary = summaryResp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  log.ok(`Summary (${summary.length} chars): ${summary.slice(0, 100)}...`);

  // 用摘要作为新对话的起点
  return [
    {
      role: "user",
      content: `[Previous conversation summary]\n${summary}\n\n[Continue from here]`,
    },
    {
      role: "assistant",
      content: "Understood. I'll continue based on the conversation summary.",
    },
  ];
}

// ─────────────────────────────────────────────
// 策略 3：SDK Compaction（官方方案）
//
// Claude API 的 beta 功能，服务端自动在 context 接近上限时压缩历史
// 压缩时 response.content 会包含 compaction block
// 必须把完整的 response.content 追加回 messages！
// ─────────────────────────────────────────────
async function chatWithCompaction(turns: number): Promise<void> {
  log.info(`\n=== 策略 3：SDK Compaction (${turns} turns) ===\n`);

  const messages: Anthropic.Beta.BetaMessageParam[] = [];

  for (let i = 0; i < turns; i++) {
    messages.push({
      role: "user",
      content: `Turn ${i + 1}: Tell me one interesting fact about the number ${i + 1}. Keep it brief.`,
    });

    const response = await client.beta.messages.create({
      // beta header 开启 compaction
      betas: ["compact-2026-01-12"],
      model: "claude-opus-4-6",       // compaction 仅支持 Opus 4.6
      max_tokens: 256,
      messages,
      context_management: {
        edits: [{ type: "compact_20260112" }],
      },
    });

    // ⚠️ 关键：必须追加完整 content，不能只取 text
    // compaction block 会替换被压缩的历史，API 依赖它
    messages.push({ role: "assistant", content: response.content });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // 检查是否触发了 compaction
    const hasCompaction = response.content.some(
      (b) => b.type === "context_compaction"  // compaction block 类型
    );

    log.agent(
      `turn ${i + 1} | messages: ${messages.length}` +
      (hasCompaction ? " | ⚡ compacted" : "")
    );
    process.stdout.write(`  ${text}\n`);
  }
}

// ─────────────────────────────────────────────
// 演示三种策略
// ─────────────────────────────────────────────

// --- 策略 1 & 2：模拟一段长对话，然后压缩 ---
log.info("=== 策略 1 & 2 演示 ===\n");

// 构造一段有历史的对话
const longHistory: Anthropic.MessageParam[] = [];
for (let i = 0; i < 20; i++) {
  longHistory.push({ role: "user", content: `Question ${i + 1}: What is ${i + 1} + ${i + 1}?` });
  longHistory.push({ role: "assistant", content: `${(i + 1) * 2}` });
}

showStats(longHistory, "原始");

// 策略 1：截断
const truncated = truncateMessages(longHistory, 6);
showStats(truncated, "截断后（保留最近6条）");

// 策略 2：摘要
const summarized = await summarizeAndReset(longHistory);
showStats(summarized, "摘要后");

// --- 策略 3：SDK Compaction ---
await chatWithCompaction(8);

log.ok("\n三种策略对比：");
console.log("  截断：简单快速，适合无需回溯历史的场景");
console.log("  摘要：保留语义，需额外 API 调用，适合需要上下文连贯的场景");
console.log("  Compaction：官方方案，服务端自动触发，适合长期运行的 agent");
