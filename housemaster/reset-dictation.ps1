# One-click reset for a jammed Win+H dictation panel.
# Kills the stuck panel process; Windows starts a clean one straight away.
# No admin needed. Nothing else is touched.

$proc = Get-Process TextInputHost -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host 'Dictation panel was not running. Nothing to do.' -ForegroundColor DarkGray
    return
}

Stop-Process -Name TextInputHost -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1500

if (Get-Process TextInputHost -ErrorAction SilentlyContinue) {
    Write-Host 'Dictation panel reset.' -ForegroundColor Green
} else {
    Write-Host 'Panel closed. Press Win+H and it comes back clean.' -ForegroundColor Green
}
