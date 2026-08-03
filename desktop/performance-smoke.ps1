param(
    [string]$DocumentPath = ((Get-ChildItem (Join-Path (Split-Path $PSScriptRoot) '..') -Filter 'Arista_Juniper_Cisco_Load_Balance*.md' | Select-Object -First 1).FullName),
    [int]$SamplesPerPhase = 15,
    [int]$IntervalMilliseconds = 1000
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\MD Viewer\MDViewer.exe'
if (-not (Test-Path $exe)) { throw 'MD Viewer is not installed.' }
if (-not (Test-Path $DocumentPath)) { throw "Document not found: $DocumentPath" }
$root = Get-Process MDViewer -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1
if (-not $root) {
    $root = Start-Process $exe -PassThru
    Start-Sleep -Seconds 5
    $root.Refresh()
}
$logicalProcessors = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$results = New-Object System.Collections.Generic.List[object]
$previousCpu = $null
$previousTime = $null

function Get-TreeIds([int]$RootId) {
    $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $ids = @($RootId)
    do {
        $children = @($processes | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })
        if ($children.Count) { $ids += $children }
    } while ($children.Count)
    return @($ids | Select-Object -Unique)
}

function Add-Sample([string]$Phase) {
    $now = Get-Date
    $ids = Get-TreeIds $root.Id
    $items = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
    $cpuTotal = [double](($items | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum)
    $cpuPercent = 0
    if ($null -ne $previousCpu) {
        $elapsed = ($now - $previousTime).TotalSeconds
        $cpuPercent = [math]::Max(0, ($cpuTotal - $previousCpu) / $elapsed / $logicalProcessors * 100)
    }
    $previousCpu = $cpuTotal
    $previousTime = $now
    $root.Refresh()
    $results.Add([pscustomobject]@{
        Phase=$Phase; Time=$now; CpuPercent=[math]::Round($cpuPercent,2); Processes=$items.Count
        WorkingSetMB=[math]::Round((($items | Measure-Object WorkingSet64 -Sum).Sum)/1MB,1)
        PrivateMB=[math]::Round((($items | Measure-Object PrivateMemorySize64 -Sum).Sum)/1MB,1)
        Threads=(($items | ForEach-Object {$_.Threads.Count} | Measure-Object -Sum).Sum)
        Handles=(($items | Measure-Object HandleCount -Sum).Sum); Responding=$root.Responding
    })
}

function Sample-Phase([string]$Name) {
    1..$SamplesPerPhase | ForEach-Object {
        Add-Sample $Name
        Start-Sleep -Milliseconds $IntervalMilliseconds
    }
}

$osBefore = Get-CimInstance Win32_OperatingSystem
Sample-Phase 'idle-before'
Start-Process $exe -ArgumentList ('"' + (Resolve-Path $DocumentPath) + '"') | Out-Null
Sample-Phase 'open-document'
Sample-Phase 'idle-after'
$osAfter = Get-CimInstance Win32_OperatingSystem

$summary = $results | Group-Object Phase | ForEach-Object {
    $samples = @($_.Group)
    $sortedCpu = @($samples.CpuPercent | Sort-Object)
    $p95Index = [math]::Min($sortedCpu.Count - 1, [math]::Floor($sortedCpu.Count * 0.95))
    [pscustomobject]@{
        Phase=$_.Name; Samples=$samples.Count
        CpuAvgPercent=[math]::Round(($samples.CpuPercent | Measure-Object -Average).Average,2)
        CpuP95Percent=$sortedCpu[$p95Index]
        CpuMaxPercent=($samples.CpuPercent | Measure-Object -Maximum).Maximum
        WorkingSetAvgMB=[math]::Round(($samples.WorkingSetMB | Measure-Object -Average).Average,1)
        WorkingSetMaxMB=($samples.WorkingSetMB | Measure-Object -Maximum).Maximum
        PrivateMaxMB=($samples.PrivateMB | Measure-Object -Maximum).Maximum
        ProcessMax=($samples.Processes | Measure-Object -Maximum).Maximum
        ThreadsMax=($samples.Threads | Measure-Object -Maximum).Maximum
        HandlesMax=($samples.Handles | Measure-Object -Maximum).Maximum
        UnresponsiveSamples=@($samples | Where-Object {-not $_.Responding}).Count
    }
}
$result = [pscustomobject]@{
    RootProcessId=$root.Id; LogicalProcessors=$logicalProcessors
    Document=(Resolve-Path $DocumentPath).Path; DocumentBytes=(Get-Item $DocumentPath).Length
    FreeMemoryBeforeMB=[math]::Round($osBefore.FreePhysicalMemory/1024,0)
    FreeMemoryAfterMB=[math]::Round($osAfter.FreePhysicalMemory/1024,0)
    Summary=$summary; Samples=$results
}
$output = Join-Path $PSScriptRoot 'performance-results.json'
$result | ConvertTo-Json -Depth 6 | Set-Content $output -Encoding UTF8
$summary | Format-Table -AutoSize
"FREE_MEMORY_BEFORE_MB=$($result.FreeMemoryBeforeMB)"
"FREE_MEMORY_AFTER_MB=$($result.FreeMemoryAfterMB)"
"RESULT=$output"
