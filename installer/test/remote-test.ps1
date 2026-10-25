# Checks remote access the way a phone reaches Nightjar: through the helper's door for other devices
# (127.0.0.1:5032, where Tailscale Serve sends /nj). No Tailscale is needed for that.
#   - nothing without a device token; tokens kept only as hashes
#   - a pairing code works once; wrong tries lock pairing for a while, even for the right code
#   - a phone can't do what only the PC may (Quit, the remote access setup, Windows dialogs, the library folder)
#   - music and pictures only from the library, Downloads and shares, never Nightjar's settings or the rest of the PC
#   - Remove and "Sign out all devices" end access at once
#   - the remote password signs a device in only once the person has chosen it
# Never run this on a PC that has Nightjar: it replaces %LOCALAPPDATA%\Programs\Nightjar and deletes its data.
#   powershell installer/test/remote-test.ps1 -Setup installer/out/Nightjar-Setup-x.y.z.exe -Out test-out
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Out = "test-out"
)
. (Join-Path $PSScriptRoot "common.ps1")

$R = "http://127.0.0.1:5032"

function Q($s) { [uri]::EscapeDataString($s) }

function Phone($path, $token, $method = "GET", $body = $null) {
    $h = @{}
    if ($token) { $h["X-Nightjar-Device"] = $token }
    Call "$R$path" $method $body $h
}

function Pair($secret, $name = "Test phone") { Call "$R/pair" "POST" @{ secret = $secret; name = $name } }

function NewCode { (Helper "/remote/code").code }

