Add-Type -AssemblyName System.Web
$port = 8899
$root = $PSScriptRoot

# If server already running on this port, exit quietly
$inUse = $false
try {
    $test = New-Object System.Net.Sockets.TcpClient
    $test.Connect('localhost', $port)
    $test.Close()
    $inUse = $true
} catch { $inUse = $false }
if ($inUse) { exit }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:${port}/")
try {
    $listener.Start()
} catch {
    exit
}

function Get-Mime($ext) {
    switch ($ext) {
        '.html' { 'text/html; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.md'   { 'text/plain; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.svg'  { 'image/svg+xml' }
        default { 'application/octet-stream' }
    }
}

while ($true) {
    $ctx = $listener.GetContext()
    $path = [System.Web.HttpUtility]::UrlDecode($ctx.Request.Url.LocalPath).TrimStart('/')
    $resp = $ctx.Response
    $resp.Headers.Add('Access-Control-Allow-Origin','*')

    try {
        if ($path -eq 'api/read') {
            $f = $ctx.Request.QueryString['file']
            if ($f -and (Test-Path $f)) {
                $bytes = [IO.File]::ReadAllBytes($f)
                $resp.ContentType = 'text/plain; charset=utf-8'
            } else {
                $resp.StatusCode = 404
                $bytes = [Text.Encoding]::UTF8.GetBytes('not found')
            }
        }
        elseif ($path -eq 'api/mtime') {
            $f = $ctx.Request.QueryString['file']
            if ($f -and (Test-Path $f)) {
                $t = (Get-Item $f).LastWriteTimeUtc.Ticks.ToString()
                $bytes = [Text.Encoding]::UTF8.GetBytes($t)
                $resp.ContentType = 'text/plain'
            } else {
                $resp.StatusCode = 404
                $bytes = [Text.Encoding]::UTF8.GetBytes('0')
            }
        }
        elseif ($path -eq 'api/list') {
            $dir = $ctx.Request.QueryString['dir']
            if (-not $dir) {
                $dir = Join-Path $env:USERPROFILE 'Desktop'
                if (-not (Test-Path $dir)) { $dir = $env:USERPROFILE }
            }

            function JsonStr($s) { return '"' + ($s -replace '\\','\\' -replace '"','\"') + '"' }

            if ($dir -eq 'DRIVES') {
                # Return list of drive roots
                $drives = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object { $_.Root })
                $dj = ($drives | ForEach-Object { '{"name":' + (JsonStr $_) + ',"path":' + (JsonStr $_) + '}' }) -join ','
                $json = '{"path":"DRIVES","parent":null,"dirs":[' + $dj + '],"files":[]}'
            }
            elseif (Test-Path $dir) {
                $item = Get-Item $dir -ErrorAction SilentlyContinue
                $parent = $null
                if ($item -and $item.Parent) { $parent = $item.Parent.FullName }
                elseif ($item -and $item.PSDrive) { $parent = 'DRIVES' }

                $dirs = @(Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
                    '{"name":' + (JsonStr $_.Name) + ',"path":' + (JsonStr $_.FullName) + '}'
                })
                $files = @(Get-ChildItem $dir -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Extension -match '^\.(md|markdown|txt)$' } | Sort-Object Name | ForEach-Object {
                    '{"name":' + (JsonStr $_.Name) + ',"path":' + (JsonStr $_.FullName) + '}'
                })
                $pj = if ($parent) { JsonStr $parent } else { 'null' }
                $json = '{"path":' + (JsonStr $dir) + ',"parent":' + $pj +
                    ',"dirs":[' + ($dirs -join ',') + '],"files":[' + ($files -join ',') + ']}'
            }
            else {
                $json = '{"path":"","parent":null,"dirs":[],"files":[],"error":"not found"}'
            }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $resp.ContentType = 'application/json; charset=utf-8'
        }
        else {
            if (-not $path) { $path = 'md-viewer.html' }
            $full = Join-Path $root $path
            if (Test-Path $full) {
                $bytes = [IO.File]::ReadAllBytes($full)
                $resp.ContentType = Get-Mime ([IO.Path]::GetExtension($full))
            } else {
                $resp.StatusCode = 404
                $bytes = [Text.Encoding]::UTF8.GetBytes('404')
            }
        }
        $resp.ContentLength64 = $bytes.Length
        # Write in chunks to avoid output stream buffer issues with large files
        $offset = 0
        $chunkSize = 65536
        while ($offset -lt $bytes.Length) {
            $count = [Math]::Min($chunkSize, $bytes.Length - $offset)
            $resp.OutputStream.Write($bytes, $offset, $count)
            $offset += $count
        }
        $resp.OutputStream.Flush()
    } catch {
        Write-Host "Error: $_" -ForegroundColor Red
    }
    $resp.Close()
}
