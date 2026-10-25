# Checks Check quality's verdicts on music made to order, where the right answer is known:
# real lossless and hi-res, FLACs made from 128 and 320 kbps sources, hi-res made from a CD master, 24-bit that is
# 16-bit inside, a damaged file, an album with one bad track, and MP3s (honest, and re-encoded from a worse one).
# The sound is many tones up to a chosen frequency and none above, which is what a lossy encoder's filter leaves.
# Never run this on a PC that has Nightjar: it replaces %LOCALAPPDATA%\Programs\Nightjar and deletes its data.
#   powershell installer/test/quality-test.ps1 -Setup installer/out/Nightjar-Setup-x.y.z.exe -Out test-out
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Out = "test-out"
)
. (Join-Path $PSScriptRoot "common.ps1")

Add-Type -TypeDefinition @"
using System;
using System.IO;
public static class NjSignal
{
    // A WAV of tones spaced every 40 Hz from 40 Hz up to topHz, nothing above. fake24: 16-bit sound in a 24-bit file.
    public static void Wav(string path, int rate, int bits, double seconds, double topHz, bool fake24)
    {
        int count = (int)(topHz / 40);
        var rnd = new Random(7);
        var c = new double[count]; var s = new double[count]; var cr = new double[count]; var sr = new double[count];
        for (int k = 0; k < count; k++)
        {
            double f = 40 * (k + 1), ph = rnd.NextDouble() * 2 * Math.PI, w = 2 * Math.PI * f / rate;
            c[k] = Math.Cos(ph); s[k] = Math.Sin(ph); cr[k] = Math.Cos(w); sr[k] = Math.Sin(w);
        }
        double amp = 0.25 / Math.Sqrt(count);
        int frames = (int)(rate * seconds), bytes = bits / 8;
        using (var f = new BinaryWriter(File.Create(path)))
        {
            int data = frames * 2 * bytes;
            f.Write(new[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' }); f.Write(36 + data);
            f.Write(new[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E', (byte)'f', (byte)'m', (byte)'t', (byte)' ' });
            f.Write(16); f.Write((short)1); f.Write((short)2); f.Write(rate); f.Write(rate * 2 * bytes); f.Write((short)(2 * bytes)); f.Write((short)bits);
            f.Write(new[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' }); f.Write(data);
            for (int i = 0; i < frames; i++)
            {
                double x = 0;
                for (int k = 0; k < count; k++)
                {
                    x += s[k];
                    double nc = c[k] * cr[k] - s[k] * sr[k];
                    s[k] = c[k] * sr[k] + s[k] * cr[k];
                    c[k] = nc;
                }
                x *= amp;
                for (int ch = 0; ch < 2; ch++)
                {
                    if (bits == 16) f.Write((short)Math.Round(x * 32767));
                    else
                    {
                        int v = fake24 ? (int)Math.Round(x * 32767) << 8 : (int)Math.Round(x * 8388607);
                        f.Write((byte)(v & 0xFF)); f.Write((byte)((v >> 8) & 0xFF)); f.Write((byte)((v >> 16) & 0xFF));
                    }
                }
            }
        }
    }
}
"@

$Work = Join-Path $env:RUNNER_TEMP "nj-quality"

# An album folder of $tracks FLACs (or MP3s) with sound up to $top Hz.
function Album($name, $rate, $bits, $top, $tracks = 2, [switch]$fake24, [switch]$mp3, $kbps = 320) {
    $folder = Join-Path $Work $name
    New-Item -ItemType Directory -Force $folder | Out-Null
    for ($i = 1; $i -le $tracks; $i++) {
        $wav = Join-Path $env:RUNNER_TEMP ("nj-q-" + [guid]::NewGuid().ToString("N") + ".wav")
        [NjSignal]::Wav($wav, $rate, $bits, 4.0, $top, [bool]$fake24)
        $dest = Join-Path $folder ("{0:D2} Track.{1}" -f $i, $(if ($mp3) { "mp3" } else { "flac" }))
        if ($mp3) { Mp3 $wav $dest $kbps }
        else { & (Join-Path $Dir "tools\flac.exe") -s -f -o $dest $wav | Out-Null }
        Remove-Item $wav
        if (-not (Test-Path $dest)) { throw "couldn't make $dest" }
    }
    $folder
}

# MP3s come from Windows' own encoder (Media Foundation), through the NAudio Nightjar ships.
$script:Mp3Ready = $null
function Mp3($wav, $dest, $kbps) {
    if ($null -eq $script:Mp3Ready) {
        Add-Type -Path (Join-Path $Dir "NAudio.Core.dll")
        Add-Type -Path (Join-Path $Dir "NAudio.Wasapi.dll")
        [NAudio.MediaFoundation.MediaFoundationApi]::Startup()
        $script:Mp3Ready = $true
    }
    $reader = New-Object NAudio.Wave.WaveFileReader($wav)
    try { [NAudio.Wave.MediaFoundationEncoder]::EncodeToMp3($reader, $dest, $kbps * 1000) } finally { $reader.Dispose() }
}

function Check-Quality($folder) {
    $id = (Helper "/validate" "POST" @{ dir = $folder }).id
    $job = WaitFor 300 { $j = Helper "/validate?id=$id"; if ($j.finished) { $j } }
    if (-not $job) { throw "Check quality didn't finish on $folder" }
    $job
}

function Expect($label, $folder, $verdict, $trackVerdicts = $null) {
    $job = Check-Quality $folder
    $got = $job.album.verdict
    $tracks = @($job.tracks | ForEach-Object { $_.verdict })
    $ok = $got -eq $verdict -and (-not $trackVerdicts -or (($tracks | Sort-Object) -join ",") -eq (($trackVerdicts | Sort-Object) -join ","))
    $detail = "album: $got (expected $verdict); tracks: $($tracks -join ', '); cut-offs: $(($job.tracks | ForEach-Object { [math]::Round($_.cutoff) }) -join ', ') Hz $($job.error)"
    Check $label $ok $detail
}

Say "Testing Check quality of Nightjar $Version"
try {
FreshNightjar
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }

Expect "Real CD-quality FLAC is lossless" (Album "lossless" 44100 16 21500) "Verified lossless" @("Lossless", "Lossless")
Expect "FLAC made from a 128 kbps MP3 is caught" (Album "from-128" 44100 16 16500) "Lossy source"
Expect "FLAC made from a 320 kbps MP3 is suspicious" (Album "from-320" 44100 16 20150) "Suspicious"
Expect "Real hi-res is verified" (Album "true-hires" 96000 24 40000) "Verified hi-res" @("True hi-res", "True hi-res")
Expect "Hi-res made from a CD master is caught" (Album "upsampled" 96000 24 21500) "Upsampled"
Expect "24-bit that is 16-bit inside is caught" (Album "fake-24" 44100 24 21500 -fake24) "Fake 24-bit"

# Damaged: a few bytes in the middle of one track's music changed.
$dmg = Album "damaged" 44100 16 21500
$victim = (Get-ChildItem $dmg -File | Select-Object -First 1).FullName
$bytes = [IO.File]::ReadAllBytes($victim)
$at = [int]($bytes.Length * 0.6)
for ($i = 0; $i -lt 64; $i++) { $bytes[$at + $i] = $bytes[$at + $i] -bxor 0x5A }
[IO.File]::WriteAllBytes($victim, $bytes)
Expect "A damaged FLAC is caught" $dmg "Corrupt" @("Corrupt", "Lossless")

# One bad track among good ones: the album is "Mostly fine", naming it.
$mixed = Album "mixed" 44100 16 21500 3
$wav = Join-Path $env:RUNNER_TEMP "nj-q-mixed.wav"
[NjSignal]::Wav($wav, 44100, 16, 4.0, 16500, $false)
& (Join-Path $Dir "tools\flac.exe") -s -f -o (Join-Path $mixed "03 Track.flac") $wav | Out-Null
Expect "One bad track of three: mostly fine" $mixed "Mostly fine" @("Lossless", "Lossless", "Lossy source")

# MP3s, when this Windows has its MP3 encoder.
$honest = $null
try { $honest = Album "mp3-320" 44100 16 21500 -mp3 -kbps 320 } catch { Note "MP3 checks" "This Windows can't make MP3s ($($_.Exception.Message)), so they weren't tested." }
if ($honest) {
    Expect "An honest 320 kbps MP3 passes" $honest "MP3 320 kbps"
    Expect "A 320 kbps MP3 re-encoded from a 128 kbps one is caught" (Album "mp3-upconverted" 44100 16 16000 -mp3 -kbps 320) "Upconverted"
}
# "Use less data": the AAC copies a phone gets. 25 Oct: every 24/96 track failed ("Input must be PCM or IEEE float"),
# and so did FLACs ending in an old ID3v1 tag, which flac.exe decodes whole but then deletes the file it wrote.
Helper "/library" "POST" @{ root = $Work } | Out-Null   # Nightjar only streams from music folders
$key = (Helper "/img-key").key
function LessData($file) { Call "http://127.0.0.1:5031/stream?path=$([uri]::EscapeDataString($file))&k=$key&aac=128" "GET" $null @{ Origin = $LocalOrigin } }
function IsM4a($r) { $r.status -eq 200 -and $r.length -gt 10000 -and $r.text.Substring(4, 4) -eq "ftyp" }
$hires = (Get-ChildItem (Join-Path $Work "true-hires") -File | Select-Object -First 1).FullName
$r = LessData $hires
Check "Use less data: a 24/96 track gets an AAC copy" (IsM4a $r) "status $($r.status), $($r.length) bytes"
$tagged = Join-Path $Work "id3v1\01 Track.flac"
New-Item -ItemType Directory -Force (Split-Path $tagged) | Out-Null
Copy-Item (Get-ChildItem (Join-Path $Work "lossless") -File | Select-Object -First 1).FullName $tagged
$tail = New-Object byte[] 128
[Text.Encoding]::ASCII.GetBytes("TAGOld tagger title").CopyTo($tail, 0)
$fsT = [IO.File]::Open($tagged, "Append"); $fsT.Write($tail, 0, 128); $fsT.Close()
$r = LessData $tagged
Check "Use less data: a FLAC with an old ID3v1 tag at the end gets an AAC copy" (IsM4a $r) "status $($r.status), $($r.length) bytes"
$left = @(Get-ChildItem (Join-Path $Data "stream-cache") -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -ne ".m4a" })
Check "Use less data: no decoded leftovers in the cache" ($left.Count -eq 0) (($left | ForEach-Object { $_.Name }) -join ", ")
SaveLogs "quality"
}
catch {
    Check "Test ran to the end" $false "$($_.Exception.Message) at $(Split-Path -Leaf $_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)"
    SaveLogs "quality-stopped"
}
finally { StopNightjar }

Finish "Nightjar $Version Check quality"
