#!/usr/bin/env node
/**
 * Codex 每日产出看板 (Daily Output Dashboard)
 * 零依赖：仅用 Node 内置模块。解析 ~/.codex/sessions 下的 .jsonl 会话，
 * 按天聚合产出（会话/提问/回复/命令/改文件），可点击查看详情。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.DASH_PORT ? Number(process.env.DASH_PORT) : 3455;
const SESS_DIR = path.join(os.homedir(), '.codex', 'sessions');

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function safeJson(line) { try { return JSON.parse(line); } catch { return null; } }
function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content.map(c => (c && (c.text || c.output_text || ''))).join('').trim();
}

function isInjectedUserText(text) {
  const head = String(text || '').slice(0, 240);
  return !text || text.startsWith('<') || /# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>|<permissions instructions>|<developer_instructions>|turn_context|filesystem|workspace_roots/i.test(head);
}
function isAssistantProgress(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length < 18) return true;
  const coreHint = /(已完成|已修好|修复|验证结果|问题原因|改动内容|结果|总结|建议|注意|根因|已沉淀|新增|更新|删除|重启|通过|失败|文件|功能|看板|记忆库|LEARNINGS|server\.js|AGENTS\.md)/;
  const progressLead = /^(我来|我先|先看|现在|接下来|下一步|继续|语法 OK|验证通过|已掌握|找到原因|我需要|我把|正在|准备|确认一下|再看|先确认|现在改|现在重启|最后|噪音规则|可以，而且)/;
  if (progressLead.test(t) && t.length < 300) return true;
  if (!coreHint.test(t) && t.length < 260) return true;
  return false;
}
function isCoreFile(files) {
  return (files || []).some(f => {
    const s = String(f || '');
    if (!s || /^\(.*\)$/.test(s)) return false;
    if (/\$env:TEMP|\\Temp\\|\\tmp\\|\.log$|\.tmp$|\.bak$/i.test(s)) return false;
    return /tools\\daily-dashboard|AGENTS\.md|CLAUDE\.md|LEARNINGS\.md|\.agentMemory|\.js$|\.ts$|\.tsx$|\.json$|\.md$|\.ps1$|\.bat$/i.test(s);
  });
}function isCoreCommand(cmd) {
  const s = String(cmd || '').trim();
  if (!s) return false;
  if (FILE_OP_RE.test(s)) return true;
  if (/\b(npm|pnpm|yarn|node|npx|tsc|vitest|jest|cargo|pytest|python|git)\b/i.test(s) && !/Get-Content|Select-String|Invoke-WebRequest|netstat|Get-Process|Get-NetTCPConnection|ConvertFrom-Json/i.test(s)) return true;
  return false;
}
const FILE_OP_RE = /(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|apply_patch|\bgit\s+(?:apply|commit|checkout)\b|>>?\s|tee\b)/i;
const FILE_PATH_RE = /(?:-(?:Path|LiteralPath|Destination)\s+|Update File:\s*|Add File:\s*)["']?([A-Za-z]:\\[^"'\r\n]+|\/[^"'\r\n]+|[^\s"'<>|]+\.[A-Za-z0-9]{1,8})/g;
function extractFiles(cmd) {
  const out = [];
  let m;
  FILE_PATH_RE.lastIndex = 0;
  while ((m = FILE_PATH_RE.exec(cmd)) && out.length < 8) {
    let f = m[1];
    if (!f) continue;
    if (f.includes('$') || f.startsWith('-') || /\.git($|\\|\/)/.test(f)) continue; // 跳过变量/选项/.git
    if (!/\.[A-Za-z0-9]{1,8}$/.test(f) && !/[\\/]/.test(f)) continue; // 需像文件名或带路径
    if (out.indexOf(f) === -1) out.push(f);
  }
  return out;
}

function parseSession(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const s = {
    sessionId: path.basename(file),
    cwd: '', startedAt: null, lastActiveAt: null, cliVersion: '',
    userMsgs: [], assistantMsgs: [], commands: [], fileEdits: [],
  };
  for (const line of lines) {
    const o = safeJson(line);
    if (!o) continue;
    const p = o.payload || {};
    const ts = o.timestamp || p.timestamp;
    if (ts) s.lastActiveAt = ts;
    if (o.type === 'session_meta' || p.type === 'session_meta') {
      s.cwd = p.cwd || s.cwd;
      s.startedAt = p.timestamp || ts || s.startedAt;
      s.cliVersion = p.cli_version || s.cliVersion;
      continue;
    }
    if (p.type === 'message' && p.role === 'user') {
      let t = textFromContent(p.content);
      // 去掉 Codex 注入的 AGENTS.md 指令块，只保留用户真实提问
      if (/# AGENTS\.md instructions/.test(t)) {
        const idx = t.lastIndexOf('</environment_context>');
        if (idx !== -1) t = t.slice(idx + '</environment_context>'.length).trim();
      }
      const head = t.slice(0, 40);
      if (t && !isInjectedUserText(t) && !/INSTRUCTIONS|environment_context|<user_instructions>/.test(head)) s.userMsgs.push({ ts, text: t, core: true });
    } else if (p.type === 'message' && p.role === 'assistant') {
      const t = textFromContent(p.content);
      if (t) s.assistantMsgs.push({ ts, text: t, core: !isAssistantProgress(t) });
    } else if (p.type === 'function_call') {
      const name = p.name || '';
      let args = p.arguments; if (typeof args === 'string') { const a = safeJson(args); if (a) args = a; }
      if (name === 'apply_patch' || /^(?:patch|edit|write_file)$/i.test(name)) {
        const inp = args && (args.input || args.patch || '');
        const files = [];
        String(inp).split(/\r?\n/).forEach(l => { const m = l.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/); if (m) files.push(m[1].trim()); });
        s.fileEdits.push({ ts, files: files.length ? files : ['(patch)'], core: true });
      } else if (name === 'shell' || /shell|command|exec/i.test(name)) {
        let cmd = args && (args.command || '');
        if (Array.isArray(cmd)) cmd = cmd.join(' ');
        cmd = cmd || (args ? JSON.stringify(args).slice(0, 200) : '');
        s.commands.push({ ts, name, cmd, core: isCoreCommand(cmd) });
        if (FILE_OP_RE.test(cmd)) {
          const files = extractFiles(cmd);
          s.fileEdits.push({ ts, files: files.length ? files : ['(文件操作)'], core: isCoreFile(files) });
        }
      }
    }
  }
  if (!s.startedAt && lines.length) { const fo = safeJson(lines[0]); s.startedAt = fo && fo.timestamp; }
  if (!s.lastActiveAt) { try { s.lastActiveAt = fs.statSync(file).mtime.toISOString(); } catch {} }
  return s;
}

function dayKey(iso) {
  if (!iso) return '未知日期';
  const d = new Date(iso);
  if (isNaN(d)) return '未知日期';
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function projName(cwd) { if (!cwd) return '(无项目)'; return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd; }

function buildData() {
  const files = walk(SESS_DIR, []);
  const sessions = files.map(parseSession).filter(Boolean);
  const days = {};
  for (const s of sessions) {
    const k = dayKey(s.lastActiveAt || s.startedAt);
    if (!days[k]) days[k] = { date: k, sessions: 0, userMsgs: 0, assistantMsgs: 0, commands: 0, fileEdits: 0, projects: {}, items: [] };
    const d = days[k];
    const coreCounts = {
      user: s.userMsgs.filter(x => x.core).length,
      assistant: s.assistantMsgs.filter(x => x.core).length,
      commands: s.commands.filter(x => x.core).length,
      fileEdits: s.fileEdits.filter(e => e.core).reduce((a, e) => a + e.files.length, 0),
    };
    const rawCounts = {
      user: s.userMsgs.length,
      assistant: s.assistantMsgs.length,
      commands: s.commands.length,
      fileEdits: s.fileEdits.reduce((a, e) => a + e.files.length, 0),
    };
    d.sessions++;
    d.userMsgs += coreCounts.user;
    d.assistantMsgs += coreCounts.assistant;
    d.commands += coreCounts.commands;
    d.fileEdits += coreCounts.fileEdits;
    const pn = projName(s.cwd); d.projects[pn] = (d.projects[pn] || 0) + 1;
    d.items.push({
      sessionId: s.sessionId,
      project: pn,
      startedAt: s.startedAt,
      lastActiveAt: s.lastActiveAt,
      counts: coreCounts,
      rawCounts,
      firstAsk: s.userMsgs[0] ? s.userMsgs[0].text.slice(0, 120) : '',
      detail: {
        userMsgs: s.userMsgs.slice(0, 30),
        assistantMsgs: s.assistantMsgs.slice(0, 30),
        commands: s.commands.slice(0, 60),
        fileEdits: s.fileEdits.slice(0, 60),
      }
    });
  }
  const dayList = Object.values(days).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const d of dayList) d.items.sort((a, b) => ((a.lastActiveAt || a.startedAt) < (b.lastActiveAt || b.startedAt) ? 1 : -1));
  const totals = dayList.reduce((t, d) => { t.sessions += d.sessions; t.userMsgs += d.userMsgs; t.assistantMsgs += d.assistantMsgs; t.commands += d.commands; t.fileEdits += d.fileEdits; return t; }, { sessions: 0, userMsgs: 0, assistantMsgs: 0, commands: 0, fileEdits: 0 });
  const projCount = {};
  for (const d of dayList) for (const it of d.items) projCount[it.project] = (projCount[it.project] || 0) + 1;
  const projects = Object.entries(projCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return { generatedAt: new Date().toISOString(), sessionFiles: files.length, totals, projects, days: dayList };
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Codex 每日产出看板</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;background:#1e1e1e;color:#ddd;padding:24px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
h1{font-size:24px}.sub{opacity:.6;font-size:13px;margin-top:4px}
.btn{background:#0e639c;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer}
.btn:hover{background:#1177bb}
.ctrl{display:flex;gap:10px;align-items:center}
.sel{background:#2d2d30;color:#ddd;border:1px solid #3e3e42;border-radius:6px;padding:8px 10px;font-size:13px;cursor:pointer}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px}
.card{background:#2d2d30;border:1px solid #3e3e42;border-radius:10px;padding:16px}
.card .l{font-size:12px;opacity:.6}.card .v{font-size:28px;font-weight:700;margin-top:6px}
.day{background:#252526;border:1px solid #3e3e42;border-radius:10px;margin-bottom:16px;overflow:hidden}
.day-hd{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;background:#2d2d30}
.day-hd:hover{background:#333}
.day-date{font-size:17px;font-weight:600}
.badges span{display:inline-block;background:#3a3d41;border-radius:12px;padding:2px 10px;font-size:12px;margin-left:6px}
.day-body{display:none;padding:8px 18px 18px}
.day.open .day-body{display:block}
.sess{border-left:3px solid #0e639c;background:#2a2a2c;border-radius:6px;padding:10px 14px;margin-top:10px;cursor:pointer}
.sess:hover{background:#323234}
.sess-top{display:flex;justify-content:space-between;font-size:13px}
.proj{color:#4ec9b0;font-weight:600}.time{opacity:.5}
.ask{opacity:.75;font-size:13px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mini span{font-size:12px;margin-right:12px;opacity:.7}
.detail{display:none;margin-top:10px;border-top:1px solid #3e3e42;padding-top:10px}
.sess.open .detail{display:block}
.sec{margin:10px 0}.sec h4{font-size:13px;color:#9cdcfe;margin-bottom:6px}
.line{font-size:12.5px;padding:6px 8px;border-radius:4px;background:#1e1e1e;margin-bottom:4px;white-space:pre-wrap;word-break:break-word}
.cmd{font-family:Consolas,monospace;color:#ce9178}
.file{color:#dcdcaa}
.empty{opacity:.4;text-align:center;padding:50px}
</style></head><body>
<div class="header"><div><h1>🧠 Codex 每日产出看板</h1><div class="sub" id="sub">加载中…</div></div><div class="ctrl"><select class="sel" id="modeSel" onchange="render()"><option value="core">核心内容</option><option value="all">全部记录</option></select><select class="sel" id="projSel" onchange="render()"><option value="__all__">全部项目</option></select><button class="btn" onclick="load()">🔄 刷新</button></div></div>
<div class="cards" id="cards"></div>
<div id="days"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function fmtTime(iso){if(!iso)return '';const d=new Date(iso);return isNaN(d)?'':d.toLocaleString('zh-CN');}
function fmtT(iso){if(!iso)return '';const d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString('zh-CN');}
function mode(){return (document.getElementById('modeSel')||{}).value||'core';}
function countOf(it){return mode()==='all'?(it.rawCounts||it.counts):it.counts;}
function visible(list){return mode()==='all'?list:list.filter(x=>x.core!==false);}
let DATA=null;
async function load(){
  const r=await fetch('/api/data');DATA=await r.json();
  if(DATA.error){document.getElementById('days').innerHTML='<div class="empty">读取失败：'+esc(DATA.error)+'</div>';return;}
  const sel=document.getElementById('projSel');const cur=sel.value;
  const opts=['<option value="__all__">全部项目</option>'].concat((DATA.projects||[]).map(p=>'<option value="'+esc(p.name)+'">'+esc(p.name)+'（'+p.count+'）</option>'));
  sel.innerHTML=opts.join('');
  if(cur&&[...sel.options].some(o=>o.value===cur))sel.value=cur;
  render();
}
function aggregate(days){
  return days.reduce((t,d)=>{t.sessions+=d.sessions;t.userMsgs+=d.userMsgs;t.assistantMsgs+=d.assistantMsgs;t.commands+=d.commands;t.fileEdits+=d.fileEdits;return t;},{sessions:0,userMsgs:0,assistantMsgs:0,commands:0,fileEdits:0});
}
function filterDay(d,proj){
  const items=proj==='__all__'?d.items:d.items.filter(it=>it.project===proj);
  if(!items.length)return null;
  const projects={};items.forEach(it=>projects[it.project]=(projects[it.project]||0)+1);
  return {date:d.date,items,projects,sessions:items.length,
    userMsgs:items.reduce((a,it)=>a+countOf(it).user,0),
    assistantMsgs:items.reduce((a,it)=>a+countOf(it).assistant,0),
    commands:items.reduce((a,it)=>a+countOf(it).commands,0),
    fileEdits:items.reduce((a,it)=>a+countOf(it).fileEdits,0)};
}
function render(){
  if(!DATA)return;
  const proj=document.getElementById('projSel').value;
  let days=DATA.days.map(d=>filterDay({date:d.date,items:d.items,projects:d.projects},'__all__')).filter(Boolean);
  if(proj&&proj!=='__all__')days=DATA.days.map(d=>filterDay(d,proj)).filter(Boolean);
  const t=aggregate(days);
  const tag=(proj&&proj!=='__all__')?'（筛选：'+esc(proj)+'）':'';
  document.getElementById('sub').textContent='生成于 '+fmtTime(DATA.generatedAt)+' · 会话文件 '+DATA.sessionFiles+' 个 · 数据源 ~/.codex/sessions'+tag;
  const cards=[['会话总数',t.sessions],['我的提问',t.userMsgs],['Codex 回复',t.assistantMsgs],['命令执行',t.commands],['文件修改',t.fileEdits]];
  document.getElementById('cards').innerHTML=cards.map(c=>'<div class="card"><div class="l">'+c[0]+'</div><div class="v">'+c[1]+'</div></div>').join('');
  if(!days.length){document.getElementById('days').innerHTML='<div class="empty">该项目暂无产出记录</div>';return;}
  document.getElementById('days').innerHTML=days.map(renderDay).join('');
}
function renderDay(d){
  const projs=Object.entries(d.projects).map(([k,v])=>esc(k)+'×'+v).join('、');
  const badges='<span>会话 '+d.sessions+'</span><span>提问 '+d.userMsgs+'</span><span>回复 '+d.assistantMsgs+'</span><span>命令 '+d.commands+'</span><span>改文件 '+d.fileEdits+'</span>';
  const sess=d.items.map(renderSess).join('');
  return '<div class="day"><div class="day-hd" onclick="this.parentNode.classList.toggle(\\'open\\')"><div><span class="day-date">'+esc(d.date)+'</span> <span style="opacity:.5;font-size:12px">'+projs+'</span></div><div class="badges">'+badges+'</div></div><div class="day-body">'+sess+'</div></div>';
}
function renderSess(it){
  const c=countOf(it);
  const mini='<div class="mini"><span>🗨️ 提问 '+c.user+'</span><span>💬 回复 '+c.assistant+'</span><span>⌨️ 命令 '+c.commands+'</span><span>📝 改文件 '+c.fileEdits+'</span><span>开始 '+fmtTime(it.startedAt)+'</span></div>';
  return '<div class="sess" onclick="this.classList.toggle(\\'open\\')"><div class="sess-top"><span class="proj">📁 '+esc(it.project)+'</span><span class="time">最近 '+fmtTime(it.lastActiveAt||it.startedAt)+'</span></div><div class="ask">'+esc(it.firstAsk||'(无提问文本)')+'</div>'+mini+renderDetail(it.detail)+'</div>';
}
function renderDetail(dt){
  let h='<div class="detail">';
  const u=visible(dt.userMsgs),a=visible(dt.assistantMsgs),cmd=visible(dt.commands),fe=visible(dt.fileEdits);
  if(u.length){h+='<div class="sec"><h4>🗨️ 我的提问</h4>'+u.map(m=>'<div class="line">['+fmtT(m.ts)+'] '+esc(m.text.slice(0,500))+'</div>').join('')+'</div>';}
  if(a.length){h+='<div class="sec"><h4>💬 Codex 回复</h4>'+a.map(m=>'<div class="line">['+fmtT(m.ts)+'] '+esc(m.text.slice(0,800))+'</div>').join('')+'</div>';}
  if(cmd.length){h+='<div class="sec"><h4>⌨️ 命令执行</h4>'+cmd.map(m=>'<div class="line cmd">['+fmtT(m.ts)+'] '+esc(m.cmd.slice(0,300))+'</div>').join('')+'</div>';}
  if(fe.length){h+='<div class="sec"><h4>📝 文件修改</h4>'+fe.map(m=>'<div class="line file">['+fmtT(m.ts)+'] '+esc(m.files.join('、'))+'</div>').join('')+'</div>';}
  h+='</div>';return h;
}
load();
setInterval(load,60000);
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/api/data') {
    try {
      const data = buildData();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
server.listen(PORT, () => {
  console.log(`[每日产出看板] http://localhost:${PORT}`);
  console.log(`[数据源] ${SESS_DIR}`);
});