Say "Testing remote access of Nightjar $Version"
try {
FreshNightjar

$Lib = Join-Path $env:USERPROFILE "nj-remote-library"
if (Test-Path $Lib) { Remove-Item $Lib -Recurse -Force }
MakeAlbum "$Lib\FLAC\Test Artist\2020 - Test Album" @{ albumArtist = "Test Artist"; album = "Test Album"; year = 2020 } 1
$Track = (Get-ChildItem "$Lib\FLAC\Test Artist\2020 - Test Album" -File | Select-Object -First 1).FullName
Helper "/library" "POST" @{ root = $Lib } | Out-Null
$yml = Get-Content (Join-Path $Data "slskd.yml") -Raw -Encoding UTF8
$enginePassword = [regex]::Match($yml, "(?ms)^\s*authentication:.*?password:\s*'?([^'\r\n]+)'?").Groups[1].Value

# --- nothing without a token ---------------------------------------------------------------
Check "No token: ping answers (the page checks it can reach Nightjar)" ((Phone "/ping").status -eq 200)
Check "No token: the library is refused" ((Phone "/library").status -eq 401)
Check "No token: refused under /nj too (the Tailscale address)" ((Phone "/nj/library").status -eq 401)
Check "No token: settings are refused" ((Phone "/prefs").status -eq 401)
Check "Made-up token: refused" ((Phone "/library" "made-up-token").status -eq 401)
$prefsBefore = (Helper "/prefs").prefs
try { $big = Phone "/prefs" $null "POST" ("{""x"":""" + ("a" * 2000000) + """}"); $bigStatus = $big.status } catch { $bigStatus = "closed" }
Check "No token: a large upload is refused without being read" (($bigStatus -eq 401 -or $bigStatus -eq "closed") -and (Helper "/prefs").prefs -eq $prefsBefore) "status $bigStatus"
# Nightjar answers 413 and closes at once, often before the request is even sent: either counts as refused.
try { $hugeStatus = (Call "$R/pair" "POST" ("{""secret"":""" + ("a" * 10000) + """}")).status } catch { $hugeStatus = "closed" }
Check "Pairing: an oversized request is refused" (($hugeStatus -eq 413 -or $hugeStatus -eq "closed") -and (Phone "/ping").status -eq 200) "status $hugeStatus"

# --- pairing --------------------------------------------------------------------------------
$p = Pair $enginePassword
Check "Password: the engine's login doesn't sign a device in until the person chooses a password" ($p.status -eq 401) "status $($p.status)"
$code = NewCode
$p1 = Pair $code
Check "Code: signs a phone in" ($p1.status -eq 200 -and $p1.json.token) "status $($p1.status)"
$t1 = $p1.json.token
$again = Pair $code "Second phone"
Check "Code: works only once" ($again.status -eq 401) "status $($again.status)"
$devices = Get-Content (Join-Path $Data "devices.json") -Raw
Check "Devices file keeps only a hash of the token" ($devices -notmatch [regex]::Escape($t1) -and $devices -match "Test phone")

# --- what a signed-in phone may and may not do ----------------------------------------------
$lib = Phone "/library" $t1
Check "Phone: sees the library" ($lib.status -eq 200 -and $lib.json.root -eq $Lib) "status $($lib.status)"
$set = Phone "/library" $t1 "POST" @{ root = "C:\" }
Check "Phone: can't change the library folder" ($set.status -eq 403 -and (Helper "/library").root -eq $Lib) "status $($set.status)"
$pcOnly = "/quit", "/show", "/remote/code", "/remote/lan", "/tailscale/install", "/tailscale/login", "/tailscale/serve", "/tailscale/test", "/reveal", "/pick-folder", "/pick-image", "/image", "/upnp", "/firewall"
$let = @($pcOnly | Where-Object { (Phone $_ $t1 "POST" @{}).status -ne 403 })
Check "Phone: everything only the PC may do is refused" ($let.Count -eq 0) "allowed: $($let -join ', ')"
Check "Phone: Quit from the phone didn't stop Nightjar" ((Helper "/ping").ok -and (Running "Nightjar"))

# --- music and pictures -----------------------------------------------------------------
$key = (Phone "/img-key" $t1).json.key
Check "Phone: gets its own key for music and pictures" ([bool]$key)
$s = Call "$R/stream?path=$(Q $Track)&k=$key"
Check "Music: a track from the library plays" ($s.status -eq 200 -and $s.length -eq (Get-Item $Track).Length) "status $($s.status), $($s.length) bytes"
$part = Call "$R/stream?path=$(Q $Track)&k=$key" "GET" $null @{} @(0, 99)
Check "Music: part of a track (what the iPhone asks for)" ($part.status -eq 206 -and $part.length -eq 100) "status $($part.status), $($part.length) bytes"
Check "Music: no key, no music" ((Call "$R/stream?path=$(Q $Track)").status -eq 403)
Check "Music: a made-up key, no music" ((Call "$R/stream?path=$(Q $Track)&k=made-up").status -eq 403)
$win = Join-Path $env:WINDIR "win.ini"
Check "Music: files elsewhere on the PC are refused" ((Call "$R/stream?path=$(Q $win)&k=$key").status -eq 403)
Check "Music: ..\ can't climb out of the library" ((Call "$R/stream?path=$(Q "$Lib\..\..\..\Windows\win.ini")&k=$key").status -eq 403)
$cfg = Join-Path $Data "slskd.yml"
$leaks = @((Call "$R/stream?path=$(Q $cfg)&k=$key"), (Call "$R/img?path=$(Q $cfg)&k=$key"), (Call "$R/cover?dir=$(Q $Data)&k=$key")) | Where-Object { $_.text -match [regex]::Escape($enginePassword) -or $_.text -match "authentication" }
Check "Pictures and music never hand out Nightjar's settings" ($leaks.Count -eq 0)
Check "Covers: folders elsewhere on the PC are refused" ((Call "$R/cover?dir=$(Q $env:WINDIR)&k=$key").status -eq 403)

# --- ending access ----------------------------------------------------------------------
$rm = Helper "/remote/device" "POST" @{ id = $p1.json.id; action = "remove" }
Check "Remove: done" ([bool]$rm.ok)
Check "Remove: the phone's token stops working at once" ((Phone "/library" $t1).status -eq 401)
Check "Remove: its music key stops working at once" ((Call "$R/stream?path=$(Q $Track)&k=$key").status -eq 403)
EngineReady | Out-Null   # removing a device restarts the engine, ending its sessions there

$tA = (Pair (NewCode) "Phone A").json.token
$tB = (Pair (NewCode) "Phone B").json.token
$unused = NewCode
$so = Helper "/remote/signout-all" "POST" @{}
Check "Sign out all: done" ([bool]$so.ok)
Check "Sign out all: every device is out" ((Phone "/library" $tA).status -eq 401 -and (Phone "/library" $tB).status -eq 401 -and @((Helper "/remote/status").devices).Count -eq 0)
Check "Sign out all: a code shown before no longer works" ((Pair $unused).status -eq 401)
EngineReady | Out-Null

# --- the remote password -------------------------------------------------------------------
$short = Helper "/remote/password" "POST" @{ password = "short" }
Check "Password: fewer than 8 characters refused" (-not $short.ok) $short.error
$chosen = "nightjar test " + [guid]::NewGuid().ToString("N").Substring(0, 8)
$set = Helper "/remote/password" "POST" @{ password = $chosen }
Check "Password: chosen" ([bool]$set.ok) $set.error
Check "Password: the engine restarts and takes it" (EngineReady)
$pp = Pair $chosen "Other computer"
Check "Password: signs a device in once chosen" ($pp.status -eq 200 -and $pp.json.token) "status $($pp.status)"
Check "Password: a wrong one doesn't" ((Pair ($chosen + "x")).status -eq 401)

# --- too many wrong tries ------------------------------------------------------------------
# Last, because pairing then stays locked for a while. Wrong tries count for everyone together.
$right = NewCode
$lockedAfter = $null
for ($i = 1; $i -le 8 -and -not $lockedAfter; $i++) { if ((Pair "WRONG$i").status -eq 429) { $lockedAfter = $i } }
Check "Lockout: pairing locks after a few wrong tries" ($lockedAfter -and $lockedAfter -le 6) "locked at try $lockedAfter"
$r = Pair $right
Check "Lockout: while locked, even the right code is refused" ($r.status -eq 429 -and $r.json.wait -gt 0) "status $($r.status), wait $($r.json.wait) s"
SaveLogs "remote"
}
catch {
    Check "Test ran to the end" $false "$($_.Exception.Message) at $(Split-Path -Leaf $_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)"
    SaveLogs "remote-stopped"
}
finally { StopNightjar }

Finish "Nightjar $Version remote access"
