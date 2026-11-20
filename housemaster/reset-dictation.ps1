# One-click reset for a jammed Win+H dictation panel.
# The panel can lock up so hard that its own X does nothing; this closes the
# window properly, then force-kills the process. Windows starts a clean one.
# No admin needed. Nothing else is touched.

Add-Type -Namespace N -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); public delegate bool EnumProc(IntPtr h, IntPtr l);'

$targets = @((Get-Process TextInputHost -ErrorAction SilentlyContinue).Id)

if ($targets.Count -eq 0) {
    Write-Host 'Dictation panel was not running. Press Win+H and it comes back.' -ForegroundColor DarkGray
    exit
}

# Ask each window to close first, so nothing is left half-drawn.
$cb = [N.W+EnumProc]{
    param($h, $l)
    $pid2 = 0
    [N.W]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
    if ($targets -contains $pid2) { [N.W]::PostMessageW($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
    return $true
}
[N.W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 1200

# Then force it, in case it is wedged.
& taskkill.exe /F /IM TextInputHost.exe 2>&1 | Out-Null
Start-Sleep -Milliseconds 800

if (Get-Process TextInputHost -ErrorAction SilentlyContinue) {
    Write-Host 'Panel still there. Press Win+H once to kick it.' -ForegroundColor Yellow
} else {
    Write-Host 'Panel cleared. Press Win+H and it comes back clean.' -ForegroundColor Green
}
