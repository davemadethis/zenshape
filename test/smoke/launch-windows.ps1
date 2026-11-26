# One launch of the installed app on the Windows runner: start it, look for
# an error box, run the smoke test, look again, and take whole-screen shots.
# Everything shares one step, since the runner ends a step's processes when
# it finishes. Usage: launch-windows.ps1 -Out <dir> [-Hidden]
#   -Hidden: the profile was seeded with the tab bar hidden; also shoots the
#   screen before the test (hidden) and after it (check g leaves it peeked).
# Then step h: the Z's menu, read with UI Automation, and Ctrl+T with no
# menu bar.
param([string]$Out, [switch]$Hidden)
New-Item -ItemType Directory -Force $Out | Out-Null
$env:ZS_SMOKE_OUT = $Out
$env:ZS_SMOKE_HIDDEN = if ($Hidden) { '1' } else { '' }
# The app says on stdout when the Z's menu opens and closes (check h).
$env:ZENSHAPE_TRACE_MENUS = '1'

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, System.UIntPtr e); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'

function Get-AppWindow {
  Get-Process Zenshape -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

# The runner's console window sits on top; bring ours forward first.
# -Unlock: Windows lets a background process take the foreground only right
# after a key press, so press (and release) Alt first; a refused
# SetForegroundWindow would leave keys and focus with the console.
function Focus-App([switch]$Unlock) {
  $p = Get-AppWindow
  if ($p) {
    Write-Host "window: '$($p.MainWindowTitle)'"
    if ($Unlock) {
      [W.U]::keybd_event(0x12, 0, 0, [System.UIntPtr]::Zero)
      [W.U]::keybd_event(0x12, 0, 2, [System.UIntPtr]::Zero)
    }
    [W.U]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
    [W.U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  }
  Start-Sleep -Seconds 2
  if ($p) { Write-Host "foreground is the app: $([W.U]::GetForegroundWindow() -eq $p.MainWindowHandle)" }
}

function Save-Screen([string]$Name) {
  Focus-App
  Grab-Screen $Name
}

# As it is: focusing the window would close an open menu.
function Grab-Screen([string]$Name) {
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

# What UI Automation shows of any open menu of the app: every named element
# inside an element of type Menu. Chromium shows the Z's menu as a Menu
# inside the main window, not a window of its own, and its checkbox items
# aren't of type MenuItem, so neither the window nor the type picks them out.
# The comma keeps an empty list a list, apart from $null (UI Automation
# unavailable); assign it before counting: @(Get-MenuItems) would wrap it
# once more.
function Get-MenuItems {
  try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes } catch { Write-Host "UI Automation unavailable: $_"; return $null }
  $A = [System.Windows.Automation.AutomationElement]
  $ids = @(Get-Process Zenshape -ErrorAction SilentlyContinue | ForEach-Object Id)
  $menu = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Menu)
  $seen = @{}
  return , @($A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
      Where-Object { $ids -contains $_.Current.ProcessId } |
      ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, $menu) } |
      ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } |
      Where-Object {
        $key = $_.GetRuntimeId() -join '.'
        $new = $_.Current.Name -and -not $seen.ContainsKey($key)
        $seen[$key] = $true
        $new
      })
}

function Get-MenuNames {
  $items = Get-MenuItems
  if ($null -eq $items) { return $null }
  return , @($items | ForEach-Object { $_.Current.Name })
}

# The app's trace of its menus so far (ZENSHAPE_TRACE_MENUS).
function Write-MenuTrace {
  Get-Content (Join-Path $Out 'app.log') -ErrorAction SilentlyContinue |
    Where-Object { $_ -like 'strip menu: *' } | ForEach-Object { Write-Host "  app: $_" }
}

# Chromium builds a window's accessibility tree only once UI Automation asks
# for it, so the first reads can come back empty: retry until $Want shows.
function Wait-MenuName([string]$Want, [int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  do {
    $names = Get-MenuNames
    if ($null -eq $names -or ($names | Where-Object { $_ -like $Want })) { return $names }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $until)
  return $names
}

function Write-MenuNames([string]$Label, $Names) {
  "== $Label`n$($Names -join "`n")`n" | Out-File -Append -Encoding utf8 (Join-Path $Out 'menu.txt')
  Write-Host "menu ($Label): $($Names -join ' | ')"
}

# When the menu reads empty, the log alone should say why: what windows the
# app has, what UI Automation sees in them, and who has the foreground.
function Write-MenuDiagnostics {
  $A = [System.Windows.Automation.AutomationElement]
  $ids = @(Get-Process Zenshape -ErrorAction SilentlyContinue | ForEach-Object Id)
  $fg = [W.U]::GetForegroundWindow()
  Write-Host "h: diagnostics; foreground window $fg, app main window $((Get-AppWindow).MainWindowHandle)"
  $menuish = New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Menu)),
    (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)))
  foreach ($w in $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    $c = $w.Current
    if ($ids -notcontains $c.ProcessId) { continue }
    Write-Host ("  window {0} class='{1}' name='{2}' hwnd={3} offscreen={4}" -f $c.ControlType.ProgrammaticName, $c.ClassName, $c.Name, $c.NativeWindowHandle, $c.IsOffscreen)
    foreach ($m in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $menuish)) {
      Write-Host ("    {0} '{1}'" -f $m.Current.ControlType.ProgrammaticName, $m.Current.Name)
      if ($m.Current.ControlType -ne [System.Windows.Automation.ControlType]::Menu) { continue }
      foreach ($e in $m.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
        Write-Host ("      {0} '{1}'" -f $e.Current.ControlType.ProgrammaticName, $e.Current.Name)
      }
    }
  }
  Write-Host "  every visible top-level window (Win32):"
  pwsh -File test/smoke/no-error-dialog.ps1 menu-open | Out-Host
}

