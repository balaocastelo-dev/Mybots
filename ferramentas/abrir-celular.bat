@echo off
REM Tela do celular (scrcpy). Audio desligado: no POCO Android 14 o encoder
REM de audio derruba a sessao. MYBOTS_SCRCPY_AUDIO=1 liga o audio.
REM MYBOTS_SCRCPY_VIDEO_CODEC=h264 escolhe o codec. MYBOTS_SCRCPY_FALLBACK=0
REM nao tenta H.264 sozinho se a primeira abertura cair.
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 goto direto
node --import tsx "%~dp0..\scripts\abrir-celular.ts"
exit /b %errorlevel%

:direto
set ADB=%~dp0scrcpy\adb.exe
if not exist "%ADB%" set ADB=C:\android\sdk\platform-tools\adb.exe
set SERIAL=%MYBOTS_CELULAR_SERIAL%
if "%SERIAL%"=="" set SERIAL=192.168.15.4:5555
"%ADB%" connect %SERIAL% >nul 2>&1
set AUDIO=--no-audio
if /I "%MYBOTS_SCRCPY_AUDIO%"=="1" set AUDIO=
if /I "%MYBOTS_SCRCPY_AUDIO%"=="sim" set AUDIO=
set CODEC=
if not "%MYBOTS_SCRCPY_VIDEO_CODEC%"=="" set CODEC=--video-codec=%MYBOTS_SCRCPY_VIDEO_CODEC%
"%~dp0scrcpy\scrcpy.exe" --serial=%SERIAL% --window-title="Celular da Loja" --max-size=1080 --video-bit-rate=8M --max-fps=60 --stay-awake --turn-screen-off %AUDIO% %CODEC%
if not errorlevel 1 exit /b 0
if /I "%MYBOTS_SCRCPY_FALLBACK%"=="0" exit /b 1
if not "%CODEC%"=="" exit /b 1
echo [celular] a captura caiu; abrindo de novo sem audio e em H.264
"%~dp0scrcpy\scrcpy.exe" --serial=%SERIAL% --window-title="Celular da Loja" --max-size=1080 --video-bit-rate=8M --max-fps=60 --stay-awake --turn-screen-off --no-audio --video-codec=h264
exit /b %errorlevel%
