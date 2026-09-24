$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'publish'
$runtimeInstaller = Join-Path $PSScriptRoot 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'

try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }
Write-Host 'MD Viewer 一键安装' -ForegroundColor Cyan
Write-Host '正在检查安装文件和运行组件…'
$client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$runtimeInstalled = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client"
) | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.pv -and $_.pv -ne '0.0.0.0' } | Select-Object -First 1
if (-not $runtimeInstalled) {
    if (-not (Test-Path $runtimeInstaller -PathType Leaf)) {
        throw 'WebView2 Runtime is missing, and the offline installer is not present. Use the complete release package.'
    }
    Write-Host '正在安装 WebView2 Runtime（离线组件）…' -ForegroundColor Yellow
    $runtimeProcess = Start-Process $runtimeInstaller -ArgumentList '/silent', '/install' -Wait -PassThru
    if ($runtimeProcess.ExitCode -notin @(0, 3010)) { throw "WebView2 Runtime 安装失败（退出代码 $($runtimeProcess.ExitCode)）。" }
    if ($runtimeProcess.ExitCode -eq 3010) { Write-Host '运行组件已安装；Windows 建议稍后重启以完成更新。' -ForegroundColor Yellow }
}
if (-not (Test-Path (Join-Path $source 'MDViewer.exe') -PathType Leaf)) {
    & (Join-Path $PSScriptRoot 'build.ps1')
}
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
Write-Host ''
Write-Host '安装完成，MD Viewer 已启动。' -ForegroundColor Green
Write-Host '以后可从 Windows「开始」菜单启动 MD Viewer。'
Write-Host '若要双击 .md 文件打开，请在应用工具栏点击「默认」，并按 Windows 提示确认。'
