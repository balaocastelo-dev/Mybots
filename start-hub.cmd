@echo off
rem O Hub fica em packages\hub, ao lado deste script — vale em Desktop\MyBots-Base
rem ou em qualquer outro lugar onde o projeto esteja clonado.
title MyBots Hub
cd /d "%~dp0packages\hub" || (
  echo Nao encontrei o Hub em "%~dp0packages\hub".
  echo Deixe o start-hub.cmd na raiz do projeto, ao lado da pasta packages.
  pause
  exit /b 1
)
node --import tsx src\index.ts
pause
