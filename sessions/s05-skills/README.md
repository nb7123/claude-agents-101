# s05 — Skills

> **Motto:** "Load knowledge when you need it, not upfront"

## 一句话

将领域知识存入 `.md` 文件，通过 `load_skill` 工具按需注入 context，避免 system prompt 无限膨胀。

## 核心概念

**问题：** 把所有知识塞进 system prompt 有三个缺陷：
1. 浪费 token（每次请求都携带全部知识，不管用不用）
2. 降低质量（无关知识分散 LLM 注意力）
3. 难维护（system prompt 越来越长）

**解法：** Skills = 懒加载的知识单元。System prompt 只暴露"有哪些 skill"，具体内容在被调用时才读取文件注入。

**关键洞察：** 知识注入的时机由 LLM 自己决定——它会在需要某类知识时主动调用 `load_skill`。

## Skill 注册表

```typescript
const SKILL_REGISTRY: Record<string, string> = {
  "typescript-conventions": "TypeScript 编码规范：命名、类型、异步、导入规范",
  "anthropic-api-tips":     "Anthropic API 使用要点：模型选择、关键参数、Tool Use 最佳实践",
  "code-review-checklist":  "代码审查清单：安全性、可靠性、可维护性、性能、测试",
};
```

System prompt 只包含 key 和 description，不包含内容本身。

## 工作流程

```
用户请求代码审查 →
  [load_skill "code-review-checklist"]  按需加载清单 →
  LLM 获得具体知识，开始按清单审查 →
  [load_skill "typescript-conventions"]  如需要，继续加载 →
  输出审查报告
```

## 本课要点

| 要点 | 说明 |
|------|------|
| `skills/` 目录 | `.md` 文件即知识库，随时可以添加/更新 |
| `load_skill` 工具 | 读取文件内容，以 tool_result 注入 context |
| 懒加载 | 只有被需要的知识才占用 token |
| 可扩展 | 添加新 skill = 新建一个 `.md` 文件 + 注册一行 |

## 目录结构

```
s05-skills/
├── index.ts
└── skills/
    ├── typescript-conventions.md
    ├── anthropic-api-tips.md
    └── code-review-checklist.md
```

## 运行

```sh
bun run s05
```

---

**上一课：** [s04 — Subagents](../s04-subagents/) — 子代理分发任务
**下一课：** [s06 — Context Compact](../s06-context-compact/) — 解决 context 无限增长问题
