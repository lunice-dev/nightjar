# What the Windows tests share: installing and starting Nightjar, talking to its helper, results and logs.
# Dot-sourced by install-test.ps1, library-test.ps1 and remote-test.ps1, after their own param() block,
# which must set $Setup and $Out.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $env:CI) { throw "This test replaces the installed Nightjar and deletes its data. It only runs on CI." }

$Setup = (Resolve-Path $Setup).Path
$Version = [regex]::Match((Split-Path $Setup -Leaf), '\d+\.\d+\.\d+').Value
$Dir = Join-Path $env:LOCALAPPDATA "Programs\Nightjar"
$Data = Join-Path $Dir "data"
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$results = New-Object System.Collections.Generic.List[object]
$LocalOrigin = "http://127.0.0.1:5030"

function Say($text) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $text" }

function Flat($text) { ("$text" -replace "\s+", " ").Trim() }

# Annotations show on the run's page without signing in to GitHub; the log needs a sign-in.
function Annotate($level, $title, $message) {
    if (-not $env:GITHUB_ACTIONS) { return }
    $t = (Flat $title).Replace("%", "%25").Replace(":", "%3A").Replace(",", "%2C")
    $m = (Flat $message).Replace("%", "%25")
    Write-Host "::$level title=$t::$m"
}

function Check($name, [bool]$ok, $detail = "") {
    $results.Add([pscustomobject]@{ Check = $name; Result = $(if ($ok) { "pass" } else { "FAIL" }); Detail = $detail })
    Say ("{0} {1}{2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $(if ($detail) { " - $detail" } else { "" }))
    if (-not $ok) { Annotate "error" $name $(if ($detail) { $detail } else { $name }) }
}

function Note($name, $detail) {
    $results.Add([pscustomobject]@{ Check = $name; Result = "warn"; Detail = $detail })
    Say "WARN $name - $detail"
    Annotate "warning" $name $detail
}

# The helper as the Nightjar page on this PC uses it (port 5031, the page's own origin). Throws on an error status.
function Helper($path, $method = "GET", $body = $null) {
    $req = @{ Uri = "http://127.0.0.1:5031$path"; Method = $method; Headers = @{ Origin = $LocalOrigin }; TimeoutSec = 30 }
    if ($null -ne $body) { $req.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress -Depth 6)); $req.ContentType = "application/json; charset=utf-8" }
    Invoke-RestMethod @req
}

# Any request, answered with its status instead of throwing: @{ status; json; text; length }.
# Status -1: the connection closed before an answer could be read.
# $range = @(from, to) asks for part of a file, as a phone's player does.
function Call($url, $method = "GET", $body = $null, $headers = @{}, $range = $null) {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.Method = $method
    $req.Timeout = 30000
    $req.AllowAutoRedirect = $false
    foreach ($k in $headers.Keys) { $req.Headers[$k] = $headers[$k] }
    if ($range) { $req.AddRange([long]$range[0], [long]$range[1]) }
    if ($null -ne $body) {
        $bytes = if ($body -is [byte[]]) { $body } elseif ($body -is [string]) { [Text.Encoding]::UTF8.GetBytes($body) } else { [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress -Depth 6)) }
        $req.ContentType = "application/json; charset=utf-8"
        $req.ContentLength = $bytes.Length
        try { $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close() } catch { }
    }
    $resp = $null
    try { $resp = $req.GetResponse() }
    catch { $inner = $_.Exception.InnerException; if ($inner -is [Net.WebException]) { $resp = $inner.Response } elseif ($_.Exception -is [Net.WebException]) { $resp = $_.Exception.Response } }
    if ($null -eq $resp) { return [pscustomobject]@{ status = -1; json = $null; text = ""; length = 0 } }
    $ms = New-Object IO.MemoryStream
    try { $resp.GetResponseStream().CopyTo($ms) } catch { }
    $status = [int]$resp.StatusCode
    $resp.Close()
    $bytes = $ms.ToArray()
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $json = $null
    if ($text.TrimStart().StartsWith("{")) { try { $json = $text | ConvertFrom-Json } catch { } }
    [pscustomobject]@{ status = $status; json = $json; text = $text; length = $bytes.Length }
}

