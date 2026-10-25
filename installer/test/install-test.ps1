# Installs Nightjar on a fresh Windows (a GitHub Actions runner) and checks what testers go through:
#   1. a clean install, the first start and a clean quit
#   2. Tailscale installed by Nightjar on a PC that never had it
#   3. uninstalling (the data folder stays)
#   4. an update from 0.7.0, run the way Nightjar's updater runs it (/S /update): settings stay
#   5. Nightjar's own updater, from 0.8.0 to the latest release (download, checksum, signature, install)
# Never run this on a PC that has Nightjar: it replaces %LOCALAPPDATA%\Programs\Nightjar and deletes its data.
#   pwsh installer/test/install-test.ps1 -Setup installer/out/Nightjar-Setup-x.y.z.exe -Out test-out
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Out = "test-out",
    [string]$Repo = "lunice-dev/nightjar"
)
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

function Say($text) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $text" }

function Check($name, [bool]$ok, $detail = "") {
    $results.Add([pscustomobject]@{ Check = $name; Result = $(if ($ok) { "pass" } else { "FAIL" }); Detail = $detail })
    Say ("{0} {1}{2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $(if ($detail) { " - $detail" } else { "" }))
    # Annotations show on the run's page without signing in to GitHub; the log needs a sign-in.
    if (-not $ok -and $env:GITHUB_ACTIONS) { Write-Host "::error title=$name::$(Flat $detail)" }
}

function Note($name, $detail) {
    $results.Add([pscustomobject]@{ Check = $name; Result = "warn"; Detail = $detail })
    Say "WARN $name - $detail"
    if ($env:GITHUB_ACTIONS) { Write-Host "::warning title=$name::$(Flat $detail)" }
}

function Flat($text) { ("$text" -replace "\s+", " ").Trim() }

# The helper only answers the Nightjar page's own origin, from this PC.
function Helper($path, $method = "GET", $body = $null) {
    $req = @{ Uri = "http://127.0.0.1:5031$path"; Method = $method; Headers = @{ Origin = "http://127.0.0.1:5030" }; TimeoutSec = 15 }
    if ($null -ne $body) { $req.Body = ($body | ConvertTo-Json -Compress); $req.ContentType = "application/json" }
    Invoke-RestMethod @req
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

# A published release's installer, checked against its .sha256 like the updater does.
function Release($tag) {
    $v = $tag.TrimStart("v")
    $file = Join-Path $env:RUNNER_TEMP "Nightjar-Setup-$v.exe"
    $base = "https://github.com/$Repo/releases/download/$tag/Nightjar-Setup-$v.exe"
    Invoke-WebRequest $base -OutFile $file -UseBasicParsing
    # Saved and read as text: GitHub serves it as binary, so .Content would be bytes.
    Invoke-WebRequest "$base.sha256" -OutFile "$file.sha256" -UseBasicParsing
    $expected = [regex]::Match((Get-Content "$file.sha256" -Raw), "[0-9a-fA-F]{64}").Value
    if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $expected) { throw "$tag installer doesn't match its checksum" }
    return $file
}

function Installed { (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nightjar" -ErrorAction SilentlyContinue).DisplayVersion }

Say "Testing Nightjar $Version from $Setup"
try {
Reset

# --- 1. clean install, first start, quit -------------------------------------------------
$code = RunSetup $Setup "/S"
Check "Clean install: installer finished" ($code -eq 0) "exit code $code"
$missing = @("Nightjar.exe", "slskd\slskd.exe", "slskd\nightjar-web\index.html", "tools\flac.exe", "WebView2Loader.dll", "Uninstall Nightjar.exe") | Where-Object { -not (Test-Path (Join-Path $Dir $_)) }
Check "Clean install: all program files are there" ($missing.Count -eq 0) ($missing -join ", ")
Check "Clean install: Windows lists version $Version" ((Installed) -eq $Version) "listed: $(Installed)"
Check "Clean install: Start menu shortcut" (Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Nightjar.lnk"))

StartNightjar
Check "First start: helper answers" ([bool](WaitFor 60 { (Helper "/ping").ok }))
Check "First start: engine up and signed in" (EngineReady)
# nightjar.json only appears once a setting is changed; the engine's config is written on the first start.
Check "First start: engine config written" (Test-Path (Join-Path $Data "slskd.yml"))
$u = Helper "/update"
Check "First start: reports version $Version" ($u.current -eq $Version) "reports $($u.current)"

# --- 2. Tailscale, on a PC that never had it --------------------------------------------
if ((Helper "/remote/status").tailscale.installed) {
    Note "Tailscale install" "this runner already has Tailscale, so the install step wasn't tested"
}
else {
    Helper "/tailscale/install" "POST" | Out-Null
    $job = WaitFor 600 { $j = (Helper "/remote/status").install; if ($j.finished) { $j } }
    Check "Tailscale: Nightjar downloaded, checked and installed it" ($job -and $job.step -eq "done") "step: $($job.step) $($job.error)"
    $st = WaitFor 60 { $s = (Helper "/remote/status?fresh=1").tailscale; if ($s.installed) { $s } }
    Check "Tailscale: Nightjar sees it installed" ([bool]$st) "backend: $($st.backend)"
    $log = Get-Content (Join-Path $Data "logs\nightjar.log") -Raw -ErrorAction SilentlyContinue
    Check "Tailscale: installer's signature was checked first" ($log -match "Installing Tailscale from tailscale-setup-")
}

StopNightjar
Check "Quit: Nightjar and the engine stopped" (-not (Running "Nightjar") -and -not (Running "slskd"))
SaveLogs "1-clean-install"

# --- 3. uninstall ------------------------------------------------------------------------
# The uninstaller copies itself elsewhere and returns at once, so wait for its work instead.
Start-Process -FilePath (Join-Path $Dir "Uninstall Nightjar.exe") -ArgumentList "/S" | Out-Null
$gone = WaitFor 120 { -not (Test-Path (Join-Path $Dir "Nightjar.exe")) -and -not (Installed) }
Check "Uninstall: program removed" ([bool]$gone)
Check "Uninstall: settings kept (the silent answer is No)" (Test-Path (Join-Path $Data "slskd.yml"))

# --- 4. update from 0.7.0, as the updater runs it ---------------------------------------
Reset
$old = Release "v0.7.0"
$code = RunSetup $old "/S"
Check "Update from 0.7.0: 0.7.0 installed" ($code -eq 0 -and (Installed) -eq "0.7.0")
StartNightjar
Check "Update from 0.7.0: 0.7.0 runs" (EngineReady)
$yml = Get-Content (Join-Path $Data "slskd.yml") -Raw
"kept across the update" | Set-Content (Join-Path $Data "ci-sentinel.txt")

$code = RunSetup $Setup "/S /update"
Check "Update from 0.7.0: installer finished" ($code -eq 0) "exit code $code"
Check "Update from 0.7.0: Windows lists version $Version" ((Installed) -eq $Version) "listed: $(Installed)"
Check "Update from 0.7.0: Nightjar opened again by itself" ([bool](WaitFor 60 { (Helper "/update").current -eq $Version }))
Check "Update from 0.7.0: engine up with the old login" (EngineReady)
Check "Update from 0.7.0: data folder kept" (Test-Path (Join-Path $Data "ci-sentinel.txt"))
$auth = { param($t) [regex]::Match($t, "(?ms)^\s*authentication:.*?password:\s*(\S+)").Groups[1].Value }
Check "Update from 0.7.0: engine login unchanged" ((& $auth $yml) -ne "" -and (& $auth $yml) -eq (& $auth (Get-Content (Join-Path $Data "slskd.yml") -Raw)))
SaveLogs "4-update-from-0.7.0"

# --- 5. the built-in updater, 0.8.0 -> latest release ------------------------------------
Reset
$code = RunSetup (Release "v0.8.0") "/S"
StartNightjar
if ($code -ne 0 -or -not (EngineReady)) { Check "Updater: 0.8.0 installed and running" $false }
else {
    $u = Helper "/update?check=1"
    if ($u.error -match "403|rate limit") {
        # Many runners share GitHub's limit for unsigned-in API requests.
        Note "Updater" "GitHub's API limit was reached on this runner, so the updater wasn't tested: $($u.error)"
    }
    else {
        Check "Updater: finds the latest release" ([bool]$u.available) "latest: $($u.latest) $($u.error)"
        if ($u.available) {
            $latest = $u.latest
            Helper "/update/install" "POST" | Out-Null
            # Downloads, checks the checksum and signature, runs the installer, which opens Nightjar again.
            $done = WaitFor 300 { (Helper "/update").current -eq $latest }
            Check "Updater: installed $latest and Nightjar came back" ([bool]$done) "listed: $(Installed)"
            if (-not $done) { try { Note "Updater state" ((Helper "/update") | ConvertTo-Json -Compress) } catch { } }
        }
    }
}
SaveLogs "5-updater"
}
catch {
    # Something the test didn't expect (a step that never finished, a helper that stopped answering).
    Check "Test ran to the end" $false "$($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
    SaveLogs "stopped"
}
finally { StopNightjar }

# --- summary -----------------------------------------------------------------------------
$table = "| Check | Result | Detail |`n|---|---|---|`n" + (($results | ForEach-Object { "| $($_.Check) | $($_.Result) | $($_.Detail -replace '\|', '/') |" }) -join "`n")
if ($env:GITHUB_STEP_SUMMARY) { "## Nightjar $Version install test`n`n$table" | Add-Content $env:GITHUB_STEP_SUMMARY }
$failed = @($results | Where-Object Result -eq "FAIL")
Say "$($results.Count) checks, $($failed.Count) failed"
if ($failed.Count -gt 0) { exit 1 }
