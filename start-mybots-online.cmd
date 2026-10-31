@echo off
rem Sobe Hub (se preciso) + tunel Cloudflare rapido para a porta 8790.
setlocal
cd /d "%~dp0"
set CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe
if not exist "%CF%" (
  echo cloudflared nao encontrado em %CF%
  exit /b 1
)

rem Hub
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 8790 -State Listen -EA SilentlyContinue)) { Start-Process cmd.exe -ArgumentList '/c npm run hub > hub-saida.log 2>&1' -WorkingDirectory '%cd%' -WindowStyle Minimized; $ok=$false; for($i=0;$i -lt 45;$i++){ Start-Sleep 1; if(Get-NetTCPConnection -LocalPort 8790 -State Listen -EA SilentlyContinue){$ok=$true;break}}; if(-not $ok){exit 1} }"
if errorlevel 1 (
  echo Hub nao subiu na 8790
  exit /b 1
)

rem Mata tunel anterior deste PC
taskkill /IM cloudflared.exe /F >nul 2>&1

"%CF%" tunnel --url http://127.0.0.1:8790 --no-autoupdate > tunnel-saida.log 2> tunnel-saida.err.log