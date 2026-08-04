$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1')
$source = Join-Path $PSScriptRoot 'publish'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\MD Viewer'
$requiredFiles = @(
    'MDViewer.exe', 'app\md-viewer.html', 'app\mermaid.min.js', 'app\assets\md-viewer.css',
    'app\js\bootstrap.js', 'app\js\editor.js', 'app\js\files.js', 'app\js\parser.js', 'app\js\tables.js'
)
$missingSourceFiles = $requiredFiles | Where-Object { -not (Test-Path (Join-Path $source $_) -PathType Leaf) }
if ($missingSourceFiles) { throw "Install source is incomplete. Missing: $($missingSourceFiles -join ', ')" }
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item (Join-Path $source '*') $installDir -Recurse -Force
$invalidInstalledFiles = $requiredFiles | Where-Object {
    $sourceFile = Join-Path $source $_
    $installedFile = Join-Path $installDir $_
    -not (Test-Path $installedFile -PathType Leaf) -or
        (Get-FileHash $sourceFile -Algorithm SHA256).Hash -ne (Get-FileHash $installedFile -Algorithm SHA256).Hash
}
if ($invalidInstalledFiles) { throw "Installed app verification failed: $($invalidInstalledFiles -join ', ')" }
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