# Runs $test every 2 s until it returns something true, or gives up after $seconds and returns $null.
function WaitFor($seconds, [scriptblock]$test) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        try { $r = & $test; if ($r) { return $r } } catch { }
        Start-Sleep -Seconds 2
    }
    return $null
}

function RunSetup($file, $arguments) {
    $p = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
    # Only the installer itself: after /update it starts Nightjar, which must not be waited for.
    if (-not $p.WaitForExit(300000)) { throw "$file $arguments didn't finish in 5 minutes" }
    return $p.ExitCode
}

function Running($name) { @(Get-Process -Name $name -ErrorAction SilentlyContinue).Count -gt 0 }

function StartNightjar { Start-Process -FilePath (Join-Path $Dir "Nightjar.exe") -ArgumentList "--background" | Out-Null }

# The engine is up and accepts the login Nightjar wrote in slskd.yml (the token itself is never shown).
function EngineReady($seconds = 120) { [bool](WaitFor $seconds { (Helper "/token").token }) }

function SaveLogs($stage) {
    $dest = Join-Path $Out $stage
    New-Item -ItemType Directory -Force $dest | Out-Null
    if (Test-Path (Join-Path $Data "logs")) { Copy-Item (Join-Path $Data "logs\*") $dest -Recurse -Force -ErrorAction SilentlyContinue }
}

function StopNightjar {
    try { Helper "/quit" "POST" | Out-Null } catch { }
    WaitFor 30 { -not (Running "Nightjar") -and -not (Running "slskd") } | Out-Null
    Stop-Process -Name Nightjar, slskd -Force -ErrorAction SilentlyContinue
}

# Back to a PC that never had Nightjar.
function Reset {
    StopNightjar
    if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
    Remove-Item "HKCU:\Software\Nightjar", "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nightjar" -Recurse -Force -ErrorAction SilentlyContinue
}

