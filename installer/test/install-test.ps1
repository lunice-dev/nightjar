# Installs Nightjar on a fresh Windows (a GitHub Actions runner) and checks what testers go through:
#   1. a clean install, the first start and a clean quit
#   2. Tailscale installed by Nightjar on a PC that never had it
#   3. uninstalling (the data folder stays)
#   4. an update from 0.7.0, run the way Nightjar's updater runs it (/S /update): settings stay
#   5. Nightjar's own updater, from 0.8.0 to the latest release (download, checksum, signature, install)
# Never run this on a PC that has Nightjar: it replaces %LOCALAPPDATA%\Programs\Nightjar and deletes its data.
#   powershell installer/test/install-test.ps1 -Setup installer/out/Nightjar-Setup-x.y.z.exe -Out test-out
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Out = "test-out",
    [string]$Repo = "lunice-dev/nightjar"
)
. (Join-Path $PSScriptRoot "common.ps1")

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

Say "Testing Nightjar $Version from $Setup"
try {
Reset

# --- 1. clean install, first start, quit -------------------------------------------------
$code = RunSetup $Setup "/S"
Check "Clean install: installer finished" ($code -eq 0) "exit code $code"
$missing = @("Nightjar.exe", "slskd\slskd.exe", "slskd\LICENSE", "slskd\NOTICE", "slskd\nightjar-web\index.html", "tools\flac.exe", "WebView2Loader.dll", "LICENSE.txt", "NOTICE.txt", "Uninstall Nightjar.exe") | Where-Object { -not (Test-Path (Join-Path $Dir $_)) }
Check "Clean install: all program files are there" ($missing.Count -eq 0) ($missing -join ", ")
Check "Clean install: Windows lists version $Version" ((Installed) -eq $Version) "listed: $(Installed)"
Check "Clean install: Start menu shortcut" (Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Nightjar.lnk"))

# Started as from a PowerShell 7 window, whose module path Windows PowerShell can't use: Nightjar's check of
# Tailscale's signature runs Windows PowerShell and must still work (it failed this way on 25 Oct).
$pwshModules = "C:\Program Files\PowerShell\7\Modules"
$savedPath = $env:PSModulePath
if (Test-Path $pwshModules) { $env:PSModulePath = "$pwshModules;$savedPath" }
StartNightjar
$env:PSModulePath = $savedPath
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
    Check "Test ran to the end" $false "$($_.Exception.Message) at $(Split-Path -Leaf $_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)"
    SaveLogs "stopped"
}
finally { StopNightjar }

Finish "Nightjar $Version install test"
