# MyBots · instala o Hub neste PC (o PC principal, onde fica a interface).
# Uso (PowerShell, na pasta do repositório):  Set-ExecutionPolicy -Scope Process Bypass; .\scripts\install-hub.ps1
param(
  [int]$Porta = 8790,
  [string]$Nome = "o chefe",
  [switch]$AutoStart   # cria uma tarefa agendada para subir o Hub no logon
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
function Passo($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

Passo "1/5 Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:ProgramFiles\nodejs"
}
node -v

Passo "2/5 Dependências"
Set-Location $root
npm install --no-audit --no-fund | Out-Null
# npm 12+ bloqueia scripts de instalação de dependências até serem aprovados (better-sqlite3 precisa)
try { npm install-scripts approve better-sqlite3 esbuild 2>$null | Out-Null; npm rebuild better-sqlite3 esbuild 2>$null | Out-Null } catch {}

Passo "3/5 Interface"
npm run build:ui | Out-Null

Passo "4/5 Configuração (.env)"
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  $token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  @"
MYBOTS_HUB_PORT=$Porta
MYBOTS_HUB_TOKEN=$token
MYBOTS_UI_PASSWORD=
MYBOTS_USER_NAME=$Nome
"@ | Set-Content $envFile -Encoding ASCII
  Write-Host "Token dos nós gerado: $token  (está em .env — use o mesmo nos PCs dos bots)" -ForegroundColor Yellow
} else { Write-Host ".env já existe; mantido." }
@"
@echo off
cd /d "$root\packages\hub"
title MyBots Hub
node --import tsx src\index.ts
pause
"@ | Set-Content (Join-Path $root "start-hub.cmd") -Encoding Default
try { netsh advfirewall firewall add rule name="MyBots Hub $Porta" dir=in action=allow protocol=TCP localport=$Porta | Out-Null; Write-Host "Firewall: porta $Porta liberada." } catch { Write-Host "Não consegui liberar a porta no firewall (rode como administrador se os outros PCs não enxergarem o Hub)." -ForegroundColor DarkYellow }

Passo "5/5 Pronto"
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress
if ($AutoStart) {
  schtasks /Create /F /SC ONLOGON /TN "MyBots Hub" /TR "`"$root\start-hub.cmd`"" | Out-Null
  Write-Host "Tarefa agendada 'MyBots Hub' criada (sobe no logon)."
}
Write-Host "Para iniciar: $root\start-hub.cmd" -ForegroundColor Green
Write-Host "Interface:    http://$ip`:$Porta   (no celular, na mesma rede)" -ForegroundColor Green
Write-Host "Nos PCs dos bots use:  -Hub ws://$ip`:$Porta  e o token do .env" -ForegroundColor Green
