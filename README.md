# Codex Local Memory Dashboard

给 Codex 搭一个本地「记忆 + 自我进化 + 每日产出看板」工作流。

## 功能亮点

- **本地记忆脑**：通过 `AGENTS.md + agent-memory-mcp` 保存项目规则、技术栈、bug 修复和决策。
- **自我进化台账**：每次修 bug 后写入 `LEARNINGS.md`，让同类问题可复用。
- **每日产出看板**：按天展示用户提问、Codex 回复、命令执行、文件修改。
- **按项目筛选**：从 Codex session 的 `cwd` 自动识别项目，支持项目级过滤。
- **核心内容模式**：默认过滤系统注入、短进度播报、探测命令、临时文件噪音。
- **全部记录模式**：需要审计时可切回完整原始统计。
- **跨天会话归档**：按最近活动时间归档，避免昨天开的会话漏进今天日报。
- **低资源占用**：零第三方依赖，仅 Node.js 内置模块，适合 8GB 内存电脑按需启动。
- **桌面双击启动**：Windows 下可通过 `.bat + PowerShell` 一键打开看板。

## 快速开始

```powershell
cd tools/daily-dashboard
node server.js
```

打开：`http://localhost:3455`

Windows 可双击：`tools/daily-dashboard/看板.bat`

## 推荐工作流

1. 开工前读 `AGENTS.md` 与 `LEARNINGS.md`。
2. 检索 `agent-memory-mcp` 的历史 bug / pattern / decision。
3. 完成任务后，把可复用经验写入 `LEARNINGS.md` 与记忆库。
4. 用每日看板复盘当天产出，按项目和核心内容筛选。

## 看板统计口径

默认展示「核心内容」，过滤：系统注入、环境上下文、短进度播报、纯探测命令、临时文件操作。
如需审计完整过程，可切换「全部记录」。

## 注意

请不要把自己的 `~/.codex/sessions`、`.agentMemory/data.json`、真实项目路径、私有记忆内容直接提交到 GitHub。