function Installed { (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nightjar" -ErrorAction SilentlyContinue).DisplayVersion }

# A fresh install of the build under test, started and ready. Throws when it isn't.
function FreshNightjar {
    Reset
    if ((RunSetup $Setup "/S") -ne 0) { throw "the installer failed" }
    StartNightjar
    if (-not (EngineReady)) { throw "Nightjar didn't start" }
}

# The downloads folder Nightjar's first start chose (slskd.yml: directories: downloads:).
function DownloadDir {
    $yml = Get-Content (Join-Path $Data "slskd.yml") -Raw -Encoding UTF8
    $m = [regex]::Match($yml, "(?m)^\s+downloads:\s*'?(.+?)'?\s*$")
    if (-not $m.Success) { throw "no downloads folder in slskd.yml" }
    $m.Groups[1].Value.Replace("''", "'")
}

# --- music for the tests ---------------------------------------------------------------
# FLAC files of silence, made with the flac.exe Nightjar installs and tagged with the TagLib# it ships.
# $seconds changes the file's size, which is how Nightjar tells copies of an album apart.

$script:TagLibLoaded = $false
$script:Encoded = @{}

function MakeFlac($path, [hashtable]$tags = @{}, $bits = 16, $rate = 44100, $seconds = 0.5) {
    if (-not $script:TagLibLoaded) { Add-Type -Path (Join-Path $Dir "TagLibSharp.dll"); $script:TagLibLoaded = $true }
    $tmp = Join-Path $env:RUNNER_TEMP ("nj-" + [guid]::NewGuid().ToString("N"))
    # Each kind of file is encoded once (PowerShell is slow at writing samples); copies of it are tagged differently.
    $key = "$bits-$rate-$seconds"
    if (-not $script:Encoded.ContainsKey($key)) { $script:Encoded[$key] = EncodeFlac $bits $rate $seconds }
    Copy-Item -LiteralPath $script:Encoded[$key] -Destination "$tmp.flac"
    $f = [TagLib.File]::Create("$tmp.flac")
    if ($tags.artist) { $f.Tag.Performers = [string[]]@($tags.artist) }
    if ($tags.albumArtist) { $f.Tag.AlbumArtists = [string[]]@($tags.albumArtist) }
    if ($tags.album) { $f.Tag.Album = $tags.album }
    if ($tags.year) { $f.Tag.Year = [uint32]$tags.year }
    if ($tags.title) { $f.Tag.Title = $tags.title }
    $f.Save(); $f.Dispose()
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    Move-Item -LiteralPath "$tmp.flac" -Destination $path -Force
}

function EncodeFlac($bits, $rate, $seconds) {
    $channels = 2
    $bytesPer = $bits / 8
    $frames = [int]($rate * $seconds)
    $dataLen = $frames * $channels * $bytesPer
    $tmp = Join-Path $env:RUNNER_TEMP ("nj-src-" + [guid]::NewGuid().ToString("N"))
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($ms)
    $w.Write([Text.Encoding]::ASCII.GetBytes("RIFF")); $w.Write([int](36 + $dataLen)); $w.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
    $w.Write([int]16); $w.Write([int16]1); $w.Write([int16]$channels); $w.Write([int]$rate)
    $w.Write([int]($rate * $channels * $bytesPer)); $w.Write([int16]($channels * $bytesPer)); $w.Write([int16]$bits)
    $w.Write([Text.Encoding]::ASCII.GetBytes("data")); $w.Write([int]$dataLen)
    # A quiet tone rather than silence, so files of different lengths really differ in size.
    $amp = if ($bits -eq 24) { 100000 } else { 400 }
    for ($i = 0; $i -lt $frames; $i++) {
        $v = [int]($amp * [Math]::Sin($i * 0.05))
        for ($c = 0; $c -lt $channels; $c++) {
            if ($bits -eq 24) { $w.Write([byte]($v -band 0xFF)); $w.Write([byte](($v -shr 8) -band 0xFF)); $w.Write([byte](($v -shr 16) -band 0xFF)) }
            else { $w.Write([int16]$v) }
        }
    }
    $w.Flush()
    [IO.File]::WriteAllBytes("$tmp.wav", $ms.ToArray())
    & (Join-Path $Dir "tools\flac.exe") -s -f -o "$tmp.flac" "$tmp.wav" | Out-Null
    if (-not (Test-Path "$tmp.flac")) { throw "flac.exe didn't make a file" }
    Remove-Item "$tmp.wav" -ErrorAction SilentlyContinue
    return "$tmp.flac"
}

# An album folder of $tracks files.
# (Not $dir: PowerShell's names ignore capitals, so it would hide $Dir, where Nightjar is installed.)
function MakeAlbum($folder, [hashtable]$tags, $tracks = 2, $bits = 16, $rate = 44100, $seconds = 0.5) {
    for ($i = 1; $i -le $tracks; $i++) {
        $t = $tags.Clone(); $t.title = "Track $i"
        MakeFlac (Join-Path $folder ("{0:D2} Track {0}.flac" -f $i)) $t $bits $rate $seconds
    }
}

# Every file under $root: relative path (with its exact capitals), size and SHA-256, sorted. For "nothing changed or got lost".
function Snapshot($root) {
    $base = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\')
    @(Get-ChildItem -LiteralPath $base -Recurse -File -Force | ForEach-Object {
        "{0}|{1}|{2}" -f $_.FullName.Substring($base.Length + 1), $_.Length, (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    } | Sort-Object -CaseSensitive)
}

# The same files, wherever they are now: sizes and hashes only.
function Contents($root) { @(Snapshot $root | ForEach-Object { ($_ -split '\|')[1, 2] -join "|" } | Sort-Object) }

function Same($a, $b) { (@($a) -join "`n") -ceq (@($b) -join "`n") }

# The table on the run's page, and the exit code.
function Finish($title) {
    $table = "| Check | Result | Detail |`n|---|---|---|`n" + (($results | ForEach-Object { "| $($_.Check) | $($_.Result) | $($_.Detail -replace '\|', '/') |" }) -join "`n")
    if ($env:GITHUB_STEP_SUMMARY) { "## $title`n`n$table`n" | Add-Content $env:GITHUB_STEP_SUMMARY -Encoding UTF8 }
    $failed = @($results | Where-Object Result -eq "FAIL")
    Say "$($results.Count) checks, $($failed.Count) failed"
    if ($failed.Count -gt 0) { exit 1 }
}
