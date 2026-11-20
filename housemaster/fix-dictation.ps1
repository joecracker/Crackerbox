# Fixes Win+H dictation lock-ups on this laptop.
# Cause: Windows flips the DEWALT headset into Bluetooth call mode whenever the
# mic is taken, which swaps the recording device out mid-session and jams the
# dictation panel. This takes the hands-free side of the headset out of play so
# it stays in plain stereo (audio still works), and clears leftover pairings.
# Needs admin, so it elevates itself.

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

# 1. The headset's hands-free side. Doing this keeps the mic from ever being
#    offered over Bluetooth, so nothing switches when dictation starts.
Step 'disable DEWALT 2091 Hands-Free' {
    Disable-PnpDevice -InstanceId 'BTHHFENUM\BTHHFPAUDIO\8&2449457E&0&97' -Confirm:$false
}

# 2. An orphan hands-free device left behind by an old pairing.
Step 'disable orphan Microsoft Bluetooth Hands-Free Audio device' {
    Disable-PnpDevice -InstanceId 'BTHHFENUM\BTHHFPAUDIO\8&EF81DCA&0&97' -Confirm:$false
}

# 3. Pairings that are not the phone or the headset.
$unpair = @(
    'BTHENUM\DEV_BC8385295BBF\7&14F46B84&0&BLUETOOTHDEVICE_BC8385295BBF',
    'BTHENUM\DEV_BC8385295BBF\7&37DA03EC&1&BLUETOOTHDEVICE_BC8385295BBF',
    'BTHENUM\DEV_64B5F2A8915A\7&14F46B84&0&BLUETOOTHDEVICE_64B5F2A8915A',
    'BTHENUM\DEV_64B5F2A8915A\7&37DA03EC&1&BLUETOOTHDEVICE_64B5F2A8915A'
)
foreach ($id in $unpair) {
    Step "unpair $id" { Unpair $id }
}

# 4. A dead duplicate copy of the headset pairing. The active one is untouched.
Step 'clear dead duplicate headset entry' {
    Unpair 'BTHENUM\DEV_250307002F19\7&37DA03EC&1&BLUETOOTHDEVICE_250307002F19'
}

# 5. Restart the audio stack so the endpoint list is rebuilt now.
Step 'restart audio service' {
    Restart-Service AudioEndpointBuilder -Force
    Restart-Service Audiosrv -Force
}

# 6. Clear the jammed dictation panel.
Step 'restart dictation panel' {
    Stop-Process -Name TextInputHost -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Done. Right-click the volume icon and check the mic list: the headset' -ForegroundColor Cyan
Write-Host 'should no longer offer a microphone.' -ForegroundColor Cyan
Write-Host "Log: $log" -ForegroundColor DarkGray
