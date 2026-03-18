# Anthropic API 使用要点

## 模型选择
- `claude-opus-4-6`：最强推理，适合复杂分析和 Agent 任务
- `claude-sonnet-4-6`：速度/质量平衡，适合大多数生产场景
- `claude-haiku-4-5`：最快最便宜，适合简单分类/提取

## 关键参数
- `max_tokens`：必须显式设置，建议 agent 任务设 4096+
- `thinking: { type: "adaptive" }`：Opus 4.6 开启自适应思考
- `stream: true`：长输出必须开流式，避免超时

## Tool Use 最佳实践
- description 是工具的"接口文档"，越详细越好
- `required` 字段只放真正必须的参数
- tool_result 要包含足够上下文，不只返回数据
- 一次回复中 Claude 可能调用多个工具，要全部处理

## 常见错误
- messages 必须 user/assistant 交替，不能连续同角色
- tool_result 必须放在 role: "user" 的消息里
- tool_use block 和对应 tool_result 的 id 必须匹配
- max_tokens 不够时 stop_reason 是 "max_tokens" 而非 "end_turn"
