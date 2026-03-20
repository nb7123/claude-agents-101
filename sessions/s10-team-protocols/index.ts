// s10 — Team Protocols
// Motto: "Agree before you ship"
//
// s09 的团队是硬编码的顺序流水线，每个 agent 只管自己的输出
// s10 引入协议层：agent 之间通过结构化消息通信，团队可以投票、否决、重试
//
// 核心概念：
//   1. 结构化消息（Message Protocol）：每条消息有 from/to/type/payload
//   2. 评审协议（Review Protocol）：提案提交后，多个评审 agent 打分
//   3. 共识机制（Consensus）：平均分达到阈值才通过，否则打回重写
//   4. 动态重试：writer 根据评审意见修改，直到通过
//
// 演示：代码方案评审
//   proposer 提出技术方案 → 两个 reviewer 独立打分 → orchestrator 判断是否通过
//   若不通过，proposer 参考评审意见修改，重新提交

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "@learn/shared";

const client = new Anthropic();

// ─────────────────────────────────────────────
// 消息协议
// ─────────────────────────────────────────────
type MessageType =
  | "proposal"      // 提案
  | "review"        // 评审结果
  | "revision"      // 修改版
  | "approved"      // 最终通过
  | "rejected";     // 最终否决

interface TeamMessage {
  id: string;
  from: string;
  to: string;        // "all" 或具体 agent 名
  type: MessageType;
  payload: string;   // 消息内容（JSON 字符串）
  timestamp: string;
}

interface ReviewPayload {
  score: number;     // 1-10
  strengths: string;
  weaknesses: string;
  suggestion: string;
}

// ─────────────────────────────────────────────
// 消息总线
// ─────────────────────────────────────────────
class MessageBus {
  private messages: TeamMessage[] = [];
  private counter = 0;

  send(from: string, to: string, type: MessageType, payload: string): TeamMessage {
    const msg: TeamMessage = {
      id: `msg-${++this.counter}`,
      from, to, type, payload,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);
    log.tool(`  [bus] ${from} → ${to} [${type}]`);
    return msg;
  }

  getFor(agent: string, type?: MessageType): TeamMessage[] {
    return this.messages.filter(m =>
      (m.to === agent || m.to === "all") &&
      (!type || m.type === type)
    );
  }

  getLast(type: MessageType): TeamMessage | undefined {
    return [...this.messages].reverse().find(m => m.type === type);
  }

  format(msgs: TeamMessage[]): string {
    if (msgs.length === 0) return "(no messages)";
    return msgs.map(m =>
      `[${m.type}] from ${m.from}: ${m.payload}`
    ).join("\n\n");
  }
}

// ─────────────────────────────────────────────
// 工具：发送和读取消息
// ─────────────────────────────────────────────
function makeMessagingTools(bus: MessageBus, agentName: string) {
  const sendMsg = betaZodTool({
    name: "send_message",
    description: "Send a structured message to another agent or to all agents.",
    inputSchema: z.object({
      to: z.string().describe("Recipient agent name, or 'all'"),
      type: z.enum(["proposal", "review", "revision", "approved", "rejected"]),
      payload: z.string().describe("Message content"),
    }),
    run: async ({ to, type, payload }) => {
      bus.send(agentName, to, type, payload);
      return `Message sent to ${to} [${type}]`;
    },
  });

  const readMsgs = betaZodTool({
    name: "read_messages",
    description: "Read messages addressed to you or broadcast to all.",
    inputSchema: z.object({
      type: z.enum(["proposal", "review", "revision", "approved", "rejected"])
        .optional()
        .describe("Filter by message type"),
    }),
    run: async ({ type }) => {
      const msgs = bus.getFor(agentName, type);
      return bus.format(msgs);
    },
  });

  return [sendMsg, readMsgs];
}

// ─────────────────────────────────────────────
// 运行单个 agent（通用）
// ─────────────────────────────────────────────
async function runAgent(
  name: string,
  systemPrompt: string,
  userPrompt: string,
  bus: MessageBus,
): Promise<string> {
  const tools = makeMessagingTools(bus, name);

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages: [{ role: "user", content: userPrompt }],
  });

  let lastText = "";
  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) lastText = block.text;
    }
  }
  return lastText;
}

// ─────────────────────────────────────────────
// 协议流程
// ─────────────────────────────────────────────
const PASS_THRESHOLD = 7.0;  // 平均分 ≥ 7 才通过
const MAX_ROUNDS = 3;

