# Checks the two things in Nightjar that move people's music, on a made-up library of generated FLAC files:
#   Tidy library (a whole library reviewed, applied and undone) and the organiser (a download put into the library).
# The rules come from Lunice's decisions: never overwrite, never merge two albums (the second gets " (2)"),
# what Nightjar already tidied never moves again, group folders stay, every move can be undone exactly,
# and Delete only ever takes an album folder.
# Never run this on a PC that has Nightjar: it replaces %LOCALAPPDATA%\Programs\Nightjar and deletes its data.
#   powershell installer/test/library-test.ps1 -Setup installer/out/Nightjar-Setup-x.y.z.exe -Out test-out
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Out = "test-out"
)
. (Join-Path $PSScriptRoot "common.ps1")

# Names in other scripts and with accents, written as character codes so the file stays plain ASCII.
$Bjork = "Bj" + [char]0xF6 + "rk"
$AnriKanji = [string][char]0x674F + [char]0x91CC
$MariyaKanji = -join ([char[]](0x7AF9, 0x5185, 0x307E, 0x308A, 0x3084))

function Q($s) { [uri]::EscapeDataString($s) }

function Scan {
    $id = (Helper "/library/scan" "POST").id
    $job = WaitFor 180 { $j = Helper "/library/scan?id=$id"; if ($j.finished) { $j } }
    if (-not $job) { throw "the library review didn't finish" }
    if ($job.error) { throw "the library review failed: $($job.error)" }
    @($job.albums)
}

function At($albums, $rel) { $albums | Where-Object { $_.rel -eq $rel } | Select-Object -First 1 }

function Apply($moves) {
    $start = Helper "/library/apply" "POST" @{ moves = @($moves) }
    $job = WaitFor 180 { $j = Helper "/library/apply?id=$($start.id)"; if ($j.finished) { $j } }
    if (-not $job) { throw "applying the moves didn't finish" }
    $job
}

function MoveOf($a, $artist = $null) { @{ dir = $a.dir; format = $a.format; artist = $(if ($artist) { $artist } else { $a.artist }); folder = $a.folder; group = $a.group } }

# Exact name on disk, capitals included (Test-Path doesn't care about capitals).
function NameOnDisk($path) {
    $parent = Split-Path $path
    $leaf = Split-Path $path -Leaf
    if (-not (Test-Path -LiteralPath $parent)) { return $null }
    (Get-ChildItem -LiteralPath $parent -Directory | Where-Object { $_.Name -eq $leaf } | Select-Object -First 1).Name
}

