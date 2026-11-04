# Abre o MyBots: sobe o Hub se ele nao estiver no ar e entao abre o painel.
# Se o MyBots estiver instalado como app do Chrome/Edge, abre pelo app instalado:
# assim a barra de tarefas mostra o logo do MyBots, e nao o do navegador.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
if (-not (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process cmd.exe -ArgumentList "/c npm run hub > hub-saida.log 2>&1" -WorkingDirectory $raiz -WindowStyle Minimized
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) { break }
  }
}

function Achar-AppInstalado($dadosUsuario, $proxy) {
  if (-not (Test-Path $proxy)) { return $null }
  foreach ($perfil in Get-ChildItem $dadosUsuario -Directory -ErrorAction SilentlyContinue) {
    $apps = Join-Path $perfil.FullName "Web Applications"
    foreach ($pasta in Get-ChildItem $apps -Directory -Filter "_crx_*" -ErrorAction SilentlyContinue) {
      if (Get-ChildItem $pasta.FullName -Filter "MyBots*.ico" -ErrorAction SilentlyContinue) {
        return @{ Proxy = $proxy; Perfil = $perfil.Name; Id = $pasta.Name.Substring(5) }
      }
    }
  }
  return $null
}

$app = Achar-AppInstalado "$env:LOCALAPPDATA\Google\Chrome\User Data" "$env:ProgramFiles\Google\Chrome\Application\chrome_proxy.exe"
if (-not $app) { $app = Achar-AppInstalado "$env:LOCALAPPDATA\Microsoft\Edge\User Data" "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge_proxy.exe" }

if ($app) {
  Start-Process $app.Proxy -ArgumentList "--profile-directory=`"$($app.Perfil)`" --app-id=$($app.Id)"
} else {
  $nav = if (Get-Command msedge.exe -ErrorAction SilentlyContinue) { "msedge.exe" } else { "chrome.exe" }
  Start-Process $nav -ArgumentList "--app=http://127.0.0.1:8790"
}
