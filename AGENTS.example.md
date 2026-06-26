# Codex Local Memory Dashboard — AGENTS 示例

## 语言要求
- 使用简体中文交流。
- 文件路径、命令、技术术语保留英文原文。

## 项目规则
- 修改代码前先查看相关文件。
- 多步骤任务使用计划工具。
- 不提交 secrets、私有路径、会话数据。

## Memory & Self-Improvement

本项目推荐接入本地 `agent-memory-mcp`，并用 `LEARNINGS.md` 做人类可读踩坑台账。

### 开工前
1. 先读 `LEARNINGS.md` 顶部最近条目。
2. 检索记忆库：`memory_search({ projectId: "your-project-id", query: "任务关键词" })`。

### 收尾时
出现以下情况必须沉淀：
- 命令/操作失败并最终修复
- 被用户纠正了输出或做法
- 发现可复用模式或重要决策

沉淀动作：
1. 在 `LEARNINGS.md` 顶部新增记录。
2. 写入记忆库：`memory_write({ projectId, key, type, content, tags })`。

### 类型建议
- `bug`：bug 修复和踩坑
- `pattern`：可复用工程模式
- `decision`：技术决策
- `feature`：功能沉淀
