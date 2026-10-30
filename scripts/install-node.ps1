# MyBots · instala um Bot neste PC (um nó).
# Exemplos (PowerShell, na pasta do repositório):
#   Modelo grátis do OpenCode:
#     .\scripts\install-node.ps1 -Bot joao-videomaker -Nome "João Videomaker" -Funcao "Videomaker da empresa" -Hub ws://192.168.0.10:8790 -Token XXXX
#   Gemini direto:   -Engine direct -Provider gemini    -Modelo gemini-2.5-flash  -ApiKey AIza...
#   Claude direto:   -Engine direct -Provider anthropic -Modelo claude-sonnet-5-5 -ApiKey sk-ant-...
#   Nous Portal:     -Engine direct -Provider nous      -Modelo stepfun/step-3.7-flash:free -ApiKey ...
#   Ollama na 4090:  -Engine direct -Provider ollama    -Modelo qwen3:30b -BaseUrl http://192.168.0.50:11434/v1
#   Gemini dentro do OpenCode:  -Engine opencode -Provider gemini -Modelo gemini-2.5-flash -ApiKey AIza...
param(
  [Parameter(Mandatory = $true)][string]$Bot,
  [string]$Nome = $Bot,
  [string]$Funcao = "Assistente da empresa",
  [string]$Avatar = "🤖",
  [string]$Hub = "ws://192.168.0.10:8790",
  [Parameter(Mandatory = $true)][string]$Token,
  [ValidateSet("direct", "opencode")][string]$Engine = "opencode",
  [string]$Provider = "opencode",
  [string]$Modelo = "big-pickle",
  [string]$ApiKey = "",
  [string]$BaseUrl = "",
  [int]$PortaOpenCode = 4096,
  [switch]$AutoStart
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
function Passo($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

Passo "1/5 Node.js e dependências"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:ProgramFiles\nodejs"
}
node -v
Set-Location $root
if (-not (Test-Path (Join-Path $root "node_modules"))) { npm install --no-audit --no-fund | Out-Null }
# npm 12+ bloqueia scripts de instalação de dependências até serem aprovados
try { npm install-scripts approve better-sqlite3 esbuild 2>$null | Out-Null; npm rebuild better-sqlite3 esbuild 2>$null | Out-Null } catch {}

Passo "2/5 OpenCode"
if ($Engine -eq "opencode" -and -not (Get-Command opencode -ErrorAction SilentlyContinue)) {
  npm install -g opencode-ai | Out-Null
}
if ($Engine -eq "opencode") {
  # npm 12 não roda o postinstall do opencode-ai: o bin fica com um placeholder de 479 bytes
  $ocDir = Join-Path $env:APPDATA "npm\node_modules\opencode-ai"
  $stub = Join-Path $ocDir "bin\opencode.exe"; $real = Join-Path $ocDir "node_modules\opencode-windows-x64\bin\opencode.exe"
  if ((Test-Path $stub) -and (Test-Path $real) -and ((Get-Item $stub).Length -lt 10000)) { Copy-Item $real $stub -Force }
  opencode --version
}

Passo "3/5 Pasta do bot"
$dir = Join-Path $root "bots\$Bot"
New-Item -ItemType Directory -Force -Path $dir, "$dir\workspace" | Out-Null
$prov = [ordered]@{ kind = $Provider; model = $Modelo }
if ($BaseUrl) { $prov["baseURL"] = $BaseUrl }
$cfg = [ordered]@{
  hub = $Hub; token = $Token
  bot = [ordered]@{ id = $Bot; name = $Nome; role = $Funcao; avatar = $Avatar }
  engine = $Engine; workspace = "./workspace"; personaFile = "./persona.md"
  provider = $prov
  opencode = [ordered]@{ port = $PortaOpenCode; spawn = $true; manageConfig = $true }
}
$cfg | ConvertTo-Json -Depth 5 | Set-Content "$dir\mybots-node.json" -Encoding UTF8
if (-not (Test-Path "$dir\persona.md")) {
  (Get-Content (Join-Path $root "examples\persona.md") -Raw) -replace "João Videomaker", $Nome -replace "o videomaker da equipe", "$Funcao da equipe" | Set-Content "$dir\persona.md" -Encoding UTF8
}

Passo "4/5 Segredos (.env do bot)"
$senhaOc = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$lines = @("MYBOTS_NODE_TOKEN=$Token", "OPENCODE_SERVER_PASSWORD=$senhaOc")
$keyVar = switch ($Provider) { "gemini" { "GEMINI_API_KEY" } "anthropic" { "ANTHROPIC_API_KEY" } "claude" { "ANTHROPIC_API_KEY" } "nous" { "NOUS_API_KEY" } "openrouter" { "OPENROUTER_API_KEY" } "opencode-zen" { "OPENCODE_API_KEY" } default { "MYBOTS_API_KEY" } }
if ($ApiKey) { $lines += "$keyVar=$ApiKey" }
$lines | Set-Content "$dir\.env" -Encoding ASCII
@"
@echo off
cd /d "$root\packages\node"
title MyBots - $Nome
node --import tsx src\index.ts "$dir\mybots-node.json"
pause
"@ | Set-Content "$dir\start-bot.cmd" -Encoding Default

Passo "5/5 Pronto"
if ($AutoStart) {
  schtasks /Create /F /SC ONLOGON /TN "MyBots Bot $Bot" /TR "`"$dir\start-bot.cmd`"" | Out-Null
  Write-Host "Tarefa agendada criada (sobe no logon)."
}
Write-Host "Bot '$Nome' configurado em $dir" -ForegroundColor Green
Write-Host "Persona (edite à vontade): $dir\persona.md"
Write-Host "Para iniciar: $dir\start-bot.cmd" -ForegroundColor Green
if ($Engine -eq "opencode" -and $Provider -eq "opencode") {
  Write-Host "Modelo grátis do OpenCode. Se a primeira resposta reclamar de login: cd $dir\workspace; opencode; /connect (OpenCode); /models" -ForegroundColor DarkYellow
}
