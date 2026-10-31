@echo off
set ADB=C:\Users\user\Desktop\MyBots-Base\ferramentas\scrcpy\adb.exe
if not exist "%ADB%" set ADB=C:\android\sdk\platform-tools\adb.exe
"%ADB%" connect 192.168.15.4:5555 >nul 2>&1
"C:\Users\user\Desktop\MyBots-Base\ferramentas\scrcpy\scrcpy.exe" --serial=192.168.15.4:5555 --window-title="Celular da Loja" --max-size=1080 --video-bit-rate=8M --max-fps=60 --stay-awake --turn-screen-off
