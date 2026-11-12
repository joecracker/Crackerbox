# Installs the newest built Crackerbox Setup.exe. Run by run-install.ps1 through a one-time
# scheduled task (the installer must not be started from the app being replaced).
# Precondition (checked): Crackerbox is NOT running. Tim closes it; KeepAlive is disabled.
# Writes %USERPROFILE%\Documents\cb-install\install-result.txt.
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:USERPROFILE "Documents\cb-install"
New-Item -ItemType Directory -Force $logDir | Out-Null
$res = Join-Path $logDir "install-result.txt"
$out = New-Object System.Collections.Generic.List[string]
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

  # Setup.exe for the SAME version skips replacing files, so remove the old version folder first.
  $version = (Get-Content (Join-Path $repo "package.json") | ConvertFrom-Json).version  # e.g. 1.17.0-beta.5
  $folder = "app-" + ($version -replace '-beta\.', '-beta')                               # app-1.17.0-beta5
  $root = Join-Path $env:LOCALAPPDATA "dyad"
  $old = Join-Path $root $folder
  if (Test-Path $old) { Remove-Item $old -Recurse -Force; $out.Add("removed old $old") }

  $out.Add("install start $(Get-Date -Format HH:mm:ss)")
  $p = Start-Process -FilePath $setup.FullName -PassThru
  [void]$p.WaitForExit(240000)
  Start-Sleep 15
  $new = Join-Path $old "resources\app.asar"
  if (Test-Path $new) {
    $h = (Get-FileHash $new).Hash
    $out.Add("installed asar: " + $h.Substring(0, 12) + "  " + (Get-Item $new).LastWriteTime)
    $out.Add($(if ($h -eq $buildHash) { "HASH MATCH" } else { "HASH MISMATCH" }))
  } else { $out.Add("INSTALLED asar missing at $new") }
  $proc = Get-Process Crackerbox -ErrorAction SilentlyContinue | Select-Object -First 1
  $out.Add("running: " + $proc.Path)
} catch { $out.Add("ERROR: $($_.Exception.Message)") }
$out.Add("done $(Get-Date -Format HH:mm:ss)")
$out | Set-Content $res
