Set sh = CreateObject("WScript.Shell")
alvo = Replace(WScript.ScriptFullName, "abrir-mybots.vbs", "abrir-mybots.ps1")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & alvo & """", 0, False
