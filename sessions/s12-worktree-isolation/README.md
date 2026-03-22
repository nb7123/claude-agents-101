# s12 — Worktree Isolation

> **Motto:** "Each agent gets its own sandbox"

## 一句话

用 git worktree 为每个 agent 创建独立的工作沙盒：agent 的写操作只在自己的分支生效，主仓库保持干净。

## 核心概念

**问题：** 多个 agent 共享同一个工作目录时，写操作会相互干扰，难以追踪哪个 agent 做了什么。

**解法：** `git worktree add` 为每个 agent 创建独立的工作目录，指向同一仓库但不同分支。

**关键洞察：** Worktree 不是复制仓库——它共享 `.git` 对象库，创建和销毁都极快。每个 agent 拥有独立的文件树和 HEAD，互不干扰。

## Worktree 生命周期

```
创建: git worktree add -b agent/name-{ts} /tmp/worktree-name HEAD
  ↓
运行 agent（cwd = worktree 路径）
  ↓
隔离验证：report.md 在 worktree ✓ | 在主仓库 ✗
  ↓
清理: git worktree remove --force + git branch -D
```

## 安全路径检查

每个 agent 只能读写其 worktree 内的路径，防止路径逃逸：

```typescript
function safePath(worktreePath: string, relativePath: string): string {
  const resolved = join(worktreePath, relativePath.replace(/^\//, ""));
  if (!resolved.startsWith(worktreePath)) {
    throw new Error(`Path escape attempt: ${relativePath}`);
  }
  return resolved;
}
```

## 隔离验证

```typescript
const reportInWorktree = existsSync(`${wt.path}/${reportFile}`);  // ✓ true
const reportInMain     = existsSync(`${REPO_ROOT}/${reportFile}`); // ✓ false
```

## 降级策略

不在 git 仓库中时，自动降级为目录复制（`cp -r`），保持 API 不变。

## 运行

```sh
bun run s12
```

演示场景：两个 reviewer agent 顺序运行，各自在独立 worktree 中读取代码并写入审查报告，主仓库在整个过程中保持干净。

## 扩展思路

| 场景 | 方式 |
|------|------|
| 并发多 agent | `Promise.all` + 每个 agent 独立 worktree |
| 合并结果 | `git diff`、`git cherry-pick`、或读取 worktree 文件再手动合并 |
| 审计追踪 | 每个 branch 保留完整 git 历史 |
| CI 流水线 | 每个 PR 检查在独立 worktree 运行，互不阻塞 |

---

**上一课：** [s11 — Autonomous Agents](../s11-autonomous-agents/) — 自主探索型 agent

**课程完结** 🎉 — 恭喜完成全部 12 个 session！
