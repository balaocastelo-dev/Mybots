# Registra tarefa agendada para subir Hub+tunel no logon (usuario atual).
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $raiz) { $raiz = Get-Location }
$cmd = Join-Path $raiz "start-mybots-online.cmd"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"" -WorkingDirectory $raiz
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "MyBots Hub Online" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "TASK_OK MyBots Hub Online"
# Power: already AC sleep 0 ideally
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
Write-Host "POWER_AC_SLEEP_0"