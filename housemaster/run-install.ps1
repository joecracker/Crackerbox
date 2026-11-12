# One command for "install the build I just made". Tim must have closed Crackerbox first and
# must have said yes to THIS install.
#   powershell -NoProfile -ExecutionPolicy Bypass -File housemaster\run-install.ps1
# Does: pause KeepAlive -> copy settings + database as a backup (never read) -> run install.ps1
# as a one-time scheduled task (current user, Interactive/Limited) -> print the result ->
# re-enable KeepAlive.
$ErrorActionPreference = "Continue"
$here = $PSScriptRoot
$logDir = Join-Path $env:USERPROFILE "Documents\cb-install"
New-Item -ItemType Directory -Force $logDir | Out-Null
$result = Join-Path $logDir "install-result.txt"
Remove-Item $result -ErrorAction SilentlyContinue

if (Get-Process Crackerbox -ErrorAction SilentlyContinue) { Write-Output "STOP: Crackerbox is still running. Ask Tim to close it."; exit 1 }

Disable-ScheduledTask -TaskName CrackerboxKeepAlive -ErrorAction SilentlyContinue | Out-Null
try {
  $stamp = Get-Date -Format "yyyyMMdd-HHmm"
  $bk = Join-Path $env:USERPROFILE "Documents\crackerbox-installer-backups\pre-install-$stamp"
  New-Item -ItemType Directory -Force $bk | Out-Null
  $data = Join-Path $env:APPDATA "Crackerbox"
  Copy-Item (Join-Path $data "user-settings.json") $bk -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $data "sqlite.db") $bk -ErrorAction SilentlyContinue
  Write-Output "backup: $bk"

  $user = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$here\install.ps1`""
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName CbOneTimeInstall -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName CbOneTimeInstall

  $deadline = (Get-Date).AddMinutes(6)
  while (-not (Test-Path $result) -and (Get-Date) -lt $deadline) { Start-Sleep 5 }
  if (Test-Path $result) { Get-Content $result } else { Write-Output "No result file after 6 minutes: check Task Scheduler." }
} finally {
  Unregister-ScheduledTask -TaskName CbOneTimeInstall -Confirm:$false -ErrorAction SilentlyContinue
  Enable-ScheduledTask -TaskName CrackerboxKeepAlive -ErrorAction SilentlyContinue | Out-Null
}
