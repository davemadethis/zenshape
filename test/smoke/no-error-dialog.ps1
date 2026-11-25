# Fails if a top-level window is Electron's main-process error box. A
# synchronous throw in the main process shows only that box, and writes
# nothing to the app's output, so check e can't see it. Process.MainWindowTitle
# names one window per process, so this walks every top-level window.
# Usage: no-error-dialog.ps1 <label>; appends the window list to
# $env:ZS_SMOKE_OUT\windows.txt.
param([string]$Label)
Add-Type -Namespace Smoke -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr p);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
'@
$windows = [System.Collections.Generic.List[object]]::new()
[Smoke.Win]::EnumWindows([Smoke.Win+EnumProc]{
    param($h, $p)
    if ([Smoke.Win]::IsWindowVisible($h)) {
      $t = [System.Text.StringBuilder]::new(512)
      $c = [System.Text.StringBuilder]::new(256)
      [void][Smoke.Win]::GetWindowText($h, $t, 512)
      [void][Smoke.Win]::GetClassName($h, $c, 256)
      $procId = 0
      [void][Smoke.Win]::GetWindowThreadProcessId($h, [ref]$procId)
      $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).Name
      $windows.Add([pscustomobject]@{ Process = $name; Class = "$c"; Title = "$t" })
    }
    $true
  }, [System.IntPtr]::Zero) | Out-Null
$list = $windows | Format-Table -AutoSize | Out-String -Width 300
"== $Label`n$list" | Out-File -Append -Encoding utf8 (Join-Path $env:ZS_SMOKE_OUT 'windows.txt')
# Electron's box is a dialog-class window (#32770) the app owns, captioned
# "Error" (seen); a title with the message is matched too, in case.
$bad = $windows | Where-Object {
  $_.Title -like '*JavaScript error*' -or ($_.Process -eq 'Zenshape' -and $_.Class -eq '#32770')
}
if ($bad) {
  $bad | Format-Table -AutoSize | Out-String -Width 300 | Write-Output
  Write-Output "::error::${Label}: main-process error box is open"
  exit 1
}
Write-Output "${Label}: no error box"
$list
