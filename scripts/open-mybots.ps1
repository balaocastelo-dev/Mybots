# Abre o MyBots como app — mas UMA janela só.
# Se já existe uma janela com título "MyBots", só traz ela pra frente; senão abre o Chrome/Edge com --app.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-mybots.ps1 [-Url http://127.0.0.1:8790]
# (o atalho da Área de Trabalho chama este script via open-mybots.vbs para não piscar console)
param([string]$Url = "http://127.0.0.1:8790", [string]$Titulo = "MyBots", [string[]]$Arquivo)

# Arquivo arrastado para cima do atalho: manda para o Hub, que faz o painel perguntar
# a qual bot entregar. (Antes o Windows tentava EXECUTAR o arquivo e dava erro.)
function Enviar-ParaImportar([string]$caminho, [string]$url) {
  if (-not (Test-Path -LiteralPath $caminho -PathType Leaf)) { return }
  $nome = [IO.Path]::GetFileName($caminho)
  $tipo = switch ([IO.Path]::GetExtension($caminho).ToLower()) {
    ".md" { "text/markdown" } ".txt" { "text/plain" } ".json" { "application/json" }
    ".csv" { "text/csv" } ".pdf" { "application/pdf" } ".png" { "image/png" }
    ".jpg" { "image/jpeg" } ".jpeg" { "image/jpeg" } default { "application/octet-stream" }
  }
  try {
    $bytes = [IO.File]::ReadAllBytes($caminho)
    Invoke-RestMethod -Uri "$url/api/import" -Method Post -Body $bytes `
      -ContentType $tipo -Headers @{ "X-File-Name" = [uri]::EscapeDataString($nome) } -TimeoutSec 30 | Out-Null
  } catch {
    [void][Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
    [Windows.Forms.MessageBox]::Show("Não consegui enviar '$nome' para o MyBots.`n`nO Hub está rodando? ($url)`n`n$($_.Exception.Message)", "MyBots") | Out-Null
  }
}

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MyBotsWin {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  // Janela visível cujo título é exatamente "MyBots" (o Chrome --app usa o <title> da página).
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, lp) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() != title) return true;
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }
  public static void BringToFront(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    else ShowWindow(h, 5);             // SW_SHOW
    // SetForegroundWindow só funciona se a nossa thread "tem" o foco; emprestamos o da janela atual.
    uint fgPid; uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint me = GetCurrentThreadId();
    if (fgThread != me) AttachThreadInput(me, fgThread, true);
    SetForegroundWindow(h);
    if (fgThread != me) AttachThreadInput(me, fgThread, false);
  }
}
"@
if (-not ("MyBotsWin" -as [type])) { Add-Type -TypeDefinition $code -ErrorAction Stop }

$h = [MyBotsWin]::Find($Titulo)
if ($h -ne [IntPtr]::Zero) {
  [MyBotsWin]::BringToFront($h)
  if ($Arquivo) { foreach ($a in $Arquivo) { Enviar-ParaImportar $a $Url } }
  exit 0
}

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Start-Process $Url; exit 0 }

Start-Process -FilePath $browser -ArgumentList "--app=$Url", "--window-size=1280,860"

# Depois que a janela aparece, grava nela o AppUserModelID + ícone de relançamento (tarefa 3 do HANDOFF).
if ($Arquivo) {
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 400; if ([MyBotsWin]::Find($Titulo) -ne [IntPtr]::Zero) { break } }
  Start-Sleep -Seconds 2   # deixa o painel conectar no Hub antes de mandar
  foreach ($a in $Arquivo) { Enviar-ParaImportar $a $Url }
}

$fix = Join-Path $PSScriptRoot "set-window-icon.ps1"
if (Test-Path $fix) {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if ([MyBotsWin]::Find($Titulo) -ne [IntPtr]::Zero) { & $fix -Titulo $Titulo | Out-Null; break }
  }
}
