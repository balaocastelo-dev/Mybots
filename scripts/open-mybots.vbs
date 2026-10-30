' Abre o MyBots (uma janela só) sem piscar a janela do console.
' O atalho MyBots.lnk aponta para:  wscript.exe //B "...\scripts\open-mybots.vbs"
' Arrastar arquivos para cima do atalho funciona: eles chegam aqui como argumentos
' e vão para o MyBots, que pergunta a qual bot entregar.
Dim fso, sh, ps1, args, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
ps1 = fso.GetParentFolderName(WScript.ScriptFullName) & "\open-mybots.ps1"
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " -Arquivo """ & WScript.Arguments(i) & """"
Next
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """" & args, 0, False
