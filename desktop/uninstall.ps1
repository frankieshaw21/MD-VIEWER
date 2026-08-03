$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\MD Viewer'
$exe = Join-Path $installDir 'MDViewer.exe'
if (Test-Path $exe) { & $exe --unregister }
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MD Viewer.lnk'
if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
Get-Process MDViewer -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
Write-Host 'MD Viewer uninstalled. LocalAppData\MDViewer cache was preserved.' -ForegroundColor Green
