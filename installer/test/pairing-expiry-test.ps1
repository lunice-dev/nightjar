# Checks that a pairing code stops working after its 10 minutes, the only way that's honest: by waiting them.
# It runs as a job of its own beside the others, so the rest of the results don't wait for it.
# Never run this on a PC that has Nightjar: it replaces %LOCALAPPDATA%\Programs\Nightjar and deletes its data.
#   powershell installer/test/pairing-expiry-test.ps1 -Setup installer/out/Nightjar-Setup-x.y.z.exe -Out test-out
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Out = "test-out"
)
. (Join-Path $PSScriptRoot "common.ps1")

$R = "http://127.0.0.1:5032"
function Pair($secret, $name = "Test phone") { Call "$R/pair" "POST" @{ secret = $secret; name = $name } }

Say "Testing pairing code expiry in Nightjar $Version"
try {
FreshNightjar
$shown = Helper "/remote/code"
Check "A code is shown, valid for 10 minutes" ($shown.code -and ([datetime]$shown.expires - (Get-Date).ToUniversalTime()).TotalMinutes -gt 9.5) "expires $($shown.expires)"
Say "Waiting 10 minutes and 15 seconds for it to expire"
Start-Sleep -Seconds 615
$late = Pair $shown.code
Check "After 10 minutes the code no longer signs a phone in" ($late.status -eq 401) "status $($late.status)"
$fresh = Pair (Helper "/remote/code").code
Check "A new code still works" ($fresh.status -eq 200 -and $fresh.json.token) "status $($fresh.status)"
SaveLogs "pairing-expiry"
}
catch {
    Check "Test ran to the end" $false "$($_.Exception.Message) at $(Split-Path -Leaf $_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)"
    SaveLogs "pairing-expiry-stopped"
}
finally { StopNightjar }

Finish "Nightjar $Version pairing code expiry"
