# Fixes Win+H dictation lock-ups on this laptop.
# Cause: Windows flips the Bluetooth headset into hands-free (call) mode whenever
# the mic is taken. That swaps the recording device out mid-session and jams the
# dictation panel so it stops answering, including its own X button.
# This takes every Bluetooth microphone out of the picture at the endpoint level,
# so the laptop's own mic is the only one on offer and there is nothing to flip.
# Sound out through the headset is untouched. Needs admin, so it elevates itself.
# The device ids are read from a private file kept outside the repo (see below).

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"")
    return
}

# The device ids this fixes belong to ONE computer and are personal, so they are not
# kept in this public repo. They live in a private file outside it:
#   %USERPROFILE%\Documents\cb-private\dictation-devices.json
# with three lists: handsFree (id), endpoints (guid), unpair (id), each entry also
# carrying a label. Without that file this script does nothing.
$cfgPath = Join-Path $env:USERPROFILE 'Documents\cb-private\dictation-devices.json'
if (-not (Test-Path $cfgPath)) {
    Write-Host "No device list at $cfgPath, so nothing to fix. See the notes at the top of this script." -ForegroundColor Yellow
    return
}
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json

$log = Join-Path $env:TEMP 'fix-dictation.log'
"$(Get-Date -Format 's') starting" | Set-Content $log

function Step($what, $block) {
    try {
        & $block
        "[ OK ] $what" | Add-Content $log
        Write-Host "[ OK ] $what" -ForegroundColor Green
    } catch {
        "[FAIL] $what -- $($_.Exception.Message)" | Add-Content $log
        Write-Host "[FAIL] $what" -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}

function Unpair($id) {
    if (-not (Get-PnpDevice -InstanceId $id -ErrorAction SilentlyContinue)) { return }
    $out = & pnputil.exe /remove-device "$id" 2>&1
    if ($LASTEXITCODE -ne 0 -and (($out -join ' ') -notmatch 'success')) { throw ($out -join ' ') }
}

function KillEndpoint($guid) {
    $id = "SWD\MMDEVAPI\{0.0.1.00000000}.$guid"
    $dev = Get-PnpDevice -InstanceId $id -ErrorAction SilentlyContinue
    if ($dev) {
        if ($dev.Status -eq 'OK') { Disable-PnpDevice -InstanceId $id -Confirm:$false }
        return
    }
    # Ghost entry with no device behind it (left by an unpaired device): mark it
    # disabled in the registry so Windows stops offering it. Reversible.
    $key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\$guid"
    if (-not (Test-Path $key)) { return }
    if ((Get-ItemProperty $key).DeviceState -eq 4) { return }
    & reg.exe add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\$guid" /v DeviceState /t REG_DWORD /d 4 /f | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "reg add failed ($LASTEXITCODE)" }
}

# 1. Hands-free devices (the headset's call side and any left behind by old pairings).
foreach ($d in $cfg.handsFree) {
    Step "disable hands-free device: $($d.label)" {
        Disable-PnpDevice -InstanceId $d.id -Confirm:$false
    }
}

# 2. Bluetooth microphones, at the endpoint level. This is the one that
#    actually stops Windows offering a Bluetooth mic to dictation.
foreach ($e in $cfg.endpoints) {
    Step "disable endpoint: $($e.label)" { KillEndpoint $e.guid }
}

# 3. Pairings that are not the phone or the headset, and dead duplicates.
#    The active pairings are untouched.
foreach ($u in $cfg.unpair) {
    Step "unpair: $($u.label)" { Unpair $u.id }
}

# 4. Restart the audio stack so the endpoint list is rebuilt now.
Step 'restart audio service' {
    Restart-Service AudioEndpointBuilder -Force
    Restart-Service Audiosrv -Force
    Start-Sleep -Seconds 4
}

# 5. Clear the jammed dictation panel.
Step 'restart dictation panel' {
    & taskkill.exe /F /IM TextInputHost.exe 2>&1 | Out-Null
}

# 6. Report exactly what the mic list looks like now.
Start-Sleep -Seconds 2
Add-Content $log '--- microphone endpoints after the run ---'
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture' -ErrorAction SilentlyContinue | ForEach-Object {
    $st = (Get-ItemProperty $_.PSPath).DeviceState
    $p = Get-ItemProperty (Join-Path $_.PSPath 'Properties') -ErrorAction SilentlyContinue
    $line = "state=$st  $($p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2')  $($p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},2')"
    Add-Content $log $line
    Write-Host $line -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Done. Only the laptop microphone should be left on offer.' -ForegroundColor Cyan
Write-Host "Log: $log" -ForegroundColor DarkGray
