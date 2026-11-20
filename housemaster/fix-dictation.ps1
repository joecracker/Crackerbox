# Fixes Win+H dictation lock-ups on this laptop.
# Cause: Windows flips the Bluetooth headset into hands-free (call) mode whenever
# the mic is taken. That swaps the recording device out mid-session and jams the
# dictation panel so it stops answering, including its own X button.
# This takes every Bluetooth microphone out of the picture at the endpoint level,
# so the laptop's own mic is the only one on offer and there is nothing to flip.
# Sound out through the headset is untouched. Needs admin, so it elevates itself.

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"")
    return
}

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

# 1. The headset's hands-free side, at the device level.
Step 'disable DEWALT 2091 Hands-Free' {
    Disable-PnpDevice -InstanceId 'BTHHFENUM\BTHHFPAUDIO\8&2449457E&0&97' -Confirm:$false
}

# 2. Hands-free devices left behind by old pairings.
Step 'disable orphan Microsoft Bluetooth Hands-Free Audio device' {
    Disable-PnpDevice -InstanceId 'BTHHFENUM\BTHHFPAUDIO\8&EF81DCA&0&97' -Confirm:$false
}
Step 'disable leftover DESKTOP-RRKM96O Hands-Free' {
    Disable-PnpDevice -InstanceId 'BTHHFENUM\BTHHFPAUDIO\8&37528739&0&97' -Confirm:$false
}

# 3. Every Bluetooth microphone, at the endpoint level. This is the one that
#    actually stops Windows offering a Bluetooth mic to dictation.
Step 'disable Bluetooth microphone endpoint (phone)' { KillEndpoint '{33653BDC-B40E-40BE-9547-E22017ED8E92}' }
Step 'disable Bluetooth headset-mic endpoint (leftover)' { KillEndpoint '{9EFA0F77-D3A3-45A0-AC89-D11045FCBDC7}' }
Step 'disable Bluetooth headset endpoint (DEWALT call side)' { KillEndpoint '{203E565A-6B57-40C3-831B-83AF2C7E3D94}' }

# 4. Pairings that are not the phone or the headset.
$unpair = @(
    'BTHENUM\DEV_BC8385295BBF\7&14F46B84&0&BLUETOOTHDEVICE_BC8385295BBF',
    'BTHENUM\DEV_BC8385295BBF\7&37DA03EC&1&BLUETOOTHDEVICE_BC8385295BBF',
    'BTHENUM\DEV_64B5F2A8915A\7&14F46B84&0&BLUETOOTHDEVICE_64B5F2A8915A',
    'BTHENUM\DEV_64B5F2A8915A\7&37DA03EC&1&BLUETOOTHDEVICE_64B5F2A8915A'
)
foreach ($id in $unpair) {
    Step "unpair $id" { Unpair $id }
}

# 5. A dead duplicate copy of the headset pairing. The active one is untouched.
Step 'clear dead duplicate headset entry' {
    Unpair 'BTHENUM\DEV_250307002F19\7&37DA03EC&1&BLUETOOTHDEVICE_250307002F19'
}

# 6. Restart the audio stack so the endpoint list is rebuilt now.
Step 'restart audio service' {
    Restart-Service AudioEndpointBuilder -Force
    Restart-Service Audiosrv -Force
    Start-Sleep -Seconds 4
}

# 7. Clear the jammed dictation panel.
Step 'restart dictation panel' {
    & taskkill.exe /F /IM TextInputHost.exe 2>&1 | Out-Null
}

# 8. Report exactly what the mic list looks like now.
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