Say "Testing the library tools of Nightjar $Version"
try {
FreshNightjar

# On the same drive as Downloads, like most people's. (Another drive means the Recycle Bin there, which a runner's
# temporary D: may not have: Windows would then ask in a dialog nobody can answer.)
$Lib = Join-Path $env:USERPROFILE "nj-library"
if (Test-Path $Lib) { Remove-Item $Lib -Recurse -Force }
New-Item -ItemType Directory -Force $Lib | Out-Null
$Dl = DownloadDir
Say "Library: $Lib  Downloads: $Dl"
$r = Helper "/library" "POST" @{ root = $Lib }
Check "Library folder set" ([bool]$r.ok) $r.error

# --- the made-up library -------------------------------------------------------------------
# Not tidy yet: no format folder.
MakeAlbum "$Lib\Radiohead\In Rainbows (2007)" @{ albumArtist = "Radiohead"; artist = "Radiohead"; album = "In Rainbows"; year = 2007 } 2 16 44100 0.5
# Already tidy, and where the album above wants to go: the two must never be merged.
MakeAlbum "$Lib\FLAC\Radiohead\2007 - In Rainbows" @{ albumArtist = "Radiohead"; artist = "Radiohead"; album = "In Rainbows"; year = 2007 } 3 16 44100 0.7
# 24-bit in the FLAC folder: belongs in Hi-Res.
MakeAlbum "$Lib\FLAC\Daft Punk\2013 - Random Access Memories" @{ albumArtist = "Daft Punk"; artist = "Daft Punk"; album = "Random Access Memories"; year = 2013 } 2 24 96000 0.2
# Only the capitals of the folder are wrong.
MakeAlbum "$Lib\FLAC\$Bjork\1997 - homogenic" @{ albumArtist = $Bjork; artist = $Bjork; album = "Homogenic"; year = 1997 }
# Tidy.
MakeAlbum "$Lib\FLAC\Massive Attack\1998 - Mezzanine" @{ albumArtist = "Massive Attack"; artist = "Massive Attack"; album = "Mezzanine"; year = 1998 }
# No year anywhere: Nightjar must ask.
MakeAlbum "$Lib\FLAC\Portishead\Dummy" @{ albumArtist = "Portishead"; artist = "Portishead"; album = "Dummy" }
# Two discs of one album.
MakeAlbum "$Lib\FLAC\Pink Floyd\1979 - The Wall\CD1" @{ albumArtist = "Pink Floyd"; artist = "Pink Floyd"; album = "The Wall"; year = 1979 }
MakeAlbum "$Lib\FLAC\Pink Floyd\1979 - The Wall\CD2" @{ albumArtist = "Pink Floyd"; artist = "Pink Floyd"; album = "The Wall"; year = 1979 }
# A group folder with artists inside, tagged in Japanese: the folders' names win and the group stays.
MakeAlbum "$Lib\FLAC\JP City Pop\Anri\1983 - Timely!!" @{ albumArtist = $AnriKanji; artist = $AnriKanji; album = "Timely!!"; year = 1983 }
MakeAlbum "$Lib\FLAC\JP City Pop\Mariya Takeuchi\1984 - Variety" @{ albumArtist = $MariyaKanji; artist = $MariyaKanji; album = "Variety"; year = 1984 }
# Will be tidied under a name the person types; a later review must leave it there although the tags disagree.
MakeAlbum "$Lib\Loose\Nevermind" @{ albumArtist = "Nirvana"; artist = "Nirvana"; album = "Nevermind"; year = 1991 }
# A track loose in the library folder itself: only by hand.
MakeFlac "$Lib\stray track.flac" @{ artist = "Someone"; title = "Stray" }

$before = Snapshot $Lib
$beforeContents = Contents $Lib

# --- Tidy library: the review ------------------------------------------------------------
$albums = Scan
$a = At $albums "Radiohead\In Rainbows (2007)"
Check "Review: untidy album goes to FLAC\Artist\Year - Album" ($a.status -eq "move" -and $a.target -eq "$Lib\FLAC\Radiohead\2007 - In Rainbows") "$($a.status) -> $($a.target)"
$e = At $albums "FLAC\Radiohead\2007 - In Rainbows"
Check "Review: tidy album stays" ($e.status -eq "ok") $e.status
Check "Review: the two In Rainbows are shown as copies" ($a.dupKey -and $a.dupKey -eq $e.dupKey)
$hr = At $albums "FLAC\Daft Punk\2013 - Random Access Memories"
Check "Review: 24-bit album goes to Hi-Res" ($hr.status -eq "move" -and $hr.format -eq "Hi-Res" -and $hr.target -eq "$Lib\Hi-Res\Daft Punk\2013 - Random Access Memories") "$($hr.format) -> $($hr.target)"
$bj = At $albums "FLAC\$Bjork\1997 - homogenic"
Check "Review: wrong capitals get fixed" ($bj.status -eq "move" -and $bj.target -ceq "$Lib\FLAC\$Bjork\1997 - Homogenic") $bj.target
$ma = At $albums "FLAC\Massive Attack\1998 - Mezzanine"
Check "Review: tidy album isn't touched" ($ma.status -eq "ok") $ma.status
$pt = At $albums "FLAC\Portishead\Dummy"
Check "Review: album without a year asks for one" ($pt.status -eq "needsYear") $pt.status
$pf = At $albums "FLAC\Pink Floyd\1979 - The Wall"
Check "Review: disc folders are one album" ($pf.kind -eq "discs" -and $pf.status -eq "ok" -and -not (At $albums "FLAC\Pink Floyd\1979 - The Wall\CD1")) "$($pf.kind) $($pf.status)"
$an = At $albums "FLAC\JP City Pop\Anri\1983 - Timely!!"
Check "Review: group folder kept, artist folder's name wins over the tags" ($an.status -eq "ok" -and $an.group -eq "JP City Pop" -and $an.artist -eq "Anri") "$($an.status) group=$($an.group) artist=$($an.artist)"
$mt = At $albums "FLAC\JP City Pop\Mariya Takeuchi\1984 - Variety"
Check "Review: second artist in the group kept too" ($mt.status -eq "ok" -and $mt.artist -eq "Mariya Takeuchi") "$($mt.status) $($mt.artist)"
$nv = At $albums "Loose\Nevermind"
Check "Review: loose album found" ($nv.status -eq "move") $nv.status
$st = At $albums ""
Check "Review: tracks loose in the library are left for sorting by hand" ($st.status -eq "skip") $st.status
Check "Review: looking moved nothing" (Same $before (Snapshot $Lib))

# --- Tidy library: applying --------------------------------------------------------------
# What the person ticks: everything to move, with their own name for Nirvana.
$moves = @((MoveOf $a), (MoveOf $hr), (MoveOf $bj), (MoveOf $nv "Kurt Band"))
$job = Apply $moves
$bad = @($job.results | Where-Object { -not $_.ok })
Check "Apply: every move worked" ($bad.Count -eq 0 -and $job.done -eq 4) (($bad | ForEach-Object { $_.error }) -join "; ")
Check "Apply: never merges, the copy gets (2)" ((Test-Path "$Lib\FLAC\Radiohead\2007 - In Rainbows (2)") -and @(Get-ChildItem "$Lib\FLAC\Radiohead\2007 - In Rainbows" -File).Count -eq 3 -and @(Get-ChildItem "$Lib\FLAC\Radiohead\2007 - In Rainbows (2)" -File).Count -eq 2)
Check "Apply: the album already there is unchanged" (Same (Snapshot "$Lib\FLAC\Radiohead\2007 - In Rainbows") ($before | Where-Object { $_ -like "FLAC\Radiohead\2007 - In Rainbows\*" } | ForEach-Object { $_.Substring("FLAC\Radiohead\2007 - In Rainbows\".Length) }))
Check "Apply: Hi-Res album moved, empty folders left behind removed" ((Test-Path "$Lib\Hi-Res\Daft Punk\2013 - Random Access Memories") -and -not (Test-Path "$Lib\FLAC\Daft Punk"))
Check "Apply: capitals fixed" ((NameOnDisk "$Lib\FLAC\$Bjork\1997 - Homogenic") -ceq "1997 - Homogenic") (NameOnDisk "$Lib\FLAC\$Bjork\1997 - Homogenic")
Check "Apply: the name the person typed is used" (Test-Path "$Lib\FLAC\Kurt Band\1991 - Nevermind")
# Folders right under the library are never removed, even empty; nothing may be left in them though.
Check "Apply: nothing left behind in the old folders" (@(Get-ChildItem "$Lib\Loose", "$Lib\Radiohead" -Recurse -File -ErrorAction SilentlyContinue).Count -eq 0)
Check "Apply: no file lost or changed" (Same $beforeContents (Contents $Lib))

# A second look: nothing left to move. Above all Kurt Band stays, although its tags say Nirvana (the 22 Oct lesson).
$again = Scan
$kb = At $again "FLAC\Kurt Band\1991 - Nevermind"
Check "Second review: what Nightjar tidied never moves again" ($kb.status -eq "ok") "$($kb.status) -> $($kb.target)"
$still = @($again | Where-Object { $_.status -eq "move" })
Check "Second review: nothing else to move" ($still.Count -eq 0) (($still | ForEach-Object { $_.rel }) -join ", ")

# --- Tidy library: undo -------------------------------------------------------------------
$u = Helper "/library/undo" "POST" @{ batch = $job.batch }
Check "Undo: the whole batch went back" ([bool]$u.ok -and $u.undone -eq 4) "undone $($u.undone), failed: $(($u.failed | ForEach-Object { $_.error }) -join '; ')"
Check "Undo: library exactly as before, names and capitals included" (Same $before (Snapshot $Lib))
SaveLogs "library-tidy"

# --- Delete (Recycle Bin) only takes album folders ---------------------------------------
MakeAlbum "$Lib\FLAC\Test\2000 - Delete Me" @{ albumArtist = "Test"; album = "Delete Me"; year = 2000 } 1
Set-Content "$Lib\FLAC\Test\2000 - Delete Me\cover.jpg" "not really a picture"
MakeAlbum "$Lib\FLAC\Test\2001 - Not Only Music" @{ albumArtist = "Test"; album = "Not Only Music"; year = 2001 } 1
Set-Content "$Lib\FLAC\Test\2001 - Not Only Music\setup.exe" "a program"
$r = Helper "/library/recycle" "POST" @{ dir = "$Lib\FLAC" }
Check "Delete: refuses a whole format folder" (-not $r.ok -and (Test-Path "$Lib\FLAC\Massive Attack")) $r.error
$r = Helper "/library/recycle" "POST" @{ dir = "$Lib\FLAC\Test\2001 - Not Only Music" }
Check "Delete: refuses a folder with more than music" (-not $r.ok -and (Test-Path "$Lib\FLAC\Test\2001 - Not Only Music\setup.exe")) $r.error
$r = Helper "/library/recycle" "POST" @{ dir = (Split-Path $Lib) }
Check "Delete: refuses anything outside the library" (-not $r.ok) $r.error
$r = Helper "/library/recycle" "POST" @{ dir = "$Lib\FLAC\Test\2000 - Delete Me" }
Check "Delete: an album with its cover goes" ([bool]$r.ok -and -not (Test-Path "$Lib\FLAC\Test\2000 - Delete Me")) $r.error
Remove-Item "$Lib\FLAC\Test" -Recurse -Force

# --- the organiser: downloads into the library -------------------------------------------
$libBefore = Contents $Lib
$ok1 = "$Dl\Radiohead - OK Computer (1997) [FLAC]"
MakeAlbum $ok1 @{ albumArtist = "Radiohead"; artist = "Radiohead"; album = "OK Computer"; year = 1997 } 2 16 44100 0.4
$ok1Files = Contents $ok1
$waiting = @((Helper "/organize/waiting").albums)
Check "Organiser: the download is waiting" (@($waiting | Where-Object { $_.dir -eq $ok1 }).Count -eq 1)
$p = Helper "/organize/plan?dir=$(Q $ok1)"
Check "Organiser: reads artist, album, year and format from the files" ($p.artist -eq "Radiohead" -and $p.artistExists -and $p.album -eq "OK Computer" -and $p.year -eq "1997" -and $p.format -eq "FLAC") "$($p.artist) / $($p.album) / $($p.year) / $($p.format) exists=$($p.artistExists)"
$m1 = Helper "/organize/move" "POST" @{ dir = $ok1; format = $p.format; artist = $p.artist; folder = "$($p.year) - $($p.album)" }
Check "Organiser: moved into the artist's folder" ([bool]$m1.ok -and $m1.to -eq "$Lib\FLAC\Radiohead\1997 - OK Computer" -and -not (Test-Path $ok1)) "$($m1.to) $($m1.error)"
Check "Organiser: files arrived intact" (Same $ok1Files (Contents "$Lib\FLAC\Radiohead\1997 - OK Computer"))

# The same album downloaded again, identical: no second copy, the download goes to the Recycle Bin.
MakeAlbum $ok1 @{ albumArtist = "Radiohead"; artist = "Radiohead"; album = "OK Computer"; year = 1997 } 2 16 44100 0.4
$m2 = Helper "/organize/move" "POST" @{ dir = $ok1; format = "FLAC"; artist = "Radiohead"; folder = "1997 - OK Computer" }
Check "Organiser: an identical copy isn't added twice" ([bool]$m2.ok -and $m2.duplicate -and -not (Test-Path $ok1) -and -not (Test-Path "$Lib\FLAC\Radiohead\1997 - OK Computer (2)")) "duplicate=$($m2.duplicate)"

# A different copy of it: kept next to the first, never merged into it.
$ok3 = "$Dl\OK Computer other rip"
MakeAlbum $ok3 @{ albumArtist = "Radiohead"; artist = "Radiohead"; album = "OK Computer"; year = 1997 } 3 16 44100 0.3
$m3 = Helper "/organize/move" "POST" @{ dir = $ok3; format = "FLAC"; artist = "Radiohead"; folder = "1997 - OK Computer" }
Check "Organiser: a different copy gets (2)" ([bool]$m3.ok -and $m3.to -eq "$Lib\FLAC\Radiohead\1997 - OK Computer (2)" -and (Same $ok1Files (Contents "$Lib\FLAC\Radiohead\1997 - OK Computer"))) $m3.to

# A spelling slip is suggested, not assumed.
$typo = "$Dl\Radiohed - Kid A"
MakeAlbum $typo @{ albumArtist = "Radiohed"; artist = "Radiohed"; album = "Kid A"; year = 2000 } 1
$p = Helper "/organize/plan?dir=$(Q $typo)"
Check "Organiser: a near spelling is suggested, not assumed" (-not $p.artistExists -and @($p.similar) -contains "Radiohead") "exists=$($p.artistExists) similar=$(@($p.similar) -join ', ')"

# An artist kept in a group folder goes there.
$ar = "$Dl\Anri - Coquettish Blue (1984)"
MakeAlbum $ar @{ albumArtist = "Anri"; artist = "Anri"; album = "Coquettish Blue"; year = 1984 } 1
$p = Helper "/organize/plan?dir=$(Q $ar)"
Check "Organiser: an artist in a group folder goes into the group" ($p.group -eq "JP City Pop" -and $p.artist -eq "Anri") "group=$($p.group) artist=$($p.artist)"
$m5 = Helper "/organize/move" "POST" @{ dir = $ar; format = "FLAC"; artist = $p.artist; folder = "1984 - Coquettish Blue"; group = $p.group }
Check "Organiser: moved into the group" ([bool]$m5.ok -and $m5.to -eq "$Lib\FLAC\JP City Pop\Anri\1984 - Coquettish Blue") $m5.to

# No tags at all: the folder above is the artist, matched to the existing folder despite the missing accent.
$nt = "$Dl\Bjork\1995 - Post"
MakeAlbum $nt @{} 1
$p = Helper "/organize/plan?dir=$(Q $nt)"
Check "Organiser: no tags, the artist comes from the folder and matches the existing one" ($p.artist -eq $Bjork -and $p.artistExists -and $p.year -eq "1995") "$($p.artist) exists=$($p.artistExists) year=$($p.year)"

# Names that try to leave the library end up inside it.
$ev = "$Dl\Escape"
MakeAlbum $ev @{ albumArtist = "Escape"; album = "Escape"; year = 2020 } 1
$m6 = Helper "/organize/move" "POST" @{ dir = $ev; format = "FLAC"; artist = "..\..\.."; folder = "..\..\outside" }
Check "Organiser: names can't lead out of the library" ((-not $m6.ok) -or ($m6.to -and $m6.to.StartsWith("$Lib\FLAC\"))) "$($m6.to) $($m6.error)"
$m7 = Helper "/organize/move" "POST" @{ dir = "$Lib\FLAC\Massive Attack\1998 - Mezzanine"; format = "MP3"; artist = "X"; folder = "Y" }
Check "Organiser: only moves what is in Downloads" (-not $m7.ok -and (Test-Path "$Lib\FLAC\Massive Attack\1998 - Mezzanine")) $m7.error

# Undo puts the first download back where it was, exactly.
$un = Helper "/organize/undo" "POST" @{ id = $m1.id }
Check "Organiser: undo puts the download back" ([bool]$un.ok -and (Same $ok1Files (Contents $ok1)) -and -not (Test-Path "$Lib\FLAC\Radiohead\1997 - OK Computer")) $un.error
Check "Organiser: library otherwise as expected" ((Test-Path "$Lib\FLAC\Radiohead\1997 - OK Computer (2)") -and (Test-Path "$Lib\FLAC\Massive Attack\1998 - Mezzanine"))
SaveLogs "library-organiser"

# --- while downloading: the tags of a track that has only partly arrived ------------------
# A FLAC with a big cover picture after its tags, cut off in the middle of the picture, as when the fake-album check
# first looks at a track (25 Oct: To the Sea's 465 KB picture kept the tags unread for 11 s).
$peekDir = Join-Path $Dl "Peek Test"
$full = Join-Path $env:RUNNER_TEMP "nj-peek-full.flac"
MakeFlac $full @{ artist = "Foo Fighters"; albumArtist = "Foo Fighters"; album = "The Colour and the Shape"; title = "Everlong" } 16 44100 3
$tf = [TagLib.File]::Create($full)
$art = New-Object byte[] 600000
(New-Object Random 3).NextBytes($art)
$tf.Tag.Pictures = [TagLib.IPicture[]]@([TagLib.Picture]::new([TagLib.ByteVector]::new($art)))
$tf.Save(); $tf.Dispose()
# Where the tags end and the picture is, from the file's own block headers.
$b = [IO.File]::ReadAllBytes($full)
$p = 4; $tagsEnd = 0; $picEnd = 0
do {
    $last = ([int]$b[$p] -band 0x80) -ne 0; $type = [int]$b[$p] -band 0x7F; $len = [int]$b[$p + 1] * 65536 + [int]$b[$p + 2] * 256 + [int]$b[$p + 3]
    if ($type -eq 4) { $tagsEnd = $p + 4 + $len }
    if ($type -eq 6 -and $tagsEnd -gt 0) { $picEnd = $p + 4 + $len }
    $p += 4 + $len
} while (-not $last -and $p -lt $b.Length)
if ($picEnd -eq 0) { Note "Partial track tags" "TagLib put the picture before the tags, so this case wasn't made." }
else {
    $cut = [Math]::Min($tagsEnd + 64 * 1024, $picEnd - 1)
    New-Item -ItemType Directory -Force $peekDir | Out-Null
    $part = New-Object byte[] $cut
    [Array]::Copy($b, $part, $cut)
    [IO.File]::WriteAllBytes((Join-Path $peekDir "06 - Everlong.flac"), $part)
    $peek = Helper "/peek-tags?user=someone&file=$(Q 'Music\Foo Fighters\The Colour and the Shape\06 - Everlong.flac')&dest=$(Q 'Peek Test')"
    Check "While downloading: tags read before the cover picture has arrived" ($peek.found -and $peek.artist -eq "Foo Fighters" -and $peek.album -eq "The Colour and the Shape") "found=$($peek.found) artist=$($peek.artist) album=$($peek.album), $cut of $($b.Length) bytes"
}
}
catch {
    Check "Test ran to the end" $false "$($_.Exception.Message) at $(Split-Path -Leaf $_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)"
    SaveLogs "library-stopped"
}
finally { StopNightjar }

Finish "Nightjar $Version library tools"
