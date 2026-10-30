# Abre o MyBots: sobe o Hub se ele nao estiver no ar e entao abre o painel.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
if (-not (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process cmd.exe -ArgumentList "/c npm run hub > hub-saida.log 2>&1" -WorkingDirectory $raiz -WindowStyle Minimized
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) { break }
  }
}
$nav = if (Get-Command msedge.exe -ErrorAction SilentlyContinue) { "msedge.exe" } else { "chrome.exe" }
Start-Process $nav -ArgumentList "--app=http://127.0.0.1:8790"