async function runReviewProtocol(topic: string): Promise<void> {
  const bus = new MessageBus();

  log.info(`\n${"═".repeat(52)}`);
  log.info(`Review Protocol: "${topic}"`);
  log.info(`Reviewers: 2 | Pass threshold: ${PASS_THRESHOLD}/10 | Max rounds: ${MAX_ROUNDS}`);
  log.info(`${"═".repeat(52)}\n`);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log.info(`── Round ${round} ──────────────────────────────────`);

    // ── Step 1: Proposer 提出（或修改）方案 ──
    const isRevision = round > 1;
    log.info(`\n[proposer] ${isRevision ? "revising based on feedback..." : "drafting proposal..."}`);

    await runAgent(
      "proposer",
      "You are a senior software architect. Write clear, concrete technical proposals. " +
      (isRevision
        ? "You are revising a proposal. Read all review messages, address every weakness mentioned, then send an improved revision."
        : "Send your proposal to 'all' with type 'proposal'. Be specific about architecture, trade-offs, and implementation steps."),
      isRevision
        ? `Revise your technical proposal for "${topic}". Read your review messages first, then send a 'revision' message to 'all' addressing all feedback.`
        : `Write a technical proposal for: "${topic}". Send it as a 'proposal' message to 'all'.`,
      bus,
    );

    // ── Step 2: 两位 Reviewer 独立评审 ──
    log.info(`\n[reviewer-a] reviewing...`);
    await runAgent(
      "reviewer-a",
      "You are a pragmatic engineering lead focused on feasibility and risk. " +
      "Read the latest proposal/revision, evaluate it, and send a 'review' message to 'orchestrator' " +
      "with a JSON payload: {\"score\": 1-10, \"strengths\": \"...\", \"weaknesses\": \"...\", \"suggestion\": \"...\"}",
      `Review the latest proposal about "${topic}". Send your review to 'orchestrator'.`,
      bus,
    );

    log.info(`\n[reviewer-b] reviewing...`);
    await runAgent(
      "reviewer-b",
      "You are a security and scalability specialist. " +
      "Read the latest proposal/revision, evaluate it, and send a 'review' message to 'orchestrator' " +
      "with a JSON payload: {\"score\": 1-10, \"strengths\": \"...\", \"weaknesses\": \"...\", \"suggestion\": \"...\"}",
      `Review the latest proposal about "${topic}". Send your review to 'orchestrator'.`,
      bus,
    );

    // ── Step 3: Orchestrator 计算分数，决定通过/重试 ──
    const reviews = bus.getFor("orchestrator", "review");
    const roundReviews = reviews.slice(-(2)); // 最新一轮的两条

    let totalScore = 0;
    let validReviews = 0;
    const reviewSummaries: string[] = [];

    for (const rev of roundReviews) {
      try {
        // 提取 JSON（payload 可能包含额外文字）
        const match = rev.payload.match(/\{[\s\S]*\}/);
        if (!match) continue;
        const parsed = JSON.parse(match[0]) as ReviewPayload;
        totalScore += parsed.score;
        validReviews++;
        reviewSummaries.push(
          `${rev.from}: ${parsed.score}/10 — strengths: ${parsed.strengths} | weaknesses: ${parsed.weaknesses}`
        );
      } catch {
        // payload 不是标准 JSON，跳过
      }
    }

    const avgScore = validReviews > 0 ? totalScore / validReviews : 0;
    log.info(`\n[orchestrator] scores: ${reviewSummaries.join(" | ")}`);
    log.info(`[orchestrator] average: ${avgScore.toFixed(1)} / threshold: ${PASS_THRESHOLD}`);

    if (avgScore >= PASS_THRESHOLD) {
      bus.send("orchestrator", "all", "approved",
        `Proposal approved with average score ${avgScore.toFixed(1)}/${10} after ${round} round(s).`);
      log.ok(`\n✓ APPROVED (round ${round}, score ${avgScore.toFixed(1)})`);

      // 打印最终方案
      const lastProposal = bus.getLast("proposal") ?? bus.getLast("revision");
      if (lastProposal) {
        log.info(`\n${"─".repeat(52)}`);
        log.info("Final Proposal:");
        log.info(`${"─".repeat(52)}`);
        process.stdout.write(lastProposal.payload + "\n");
      }
      return;
    }

    if (round === MAX_ROUNDS) {
      bus.send("orchestrator", "all", "rejected",
        `Proposal rejected after ${MAX_ROUNDS} rounds. Final score: ${avgScore.toFixed(1)}`);
      log.error(`\n✗ REJECTED after ${MAX_ROUNDS} rounds (final score ${avgScore.toFixed(1)})`);
      return;
    }

    log.info(`[orchestrator] score ${avgScore.toFixed(1)} below threshold — requesting revision`);
  }
}

// ─────────────────────────────────────────────
// 演示
// ─────────────────────────────────────────────
await runReviewProtocol("设计一个支持百万并发的实时消息推送系统");
