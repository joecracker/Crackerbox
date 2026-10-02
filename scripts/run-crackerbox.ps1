$crackerboxRoot = Split-Path -Parent $PSScriptRoot
$crackerboxLogDirectory = Join-Path $crackerboxRoot "userData\launcher-logs"
New-Item -ItemType Directory -Path $crackerboxLogDirectory -Force | Out-Null
$crackerboxLog = Join-Path $crackerboxLogDirectory "launch-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID.log"

Set-Location -LiteralPath $crackerboxRoot
Set-Content -LiteralPath $crackerboxLog -Encoding utf8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Crackerbox launch requested"

$crackerboxElectron = Join-Path $crackerboxRoot "node_modules\electron\dist\electron.exe"
$runningWindow = Get-Process -Name electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $crackerboxElectron -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
  Select-Object -First 1

if ($runningWindow) {
  Add-Type -Namespace Crackerbox -Name Window -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
'@
  [Crackerbox.Window]::ShowWindowAsync($runningWindow.MainWindowHandle, 9) | Out-Null
  [Crackerbox.Window]::SetForegroundWindow($runningWindow.MainWindowHandle) | Out-Null
  Add-Content -LiteralPath $crackerboxLog -Encoding utf8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Focused existing Crackerbox window"
  return
}

# No window yet, but a previous click may still be starting up (takes ~2 min).
# Starting a second copy would fight the first over ports and files.
$alreadyStarting = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*start-supervisor.mjs*" } |
  Select-Object -First 1
$anyCrackerboxElectron = Get-Process -Name electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $crackerboxElectron } |
  Select-Object -First 1
if ($alreadyStarting -and -not $anyCrackerboxElectron) {
  Add-Content -LiteralPath $crackerboxLog -Encoding utf8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Crackerbox is already starting; not launching a second copy"
  return
}

& npm.cmd run dev 2>&1 | Out-File -LiteralPath $crackerboxLog -Append -Encoding utf8
Add-Content -LiteralPath $crackerboxLog -Encoding utf8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Crackerbox launcher exited with code $LASTEXITCODE"
