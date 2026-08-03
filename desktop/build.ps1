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
Write-Host "Published: $output\MDViewer.exe" -ForegroundColor Green
