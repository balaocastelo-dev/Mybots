# Mantem Hub 8790 + tunel Cloudflare no ar sem matar tunel saudavel.
# Nao mexe em 8787/8791 nem no cloudflared do Herrera (3434).
$ErrorActionPreference = 'Continue'
$raiz = 'C:\Users\user\Desktop\MyBots-Base'
$cf = Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'
$outLog = Join-Path $raiz 'tunnel-saida.log'
$errLog = Join-Path $raiz 'tunnel-saida.err.log'
$urlFile = Join-Path $raiz 'tunnel-url.txt'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
function Log([string]$m) { Add-Content -Path (Join-Path $raiz 'watchdog-online.log') -Value "[$stamp] $m" }

function Get-HubCloudflared {
  Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '127\.0\.0\.1:8790' -or $_.CommandLine -match 'localhost:8790' }
}

$hubUp = [bool](Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)
if (-not $hubUp) {
  Log 'HUB_DOWN starting'
  Start-Process cmd.exe -ArgumentList '/c npm run hub > hub-saida.log 2>&1' -WorkingDirectory $raiz -WindowStyle Minimized
  for ($i=0; $i -lt 45; $i++) {
    Start-Sleep 1
    if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) { $hubUp = $true; break }
  }
  Log ("HUB_AFTER=" + $hubUp)
} else {
  Log 'HUB_OK'
}

$cfProc = @(Get-HubCloudflared)
$needTunnel = ($cfProc.Count -eq 0)
# Se o processo existe mas a URL antiga nao responde, reinicia so o tunel do Hub
$urlProbe = $null
if (Test-Path $urlFile) { $urlProbe = (Get-Content $urlFile -Raw).Trim() }
if (-not $needTunnel -and $urlProbe) {
  try {
    $code = & curl.exe -sS -o NUL -w '%{http_code}' --max-time 8 "$urlProbe/api/health"
    if ($code -ne '200') {
      Log ("TUNNEL_STALE http=$code killing hub cloudflared")
      $cfProc | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      $needTunnel = $true
    }
  } catch {
    Log ("TUNNEL_PROBE_FAIL " + $_.Exception.Message)
    $cfProc | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $needTunnel = $true
  }
}

if (-not $needTunnel) {
  Log ('TUNNEL_PROC=' + (($cfProc | Select-Object -ExpandProperty ProcessId) -join ','))
} else {
  Log 'TUNNEL_DOWN starting'
  if (-not (Test-Path $cf)) { Log 'NO_CLOUDFLARED'; exit 2 }
  if (Test-Path $outLog) { Remove-Item $outLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path $errLog) { Remove-Item $errLog -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath $cf -ArgumentList 'tunnel','--url','http://127.0.0.1:8790','--no-autoupdate' -WorkingDirectory $raiz -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden
  Start-Sleep 3
}

$url = $null
for ($i=0; $i -lt 25; $i++) {
  foreach ($f in @($errLog,$outLog)) {
    if (Test-Path $f) {
      $txt = Get-Content $f -Raw -ErrorAction SilentlyContinue
      if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $Matches[0]; break }
    }
  }
  if ($url) { break }
  Start-Sleep 1
}
if ($url) {
  $prev = ''
  if (Test-Path $urlFile) { $prev = (Get-Content $urlFile -Raw).Trim() }
  Set-Content -Path $urlFile -Value $url -Encoding utf8
  $changed = ($prev -and ($prev -ne $url))
  if ($changed) {
    Log ("URL_CHANGED prev=$prev new=$url")
    Set-Content -Path (Join-Path $raiz 'tunnel-url-changed.flag') -Value $url -Encoding utf8
  } else {
    Log ("URL_OK=$url")
  }
  if ($changed -or (Test-Path (Join-Path $raiz 'tunnel-url-changed.flag'))) {
    try {
      $node = (Get-Command node -ErrorAction Stop).Source
      & $node (Join-Path $raiz 'scripts\sync-tunnel-to-vercel.mjs') $url 2>&1 | ForEach-Object { Log $_ }
    } catch {
      Log ("SYNC_FAIL=" + $_.Exception.Message)
    }
  }
} else {
  Log 'URL_MISSING'
}

# Keep bots running
try {
  $node = (Get-Command node -ErrorAction Stop).Source
  & $node (Join-Path $raiz 'scripts\keep-bots.mjs') | ForEach-Object { Log $_ }
} catch {
  Log ("BOTS_KEEP_FAIL=" + $_.Exception.Message)
}
