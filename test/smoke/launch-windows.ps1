# One launch of the installed app on the Windows runner: start it, look for
# an error box, run the smoke test, look again, and take whole-screen shots.
# Everything shares one step, since the runner ends a step's processes when
# it finishes. Usage: launch-windows.ps1 -Out <dir> [-Hidden]
#   -Hidden: the profile was seeded with the tab bar hidden; also shoots the
#   screen before the test (hidden) and after it (check g leaves it peeked).
param([string]$Out, [switch]$Hidden)
New-Item -ItemType Directory -Force $Out | Out-Null
$env:ZS_SMOKE_OUT = $Out
$env:ZS_SMOKE_HIDDEN = if ($Hidden) { '1' } else { '' }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);'

function Get-AppWindow {
  Get-Process Zenshape -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

# The runner's console window sits on top; bring ours forward first.
function Save-Screen([string]$Name) {
  $p = Get-AppWindow
  if ($p) {
    Write-Host "window: '$($p.MainWindowTitle)'"
    [W.U]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
    [W.U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  }
  Start-Sleep -Seconds 2
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $img = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  [System.Drawing.Graphics]::FromImage($img).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $img.Save((Join-Path $Out $Name))
}

# The window's minimize/maximize/close as UI Automation sees them, with
# their screen rectangles. $null when UI Automation isn't available.
function Get-Controls {
  try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes } catch { Write-Host "UI Automation unavailable: $_"; return $null }
  $p = Get-AppWindow
  if (-not $p) { return @() }
  $A = [System.Windows.Automation.AutomationElement]
  $root = $A::FromHandle($p.MainWindowHandle)
  $cond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) | ForEach-Object {
      $r = $_.Current.BoundingRectangle
      # Below = how far the button reaches below the window's top edge.
      [pscustomobject]@{ Name = $_.Current.Name; Rect = $r.ToString(); Below = $r.Bottom - $root.Current.BoundingRectangle.Top }
    } | Where-Object { $_.Name -match '^(Minimize|Maximize|Restore|Close)$' })
}

function Write-Controls([string]$Label) {
  $c = Get-Controls
  $text = if ($null -eq $c) { 'unavailable' } else { $c | Format-Table -AutoSize | Out-String -Width 300 }
  "== $Label`n$text" | Out-File -Append -Encoding utf8 (Join-Path $Out 'controls.txt')
  # Write-Host: a function's echo would land in its return value.
  Write-Host "controls ($Label):"; Write-Host $text
  return $c
}

$exe = Get-ChildItem "$env:LOCALAPPDATA\zenshape\app-*\Zenshape.exe" | Select-Object -First 1
echo "app: $($exe.FullName)"
$log = Join-Path $Out 'app.log'
$err = Join-Path $Out 'app.err.log'
$env:ZS_SMOKE_LOG = "$log;$err"
Start-Process $exe.FullName -ArgumentList "--remote-debugging-port=$env:ZS_SMOKE_PORT" -RedirectStandardOutput $log -RedirectStandardError $err
$failed = 0
try {
  Start-Sleep -Seconds 15
  pwsh -File test/smoke/no-error-dialog.ps1 after-start
  if ($LASTEXITCODE) { $failed = 1 }
  if ($Hidden) {
    Save-Screen 'screen.png'
    $hiddenControls = Write-Controls 'hidden'
  }
  npm run test:smoke
  if ($LASTEXITCODE) { $failed = 1 }
  # The gutter grows to hold the buttons, so they must end within it (the
  # test wrote the strip's height while hidden).
  if ($Hidden -and -not $hiddenControls) {
    # Without them nothing shows the buttons stay off the page.
    echo "::error::hidden tab bar: UI Automation found no window buttons to check against the gutter"
    $failed = 1
  } elseif ($Hidden) {
    $gutter = [double](Get-Content (Join-Path $Out 'gutter.txt') -ErrorAction SilentlyContinue)
    $deepest = ($hiddenControls | Measure-Object -Property Below -Maximum).Maximum
    echo "hidden: buttons reach ${deepest}px down; gutter ${gutter}px"
    if (-not $gutter -or $deepest -gt $gutter) {
      echo "::error::hidden tab bar: the window buttons reach ${deepest}px down, past the ${gutter}px gutter"
      $failed = 1
    }
  }
  pwsh -File test/smoke/no-error-dialog.ps1 after-test
  if ($LASTEXITCODE) { $failed = 1 }
  $c = Write-Controls $(if ($Hidden) { 'peeked' } else { 'shown' })
  # Only where UI Automation sees the window's buttons at all.
  if (-not $Hidden -and $c) {
    foreach ($want in 'Minimize', '(Maximize|Restore)', 'Close') {
      if (-not ($c | Where-Object { $_.Name -match "^$want$" })) {
        echo "::error::no $want button in the window"
        $failed = 1
      }
    }
  } elseif (-not $Hidden) {
    echo "::warning::UI Automation saw no window buttons; not asserted"
  }
} finally {
  Save-Screen $(if ($Hidden) { 'screen-peeked.png' } else { 'screen.png' })
  # The next launch needs the single-instance lock.
  Get-Process Zenshape -ErrorAction SilentlyContinue | Stop-Process -Force
  $until = (Get-Date).AddSeconds(30)
  while ((Get-Process Zenshape -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 1 }
}
exit $failed
