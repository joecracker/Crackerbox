# Installs the newest built Crackerbox Setup.exe. Run by run-install.ps1 through a one-time
# scheduled task (the installer must not be started from the app being replaced).
# Precondition (checked): Crackerbox is NOT running. Tim closes it; KeepAlive is disabled.
# Writes %USERPROFILE%\Documents\cb-install\install-result.txt.
# Rollback: the working copy is parked (moved, not deleted) outside the app folder and put back
# unless the new copy is there AND its app.asar matches the build.
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:USERPROFILE "Documents\cb-install"
New-Item -ItemType Directory -Force $logDir | Out-Null
$res = Join-Path $logDir "install-result.txt"
$out = New-Object System.Collections.Generic.List[string]
$root = Join-Path $env:LOCALAPPDATA "dyad"
$keep = Join-Path $env:USERPROFILE "Documents\crackerbox-installer-backups\app-rollback"
$old = $null
$parked = $null
$rolledBack = $false

function Restore-OldCopy([string]$why) {
  if (-not $parked -or -not (Test-Path $parked)) { $out.Add("ROLLBACK NOT POSSIBLE ($why): no parked copy"); return }
  Get-Process Crackerbox -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
  if (Test-Path $old) { Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue }
  Move-Item $parked $old -Force
  $script:rolledBack = $true
  $out.Add("ROLLED BACK ($why): the previous version is back at $old")
}

try {
  $make = Join-Path $repo "out\make\squirrel.windows\x64"
  $setup = Get-ChildItem $make -Filter "*Setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $out.Add("setup: $($setup.Name) built $($setup.LastWriteTime)")
  $buildAsar = Join-Path $repo "out\Crackerbox-win32-x64\resources\app.asar"
  $buildHash = (Get-FileHash $buildAsar).Hash
  $out.Add("build asar: " + $buildHash.Substring(0, 12))

  if (Get-Process Crackerbox -ErrorAction SilentlyContinue) {
    $out.Add("ABORT: Crackerbox is running"); $out | Set-Content $res; exit 1
  }

  # Setup.exe for the SAME version skips replacing files, so the old version folder has to be
  # out of the way first. Park it (keep exactly one rollback copy) instead of deleting it.
  $version = (Get-Content (Join-Path $repo "package.json") | ConvertFrom-Json).version  # e.g. 1.17.0-beta.5
  $folder = "app-" + ($version -replace '-beta\.', '-beta')                               # app-1.17.0-beta5
  $old = Join-Path $root $folder
  if (Test-Path $old) {
    if (Test-Path $keep) { Remove-Item $keep -Recurse -Force }
    New-Item -ItemType Directory -Force $keep | Out-Null
    $parked = Join-Path $keep $folder
    Move-Item $old $parked -Force
    $out.Add("parked old copy at $parked")
  }

  $out.Add("install start $(Get-Date -Format HH:mm:ss)")
  $p = Start-Process -FilePath $setup.FullName -PassThru
  [void]$p.WaitForExit(240000)
  Start-Sleep 15
  $new = Join-Path $old "resources\app.asar"
  if (Test-Path $new) {
    $h = (Get-FileHash $new).Hash
    $out.Add("installed asar: " + $h.Substring(0, 12) + "  " + (Get-Item $new).LastWriteTime)
    if ($h -eq $buildHash) { $out.Add("HASH MATCH") } else { $out.Add("HASH MISMATCH"); Restore-OldCopy "installed app.asar does not match the build" }
  } else {
    $out.Add("INSTALLED asar missing at $new")
    Restore-OldCopy "the new app was not installed"
  }
  $proc = Get-Process Crackerbox -ErrorAction SilentlyContinue | Select-Object -First 1
  $out.Add("running: " + $proc.Path)
} catch {
  $out.Add("ERROR: $($_.Exception.Message)")
  if ($parked -and -not $rolledBack) { Restore-OldCopy "the install hit an error" }
}
$out.Add("done $(Get-Date -Format HH:mm:ss)")
$out | Set-Content $res
