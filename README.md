# Codex Local Memory Dashboard

给 Codex 搭一个本地「记忆 + 自我进化 + 每日产出看板」开源工具。

它不是云服务，也不依赖数据库。核心组件：

- `AGENTS.example.md` — 项目规则与记忆工作流示例
- `LEARNINGS.example.md` — 人类可读踩坑台账模板
- `tools/daily-dashboard/` — 零依赖 Node 每日产出看板

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

## 目录结构

```text
.
├─ AGENTS.example.md
├─ LEARNINGS.example.md
├─ tools/
│  └─ daily-dashboard/
│     ├─ server.js
│     ├─ start-dashboard.ps1
│     └─ 看板.bat
└─ docs/
   └─ github-release-plan.md
```

## 快速开始

### 1. 准备 Node.js

建议 Node.js 18+。

```powershell
node -v
```

### 2. 启动每日产出看板

```powershell
cd tools/daily-dashboard
node server.js
```

打开：`http://localhost:3455`

### 3. Windows 双击启动

双击：`tools/daily-dashboard/看板.bat`

它会后台启动 `server.js` 并打开浏览器。

### 4. 配置 AGENTS.md

把 `AGENTS.example.md` 复制为项目根目录的 `AGENTS.md`，按你的项目修改技术栈、命令和记忆规则。

### 5. 配置 agent-memory-mcp

可使用开源 MCP 记忆服务（如 `agent-memory-mcp` 类工具）。推荐约定：

- `projectId`：你的项目 ID
- `bug`：bug 修复和踩坑
- `pattern`：可复用工程模式
- `decision`：技术决策
- `feature`：功能沉淀

## 看板统计口径

默认展示「核心内容」。核心模式会过滤：

- AGENTS / environment / permissions 等系统注入
- Codex 短进度播报
- `netstat`、`Get-Process`、`Get-Content` 等纯探测命令
- TEMP、log、tmp、bak 等临时文件操作

如需审计完整记录，可切换到「全部记录」。

## 常见问题

### 为什么今天的记录以前没有显示？

Codex 可能把今天的对话追加到昨天创建的会话文件里。本看板按「最近活动时间」归档，可正确归到当天。

### 看板会上传数据吗？

不会。看板只读取本地 `~/.codex/sessions/*.jsonl`，不联网、不上传。

## 注意

请不要把自己的 `~/.codex/sessions`、`.agentMemory/data.json`、真实项目路径、私有记忆内容直接提交到 GitHub。

## License

MIT