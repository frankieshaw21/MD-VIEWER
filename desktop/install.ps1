$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1')
$source = Join-Path $PSScriptRoot 'publish'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\MD Viewer'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item (Join-Path $source '*') $installDir -Recurse -Force
$exe = Join-Path $installDir 'MDViewer.exe'
& $exe --register
$shell = New-Object -ComObject WScript.Shell
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MD Viewer.lnk'
$shortcut = $shell.CreateShortcut($startMenu)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = 'MD Viewer'
$shortcut.Save()
Start-Process $exe
Write-Host 'MD Viewer installed and registered for Markdown files.' -ForegroundColor Green
Write-Host 'Use the Default toolbar button to confirm it in Windows Settings.'
