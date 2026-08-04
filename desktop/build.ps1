$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'MDViewer.Desktop.csproj'
$output = Join-Path $PSScriptRoot 'publish'
$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'MDViewerDev\dotnet\dotnet.exe'),
    (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe')
)
$dotnet = $candidates | Where-Object { Test-Path $_ } | Where-Object {
    (& $_ --list-sdks 2>$null) -match '^8\.'
} | Select-Object -First 1
if (-not $dotnet) { throw 'The .NET 8 SDK was not found.' }
if (Test-Path $output) { Remove-Item $output -Recurse -Force }
& $dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $output
if ($LASTEXITCODE -ne 0) { throw 'MD Viewer publish failed.' }
$requiredFiles = @(
    'MDViewer.exe', 'app\md-viewer.html', 'app\mermaid.min.js', 'app\assets\md-viewer.css',
    'app\js\bootstrap.js', 'app\js\clipboard.js', 'app\js\context.js', 'app\js\desktop.js',
    'app\js\editor.js', 'app\js\files.js', 'app\js\history.js', 'app\js\parser.js',
    'app\js\tables.js', 'app\js\ui.js'
)
$missingFiles = $requiredFiles | Where-Object { -not (Test-Path (Join-Path $output $_) -PathType Leaf) }
if ($missingFiles) { throw "Published app is incomplete. Missing: $($missingFiles -join ', ')" }
$mermaidSource = Join-Path (Split-Path $PSScriptRoot -Parent) 'mermaid.min.js'
$mermaidPublished = Join-Path $output 'app\mermaid.min.js'
if ((Get-FileHash $mermaidSource -Algorithm SHA256).Hash -ne (Get-FileHash $mermaidPublished -Algorithm SHA256).Hash) {
    throw 'Published mermaid.min.js does not match the source file.'
}
Write-Host "Published and verified: $output\MDViewer.exe" -ForegroundColor Green
