# Codex 每日产出看板 启动器（健壮版）
$ErrorActionPreference = 'SilentlyContinue'
$port = 3455
$url  = "http://localhost:$port"
$serverDir = $PSScriptRoot
if (-not $serverDir) { $serverDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$serverJs = Join-Path $serverDir 'server.js'

# 去重 PATH，避免 Start-Process 因重复 PATH 键报错
$env:Path = (($env:Path -split ';' | Where-Object { $_ } | Select-Object -Unique) -join ';')

# 找 node.exe（PATH 找不到时回退常见安装路径）
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { foreach ($c in @("$env:ProgramFiles\nodejs\node.exe","${env:ProgramFiles(x86)}\nodejs\node.exe","$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $c) { $node = $c; break } } }

# 若端口未监听则启动服务（隐藏窗口、后台常驻）
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    if ($node) {
        Start-Process -FilePath $node -ArgumentList @("`"$serverJs`"") -WorkingDirectory $serverDir -WindowStyle Hidden
    } else {
        [System.Windows.Forms.MessageBox]::Show("未找到 node.exe，请先安装 Node.js") | Out-Null
        return
    }
}

# 轮询等待服务真正可用（最多 ~10 秒）
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}

# 打开浏览器：多重兜底
if ($ok) {
    $opened = $false
    try { Start-Process $url; $opened = $true } catch {}
    if (-not $opened) {
        foreach ($b in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe","${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")) {
            if (Test-Path $b) { Start-Process -FilePath $b -ArgumentList $url; $opened = $true; break }
        }
    }
    if (-not $opened) { Start-Process explorer.exe $url }
}