# Fails the launch unless every pattern names one of the items.
function Assert-MenuHas($Names, [string[]]$Want, [string]$Where) {
  $ok = $true
  foreach ($w in $Want) {
    if (-not ($Names | Where-Object { $_ -like $w })) {
      Write-Host "::error::h: no '$w' in $Where"
      $ok = $false
    }
  }
  return $ok
}

function Test-MenuOpen {
  $names = Get-MenuNames
  return [bool]($names | Where-Object { $_ -eq 'Zen Mode' })
}

# Opens a submenu item: UI Automation's expand, else a click on it.
function Open-MenuItem($Item) {
  $pat = $null
  if ($Item.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) { $pat.Expand(); return }
  if ($Item.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); return }
  $r = $Item.Current.BoundingRectangle
  [W.U]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
  [W.U]::mouse_event(2, 0, 0, 0, [System.UIntPtr]::Zero)
  [W.U]::mouse_event(4, 0, 0, 0, [System.UIntPtr]::Zero)
}

# Its output goes to the host (Write-Host, Out-Host): anything else would
# land in its return value.
# h: open the Z's menu with the app in front, check it holds the app menu,
# close it, then press Ctrl+T (no menu bar is drawn, so only the application
# menu's accelerator can open the tab); the test's last pass checks the tab
# and the output.
function Test-ZMenu {
  $ok = $true
  Focus-App -Unlock
  $env:ZS_SMOKE_PASS = 'menu'
  npm run test:smoke | Out-Host
  if ($LASTEXITCODE) { $ok = $false }
  $names = Wait-MenuName 'Zen Mode' 10
  Grab-Screen 'screen-menu.png'
  if ($null -eq $names) {
    Write-Host "::error::h: UI Automation unavailable, the menu can't be read"
    $ok = $false
  } else {
    Write-MenuNames 'open' $names
    Write-MenuTrace
    if (-not (Assert-MenuHas $names @('Hide Tab Bar', 'Zen Mode', 'Zenshape', 'File', 'View', 'Window') "the Z's menu")) {
      $ok = $false
      Write-MenuDiagnostics
    }
    $all = Get-MenuItems
    $z = $all | Where-Object { $_.Current.Name -eq 'Zenshape' } | Select-Object -First 1
    if ($z) {
      # Shown only once Zenshape ▸ opens, or the check below proves nothing.
      if ($names | Where-Object { $_ -eq 'About Zenshape' }) {
        Write-Host "::error::h: About Zenshape is listed before Zenshape ▸ is opened"
        $ok = $false
      }
      Open-MenuItem $z
      $sub = Wait-MenuName 'About Zenshape' 5
      Grab-Screen 'screen-menu-zenshape.png'
      Write-MenuNames 'Zenshape' $sub
      if (-not (Assert-MenuHas $sub @('About Zenshape', 'Saved Sign-in*') 'Zenshape ▸')) { $ok = $false }
    }
    # One Esc per open level; a spare one would reach the page.
    for ($i = 0; $i -lt 3 -and (Test-MenuOpen); $i++) {
      [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
      Start-Sleep -Milliseconds 500
    }
    if (Test-MenuOpen) {
      Write-Host "::error::h: the menu is still open after Esc"
      $ok = $false
    }
  }
  Focus-App -Unlock
  [System.Windows.Forms.SendKeys]::SendWait('^t')
  Start-Sleep -Seconds 3
  $env:ZS_SMOKE_PASS = 'after-menu'
  npm run test:smoke | Out-Host
  if ($LASTEXITCODE) { $ok = $false }
  $env:ZS_SMOKE_PASS = ''
  return $ok
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
  # Before h, which may leave it unpeeked.
  if ($Hidden) { Save-Screen 'screen-peeked.png' }
  if (-not (Test-ZMenu)) { $failed = 1 }
  pwsh -File test/smoke/no-error-dialog.ps1 after-test
  if ($LASTEXITCODE) { $failed = 1 }
} finally {
  Save-Screen $(if ($Hidden) { 'screen-end.png' } else { 'screen.png' })
  # The next launch needs the single-instance lock.
  Get-Process Zenshape -ErrorAction SilentlyContinue | Stop-Process -Force
  $until = (Get-Date).AddSeconds(30)
  while ((Get-Process Zenshape -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 1 }
}
exit $failed
