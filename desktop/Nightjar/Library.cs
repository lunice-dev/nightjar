using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Nightjar
{
    /// <summary>
    /// Looks through the whole library and says, for every album, where it would go under the library's
    /// structure (Format\Artist\Year - Album). Albums split into disc folders ("CD1", "Disc 2") or kept
    /// together as a box set count as one album. Nothing moves until the person applies a list of moves
    /// they've reviewed; a whole list can be undone.
    /// </summary>
    static class LibraryReview
    {
        public sealed class Album
        {
            public string dir, rel, kind;          // kind: album, discs, box
            public int tracks, bits, rate;
            public long size;
            public string currentFormat;           // the top folder it's in now ("FLAC"), or null
            public string format, artist, artistFromTags, album, year, folder, target;
            public string group;                   // a folder grouping artists ("JP City Pop"), kept as the person made it
            public bool compilation, artistGuessed;
            public string status;                  // ok, move, needsYear, skip
            public List<string> reasons = new List<string>();
            public string dupKey;                  // shared by copies of the same album
            public string note;
        }

        public sealed class ScanJob
        {
            public string id, root, error;
            public int done, total;
            public bool finished;
            public long at;
            public List<Album> albums = new List<Album>();
        }

        public sealed class ApplyJob
        {
            public string id, batch, error;
            public int done, total;
            public bool finished;
            public readonly List<object> results = new List<object>();
        }

        static readonly ConcurrentDictionary<string, ScanJob> Scans = new ConcurrentDictionary<string, ScanJob>();
        static readonly ConcurrentDictionary<string, ApplyJob> Applies = new ConcurrentDictionary<string, ApplyJob>();
        static ScanJob last;

        public static ScanJob GetScan(string id) => id == "last" ? (last != null && last.root == AppSettings.LibraryRoot ? last : null) : Scans.TryGetValue(id ?? "", out var j) ? j : null;
        public static ApplyJob GetApply(string id) => Applies.TryGetValue(id ?? "", out var j) ? j : null;

        // ---------------------------------------------------------------- finding the albums

        sealed class Node
        {
            public string path, name, top;
            public int depth;
            public Node parent;
            public List<Node> kids = new List<Node>();
            public List<string> audio = new List<string>();
        }

        static readonly Regex Disc = new Regex(@"^\s*[\(\[]?\s*((cd|disc|disk|dvd|vol(ume)?|part|side)\s*[\.\-_#]?\s*\d+|\d{1,2})\b", RegexOptions.IgnoreCase);
        static readonly Regex DiscInTitle = new Regex(@"\s*[\(\[]\s*(cd|disc|disk)\s*\d+[^\)\]]*[\)\]]\s*$|\s*(cd|disc|disk)\s*\d+\s*$|\s*[-–]\s*(cd|disc|disk)\s*\d+.*$", RegexOptions.IgnoreCase);

        static bool DiscLike(string name) => Disc.IsMatch(name);

        static string StripDisc(string album) => DiscInTitle.Replace(album ?? "", "").Trim();

        static bool SamePath(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(b).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);

        static Node Build(string path, int depth, string top, string skip)
        {
            var n = new Node { path = path, name = Path.GetFileName(path), depth = depth, top = top };
            try { n.audio = Directory.GetFiles(path).Where(Organizer.IsAudio).OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToList(); } catch { }
            if (depth > 12) return n;
            string[] subs;
            try { subs = Directory.GetDirectories(path); } catch { subs = new string[0]; }
            foreach (var s in subs.OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
            {
                if (skip != null && SamePath(s, skip)) continue;
                try { if ((File.GetAttributes(s) & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue; } catch { continue; }
                var k = Build(s, depth + 1, depth == 0 ? Path.GetFileName(s) : top, skip);
                k.parent = n;
                if (k.audio.Count > 0 || k.kids.Count > 0) n.kids.Add(k);
            }
            return n;
        }

        static IEnumerable<string> AllAudio(Node n) => n.audio.Concat(n.kids.SelectMany(AllAudio));

        /// <summary>Where artist folders are: Library\FLAC\Artist when the top folders are formats, otherwise Library\Artist.</summary>
        static int ArtistDepth(Node n) => Organizer.Formats.Contains(n.top ?? "", StringComparer.OrdinalIgnoreCase) ? 2 : 1;

        sealed class Found { public Node node; public string kind, skipNote; }

        static void Walk(Node n, List<Found> found)
        {
            if (n.depth == 0)
            {
                if (n.audio.Count > 0) found.Add(new Found { node = n, kind = "album", skipNote = "Tracks loose in the library folder itself: sort these by hand." });
                foreach (var k in n.kids) Walk(k, found);
                return;
            }
            var leafKids = n.kids.All(k => k.kids.Count == 0);
            if (n.audio.Count > 0)
            {
                if (n.kids.Count == 0 || (leafKids && n.kids.All(k => DiscLike(k.name)))) { found.Add(new Found { node = n, kind = n.kids.Count == 0 ? "album" : "discs" }); return; }
                found.Add(new Found { node = n, kind = "album", skipNote = "This folder has tracks of its own next to other album folders: sort it by hand." });
                foreach (var k in n.kids) Walk(k, found);
                return;
            }
            if (n.depth >= ArtistDepth(n) && n.kids.Count >= 1 && leafKids && n.kids.All(k => DiscLike(k.name))) { found.Add(new Found { node = n, kind = "discs" }); return; }
            if (n.depth >= ArtistDepth(n) && n.kids.Count >= 2 && leafKids)
            {
                var tags = n.kids.Select(k => Quick(k.audio.FirstOrDefault())).ToList();
                var albumKeys = tags.Select(t => Organizer.Key(StripDisc(t.Item2))).Distinct().ToList();
                // In an album's place, folders that all carry the same album tag are its discs ("Mellon Collie\Dawn to Dusk").
                // (Not in an artist's place: there, two folders of the same album are two copies.)
                if (n.depth >= ArtistDepth(n) + 1 && albumKeys.Count == 1 && albumKeys[0].Length > 0) { found.Add(new Found { node = n, kind = "discs" }); return; }
                // In an album's place inside the artist's own folder ("A Perfect Circle\2013 - Live 2010-11\<several albums>"),
                // several albums kept together are a box set. Inside a group ("JP City Pop\Anri\<albums>") the folder is an artist.
                var kidsArtist = Organizer.Most(tags.Select(t => t.Item1)) ?? "";
                var namedLikeKids = n.kids.Count(k => k.name.StartsWith(n.name + " - ", StringComparison.OrdinalIgnoreCase) || k.name.StartsWith(n.name + " – ", StringComparison.OrdinalIgnoreCase)) * 2 >= n.kids.Count;
                var isArtist = namedLikeKids || Agrees(n.name, kidsArtist);
                var inArtistsFolder = kidsArtist.Length == 0 || (n.parent != null && Agrees(n.parent.name, kidsArtist));
                if (n.depth >= ArtistDepth(n) + 1 && !isArtist && inArtistsFolder) { found.Add(new Found { node = n, kind = "box" }); return; }
            }
            foreach (var k in n.kids) Walk(k, found);
        }

        static Tuple<string, string> Quick(string file)
        {
            if (file == null) return Tuple.Create("", "");
            try
            {
                using (var t = TagLib.File.Create(file, TagLib.ReadStyle.None))
                    return Tuple.Create(t.Tag.FirstAlbumArtist ?? t.Tag.FirstPerformer ?? "", t.Tag.Album ?? "");
            }
            catch { return Tuple.Create("", ""); }
        }

        // ---------------------------------------------------------------- the scan

        public static ScanJob StartScan()
        {
            var job = new ScanJob { id = Guid.NewGuid().ToString("N"), root = AppSettings.LibraryRoot, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Scans[job.id] = job;
            Task.Run(() => RunScan(job));
            return job;
        }

        static void RunScan(ScanJob job)
        {
            try
            {
                var root = job.root;
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) { job.error = "Choose your library folder in Settings first."; return; }
                // The downloads folder may sit inside the library ("FLAC\UNSORTED"): what's there is for Downloads, not this review.
                var dl = Config.DownloadDir();
                var tree = Build(root, 0, null, dl);
                var found = new List<Found>();
                Walk(tree, found);
                job.total = found.Count;
                var albums = new Album[found.Count];
                Parallel.For(0, found.Count, new ParallelOptions { MaxDegreeOfParallelism = 4 }, i =>
                {
                    try { albums[i] = Describe(root, found[i]); }
                    catch (Exception e) { albums[i] = new Album { dir = found[i].node.path, rel = Rel(root, found[i].node.path), status = "skip", note = "Couldn't read it: " + e.Message }; }
                    Interlocked.Increment(ref job.done);
                });
                Settle(root, tree, albums.ToList());
                job.albums = albums.ToList();
                last = job;
                // The latest look, kept for support: what Nightjar found and what it would do.
                try { File.WriteAllText(Path.Combine(Paths.Data, "library-review.json"), new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Serialize(job.albums), new System.Text.UTF8Encoding(false)); } catch { }
                Log.Write("Library review: " + job.albums.Count + " albums, " + job.albums.Count(a => a.status == "move") + " to move, " + job.albums.Count(a => a.status == "needsYear") + " without a year, " + job.albums.Where(a => a.dupKey != null).Select(a => a.dupKey).Distinct().Count() + " with copies");
            }
            catch (Exception e) { job.error = e.Message; }
            finally { job.finished = true; }
        }

        static bool Latin(string s) => !string.IsNullOrEmpty(s) && s.All(c => !char.IsLetter(c) || c < 0x0250 || (c >= 0x1E00 && c < 0x1F00));

        static string Rel(string root, string path) => path.Length > root.TrimEnd(Path.DirectorySeparatorChar).Length ? path.Substring(root.TrimEnd(Path.DirectorySeparatorChar).Length + 1) : "";

        static readonly Regex FeatSplit = new Regex(@"\s+(feat\.?|ft\.?|featuring|with|x|&|and|vs\.?)\s+|\s*[,;/]\s*", RegexOptions.IgnoreCase);
        static readonly string[] VariousKeys = { "variousartists", "various", "va", "variousartist", "vários", "variosartistas", "variosartistas" };

        static Album Describe(string root, Found f)
        {
            var n = f.node;
            var a = new Album { dir = n.path, rel = Rel(root, n.path), kind = f.kind };
            var segs = a.rel.Split(Path.DirectorySeparatorChar);
            a.currentFormat = segs.Length > 1 && Organizer.Formats.Contains(segs[0], StringComparer.OrdinalIgnoreCase) ? segs[0] : null;
            if (f.skipNote != null)
            {
                a.status = "skip";
                a.note = f.skipNote;
                a.tracks = n.audio.Count;
                return a;
            }
            var files = (f.kind == "album" ? n.audio : AllAudio(n)).ToList();
            a.tracks = files.Count;
            try { a.size = Directory.GetFiles(n.path, "*", SearchOption.AllDirectories).Sum(x => new FileInfo(x).Length); } catch { }

            var albumArtists = new List<string>();
            var performers = new List<string>();
            var titles = new List<string>();
            var years = new List<string>();
            var bits = new List<int>();
            var rates = new List<int>();
            int hires = 0, lossless = 0, mp3 = 0;
            foreach (var file in files)
            {
                var ext = Path.GetExtension(file).ToLowerInvariant();
                if (ext == ".mp3") mp3++;
                try
                {
                    using (var t = TagLib.File.Create(file, TagLib.ReadStyle.Average))
                    {
                        albumArtists.Add(t.Tag.FirstAlbumArtist);
                        var perf = t.Tag.FirstPerformer;
                        if (!string.IsNullOrWhiteSpace(perf)) performers.Add(FeatSplit.Split(perf)[0].Trim());
                        titles.Add(t.Tag.Album);
                        if (t.Tag.Year > 1900) years.Add(t.Tag.Year.ToString());
                        var p = t.Properties;
                        var isLossless = Organizer.Lossless.Contains(ext) || (p?.Codecs?.Any(c => c?.Description?.IndexOf("lossless", StringComparison.OrdinalIgnoreCase) >= 0 || c?.Description?.IndexOf("ALAC", StringComparison.OrdinalIgnoreCase) >= 0) ?? false);
                        if (p != null) { bits.Add(p.BitsPerSample); rates.Add(p.AudioSampleRate); }
                        if (isLossless)
                        {
                            lossless++;
                            if ((p?.BitsPerSample ?? 0) > 16 || (p?.AudioSampleRate ?? 0) > 48000) hires++;
                        }
                    }
                }
                catch { if (Organizer.Lossless.Contains(ext)) lossless++; }
            }
            a.bits = bits.Count > 0 ? bits.GroupBy(x => x).OrderByDescending(g => g.Count()).First().Key : 0;
            a.rate = rates.Count > 0 ? rates.GroupBy(x => x).OrderByDescending(g => g.Count()).First().Key : 0;
            a.format = files.Count == 0 ? "Other" : hires * 2 > files.Count ? "Hi-Res" : lossless * 2 > files.Count ? "FLAC" : mp3 * 2 > files.Count ? "MP3" : "Other";

            // The artist: the album artist, else the main performer; many different performers make it a compilation.
            var albumArtist = Organizer.Clean(Organizer.Most(albumArtists));
            var distinctPerformers = performers.Select(Organizer.Key).Where(k => k.Length > 0).Distinct().Count();
            a.compilation = VariousKeys.Contains(Organizer.Key(albumArtist)) || (albumArtist.Length == 0 && distinctPerformers >= 3 && distinctPerformers * 2 > files.Count);
            var artist = a.compilation ? "Various Artists" : albumArtist.Length > 0 ? albumArtist : Organizer.Clean(Organizer.Most(performers));
            a.artistFromTags = artist;
            // No tags: the artist's folder it sits in now.
            var artistDepth = a.currentFormat != null ? 1 : 0;
            var folderArtist = segs.Length > artistDepth + 1 ? segs[artistDepth] : null;
            if (string.IsNullOrEmpty(artist) && folderArtist != null)
            {
                artist = VariousKeys.Contains(Organizer.Key(folderArtist)) ? "Various Artists" : folderArtist;
                a.artistGuessed = true;
            }
            a.artist = artist;

            // The album: the tag (without "Disc 1"), else the folder's name without year and rip labels; a box set keeps its folder's name.
            var album = f.kind == "box" ? "" : Organizer.Most(titles.Where(t => t != null).Select(t => StripDisc(Organizer.CleanAlbum(t))));
            var fromFolder = Organizer.CleanAlbum(Organizer.AlbumFromFolder(n.name));
            if (string.IsNullOrEmpty(album)) album = fromFolder;
            // Titles tagged in another script ("哀しみの孔雀") keep the folder's spelling ("Kanashimi no Kujaku").
            else if (!Latin(album) && Latin(fromFolder) && fromFolder.Length > 0) album = fromFolder;
            foreach (var lead in new[] { artist, folderArtist, Organizer.Most(performers), Path.GetFileName(Path.GetDirectoryName(n.path)) })
                if (!string.IsNullOrEmpty(lead) && album.StartsWith(lead + " - ", StringComparison.OrdinalIgnoreCase)) album = album.Substring(lead.Length + 3).Trim();
            a.album = album;

            // The original year: the earlier of the tags' and the folder's ("Definitely Maybe (30th Anniversary) (2024)" tagged 1994).
            var year = Organizer.Most(years);
            var fy = Organizer.FolderYear.Match(n.name);
            if (fy.Success && (year == null || string.CompareOrdinal(fy.Value, year) < 0)) year = fy.Value;
            a.year = year;
            return a;
        }

        /// <summary>Whether a folder's name and an album's artist tag mean the same artist ("Larry June" and "Larry June & The Alchemist").</summary>
        static bool Agrees(string folder, string tag)
        {
            var kf = Organizer.Key(folder);
            var kt = Organizer.Key(tag);
            if (kf.Length == 0 || kt.Length == 0) return false;
            return kt == kf || Organizer.Key(FeatSplit.Split(tag)[0]) == kf || (kf.Length >= 4 && kt.Contains(kf));
        }

        static readonly Regex Bracket = new Regex(@"[\(\[]([^\)\]]+)[\)\]]");
        static readonly Regex RipWord = new Regex(@"\b(flac|mp3|aac|alac|wav|web|cd|cdrip|rip|eac|lossless|hi-?res|bit|bits|khz|kbps|vbr|cbr|v0|v2|pmedia|\d+(bit|khz|cd)?|\d+[\.,]\d+)\b", RegexOptions.IgnoreCase);

        /// <summary>What a folder's name says about the edition, beyond rip labels: "(Japan Edition)", "[CD Single]", "(Another Mastering CD)".</summary>
        static string Edition(string folderName, string album)
        {
            foreach (Match m in Bracket.Matches(folderName))
            {
                var inner = m.Groups[1].Value.Trim();
                if (Regex.IsMatch(inner, @"^(19|20)\d{2}$")) continue;
                if (!Regex.IsMatch(RipWord.Replace(inner, ""), @"\p{L}{2,}")) continue;
                if (album.IndexOf(inner, StringComparison.OrdinalIgnoreCase) >= 0) continue;
                return inner;
            }
            return null;
        }

        /// <summary>Second pass, with every album known: the artist's folder, one spelling per artist, copies, targets and what changes.</summary>
        static void Settle(string root, Node tree, List<Album> albums)
        {
            var live = albums.Where(x => x.status != "skip").ToList();

            // Artist folders the person made: when most albums in a folder agree with its name (by their tags, or as
            // "Anri - Timely!!"), the folder's name wins over odd tags ("Nirvana" on a A Perfect Circle album, "杏里").
            foreach (var g in live.GroupBy(x => Parent(x.dir), StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(g.Key);
                if (SamePath(g.Key, root) || (Organizer.Formats.Contains(name, StringComparer.OrdinalIgnoreCase) && SamePath(Parent(g.Key), root))) continue;
                var fk = Organizer.Key(name);
                if (fk.Length == 0 || VariousKeys.Contains(fk)) continue;
                var agree = g.Count(x => Agrees(name, x.artistFromTags) || Path.GetFileName(x.dir).StartsWith(name + " - ", StringComparison.OrdinalIgnoreCase));
                if (agree * 2 < g.Count()) continue;
                foreach (var x in g)
                    if (!x.compilation) { x.artist = name; x.artistGuessed = false; }
            }

            // Group folders the person made at an artist's place ("FLAC\JP City Pop\Anri\…"): kept, with the artists inside.
            // A folder is a group when it holds artist folders and isn't itself the artist of what's in it.
            var groups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var g in live.Where(x => x.currentFormat != null).GroupBy(x => x.rel.Split(Path.DirectorySeparatorChar)[1], StringComparer.OrdinalIgnoreCase))
            {
                var nested = g.Any(x => x.rel.Split(Path.DirectorySeparatorChar).Length >= 4);
                var agree = g.Count(x => Agrees(g.Key, x.artistFromTags));
                if (nested && agree * 2 < g.Count() && !VariousKeys.Contains(Organizer.Key(g.Key))) groups.Add(g.Key);
            }
            foreach (var a in live.Where(x => x.currentFormat != null))
            {
                var segs = a.rel.Split(Path.DirectorySeparatorChar);
                if (!groups.Contains(segs[1])) continue;
                a.group = segs[1];
                // "JP City Pop\Anri\1979 - Feelin'": the artist folder inside the group is the person's choice.
                if (segs.Length >= 4 && !a.compilation) { a.artist = segs[2]; a.artistGuessed = false; }
            }
            if (groups.Count > 0) AppSettings.Groups = groups.ToArray();

            // Spellings of artist folders already there, by how many albums each holds.
            var spellings = new Dictionary<string, Dictionary<string, int>>();
            foreach (var a in live)
            {
                var segs = a.rel.Split(Path.DirectorySeparatorChar);
                var d = a.currentFormat != null ? 1 : 0;
                if (segs.Length <= d + 1) continue;
                var name = segs[d];
                var k = Organizer.Key(name);
                if (k.Length == 0) continue;
                if (!spellings.TryGetValue(k, out var m)) spellings[k] = m = new Dictionary<string, int>(StringComparer.Ordinal);
                m[name] = (m.TryGetValue(name, out var c) ? c : 0) + 1;
            }
            foreach (var a in live)
            {
                var k = Organizer.Key(a.artist);
                if (k.Length > 0 && spellings.TryGetValue(k, out var m)) a.artist = m.OrderByDescending(x => x.Value).ThenBy(x => x.Key, StringComparer.Ordinal).First().Key;
                if (string.IsNullOrWhiteSpace(a.artist)) { a.status = "skip"; a.note = "No artist in the tags or the folders: sort it by hand."; }
            }
            live = live.Where(x => x.status != "skip").ToList();

            // Copies: the same artist and album. Each keeps what its folder says about the edition, so they don't collide.
            foreach (var g in live.GroupBy(a => Organizer.Key(a.artist) + "|" + Organizer.Key(a.album)).Where(g => g.Count() > 1))
                foreach (var a in g)
                {
                    a.dupKey = g.Key;
                    var ed = Edition(Path.GetFileName(a.dir), a.album);
                    if (ed != null) a.album += " (" + ed + ")";
                }

            // Albums Nightjar already put in place (and not undone) stay where they are: a second look must
            // never move them again because the tags disagree with the name chosen then ("Anri" vs "杏里").
            var placed = new HashSet<string>(Organizer.Log().Where(m => !m.undone && m.to != null).Select(m => Path.GetFullPath(m.to).TrimEnd(Path.DirectorySeparatorChar)), StringComparer.OrdinalIgnoreCase);
            foreach (var a in live)
            {
                if (placed.Contains(Path.GetFullPath(a.dir).TrimEnd(Path.DirectorySeparatorChar)))
                {
                    a.artist = Path.GetFileName(Parent(a.dir));
                    a.folder = Path.GetFileName(a.dir);
                    a.target = a.dir;
                    a.status = "ok";
                    continue;
                }
                a.folder = a.year != null ? a.year + " - " + a.album : a.album;
                a.target = a.group != null
                    ? Path.Combine(root, a.format, a.group, Organizer.Safe(a.artist), Organizer.Safe(a.folder))
                    : Path.Combine(root, a.format, Organizer.Safe(a.artist), Organizer.Safe(a.folder));
                Explain(root, a);
                var here = Path.GetFullPath(a.dir).TrimEnd(Path.DirectorySeparatorChar);
                var there = Path.GetFullPath(a.target);
                // A second copy already sorted as "2025 - SABLE, fABLE (2)" is in its place too.
                var numbered = Regex.IsMatch(here, "^" + Regex.Escape(there) + @" \(\d+\)$");
                a.status = a.year == null ? "needsYear" : string.Equals(here, there, StringComparison.Ordinal) || numbered ? "ok" : "move";
                if (numbered) a.reasons.Clear();
            }
            // Two albums headed for the same place are copies too.
            foreach (var g in live.GroupBy(a => a.target.ToLowerInvariant()).Where(g => g.Count() > 1))
            {
                var key = g.Select(a => a.dupKey).FirstOrDefault(x => x != null) ?? "target|" + g.Key;
                foreach (var a in g) a.dupKey = key;
            }
        }

        static void Explain(string root, Album a)
        {
            var segs = a.rel.Split(Path.DirectorySeparatorChar);
            if (a.currentFormat == null) a.reasons.Add("Not in a format folder yet");
            else if (!string.Equals(a.currentFormat, a.format, StringComparison.OrdinalIgnoreCase)) a.reasons.Add(a.currentFormat + " → " + a.format);
            var d = a.currentFormat != null ? 1 : 0;
            if (a.group != null) d++; // inside "JP City Pop", the artist folder comes next
            var nowArtist = segs.Length > d + 1 ? segs[d] : null;
            var deeper = segs.Length > d + 2;
            if (deeper) a.reasons.Add("Out of a group folder (" + string.Join("\\", segs.Skip(d).Take(segs.Length - d - 1)) + ")");
            else if (nowArtist == null) a.reasons.Add("Into an artist folder");
            else if (!string.Equals(nowArtist, Organizer.Safe(a.artist), StringComparison.Ordinal)) a.reasons.Add("Artist folder: " + nowArtist + " → " + Organizer.Safe(a.artist));
            if (!string.Equals(segs[segs.Length - 1], Organizer.Safe(a.folder), StringComparison.Ordinal)) a.reasons.Add("Renamed: " + segs[segs.Length - 1] + " → " + Organizer.Safe(a.folder));
        }

        // ---------------------------------------------------------------- applying a reviewed list

        static string S(IDictionary<string, object> d, string k) => d.TryGetValue(k, out var v) ? v as string : null;

        public static ApplyJob StartApply(IEnumerable moves)
        {
            var list = moves?.OfType<IDictionary<string, object>>().ToList() ?? new List<IDictionary<string, object>>();
            var job = new ApplyJob { id = Guid.NewGuid().ToString("N"), batch = Guid.NewGuid().ToString("N"), total = list.Count };
            Applies[job.id] = job;
            Task.Run(() =>
            {
                try
                {
                    foreach (var m in list)
                    {
                        var dir = S(m, "dir");
                        object r;
                        try { r = MoveOne(dir, S(m, "format"), S(m, "artist"), S(m, "folder"), job.batch, S(m, "group")); }
                        catch (Exception e) { r = new { dir, ok = false, error = e.Message }; }
                        lock (job.results) job.results.Add(r);
                        Interlocked.Increment(ref job.done);
                    }
                    Log.Write("Library review: applied " + job.done + " moves (batch " + job.batch + ")");
                }
                catch (Exception e) { job.error = e.Message; }
                finally { job.finished = true; last = null; }
            });
            return job;
        }

        static string Parent(string p) => Path.GetDirectoryName(p.TrimEnd(Path.DirectorySeparatorChar));

        /// <summary>The highest folder on the way to <paramref name="dir"/> that doesn't exist yet (to tidy away on undo).</summary>
        static string FirstMissing(string dir, string root)
        {
            string missing = null;
            for (var p = dir; p != null && Organizer.Under(p, root); p = Parent(p))
                if (!Directory.Exists(p)) missing = p;
            return missing;
        }

        /// <summary>Gives a folder the exact spelling asked for, when only its capitals differ.</summary>
        static void FixCase(string wanted)
        {
            var parent = Parent(wanted);
            if (parent == null || !Directory.Exists(parent)) return;
            var actual = Directory.GetDirectories(parent).FirstOrDefault(d => string.Equals(Path.GetFileName(d), Path.GetFileName(wanted), StringComparison.OrdinalIgnoreCase));
            if (actual == null || string.Equals(Path.GetFileName(actual), Path.GetFileName(wanted), StringComparison.Ordinal)) return;
            var tmp = Path.Combine(parent, ".nightjar-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.Move(actual, tmp);
            Directory.Move(tmp, wanted);
        }

        /// <summary>Removes folders left empty, from <paramref name="from"/> up, but never the library or its top folders.</summary>
        static void TidyUp(string from, string root)
        {
            try
            {
                for (var up = from; up != null && Organizer.Under(up, root) && !SamePath(Parent(up), root); up = Parent(up))
                {
                    if (!Directory.Exists(up)) continue;
                    if (Directory.EnumerateFileSystemEntries(up).Any()) break;
                    Directory.Delete(up);
                }
            }
            catch { }
        }

        static void DeleteIfEmptyTree(string dir)
        {
            try
            {
                if (dir == null || !Directory.Exists(dir)) return;
                foreach (var d in Directory.GetDirectories(dir)) DeleteIfEmptyTree(d);
                if (!Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
            }
            catch { }
        }

        static void Relocate(string from, string to)
        {
            var caseOnly = string.Equals(Path.GetFullPath(from), Path.GetFullPath(to), StringComparison.OrdinalIgnoreCase);
            if (caseOnly || Organizer.Under(to, from))
            {
                // Through a temporary name: "Bjork" → "Björk" is fine, but "radiohead" → "Radiohead" or a folder into its own subfolder isn't.
                var tmp = Path.Combine(Parent(from), ".nightjar-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                Directory.Move(from, tmp);
                Directory.CreateDirectory(Parent(to));
                Organizer.MoveDir(tmp, to);
            }
            else Organizer.MoveDir(from, to);
        }

        static object MoveOne(string dir, string format, string artist, string folder, string batch, string group = null)
        {
            lock (Organizer.Gate)
            {
                var root = AppSettings.LibraryRoot;
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return new { dir, ok = false, error = "Choose your library folder in Settings first." };
                if (string.IsNullOrEmpty(dir) || !Organizer.Under(dir, root) || !Directory.Exists(dir)) return new { dir, ok = false, error = "That album isn't in your library folder any more." };
                if (!Organizer.Formats.Contains(format)) return new { dir, ok = false, error = "Unknown format folder." };
                if (string.IsNullOrWhiteSpace(artist) || string.IsNullOrWhiteSpace(folder)) return new { dir, ok = false, error = "The artist and the album folder need a name." };

                var artistDir = string.IsNullOrWhiteSpace(group) ? Path.Combine(root, format, Organizer.Safe(artist)) : Path.Combine(root, format, Organizer.Safe(group), Organizer.Safe(artist));
                var to = Path.Combine(artistDir, Organizer.Safe(folder));
                if (!Organizer.Under(to, root)) return new { dir, ok = false, error = "That name would leave the library folder." };
                if (string.Equals(Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(to), StringComparison.Ordinal)) return new { dir, ok = true, to, unchanged = true };
                var caseOnly = string.Equals(Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(to), StringComparison.OrdinalIgnoreCase);
                if (!caseOnly && Directory.Exists(to))
                {
                    // Never merge two albums: the second gets " (2)".
                    var n = 2;
                    var baseTo = to;
                    while (Directory.Exists(to)) to = baseTo + " (" + n++ + ")";
                }
                var created = FirstMissing(artistDir, root);
                Directory.CreateDirectory(artistDir);
                FixCase(artistDir);
                try { Relocate(dir, to); }
                catch (Exception e)
                {
                    DeleteIfEmptyTree(created);
                    return new { dir, ok = false, error = "Couldn't move it: " + e.Message };
                }
                TidyUp(Parent(dir), root);
                var log = Organizer.Log();
                log.Add(new Organizer.Move { id = Guid.NewGuid().ToString("N"), batch = batch, from = dir, to = to, createdArtist = created, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
                Organizer.SaveLog(log);
                Log.Write("Reorganized " + dir + " → " + to);
                return new { dir, ok = true, to };
            }
        }

        public static object UndoBatch(string batch)
        {
            lock (Organizer.Gate)
            {
                var root = AppSettings.LibraryRoot;
                var log = Organizer.Log();
                var moves = log.Where(m => m.batch == batch && !m.undone).Reverse().ToList();
                if (moves.Count == 0) return new { ok = false, error = "Nothing to undo." };
                var failed = new List<object>();
                var back = new List<object>();
                var undone = 0;
                foreach (var m in moves)
                {
                    try
                    {
                        if (!Directory.Exists(m.to)) { failed.Add(new { m.to, error = "It isn't where Nightjar put it any more." }); continue; }
                        if (Directory.Exists(m.from) && !string.Equals(Path.GetFullPath(m.from), Path.GetFullPath(m.to), StringComparison.OrdinalIgnoreCase)) { failed.Add(new { m.to, error = "Something else is already where it was." }); continue; }
                        Directory.CreateDirectory(Parent(m.from));
                        Relocate(m.to, m.from);
                        DeleteIfEmptyTree(m.createdArtist);
                        if (root != null) TidyUp(Parent(m.to), root);
                        m.undone = true;
                        back.Add(new { from = m.to, to = m.from });
                        undone++;
                    }
                    catch (Exception e) { failed.Add(new { m.to, error = e.Message }); }
                }
                Organizer.SaveLog(log);
                last = null;
                Log.Write("Library review: undid " + undone + " moves (batch " + batch + ")" + (failed.Count > 0 ? ", " + failed.Count + " couldn't" : ""));
                return new { ok = failed.Count == 0, undone, failed, moved = back };
            }
        }

        public static object Batches() =>
            Organizer.Log().Where(m => m.batch != null && !m.undone).GroupBy(m => m.batch)
                .Select(g => new { batch = g.Key, at = g.Max(m => m.at), count = g.Count() })
                .OrderByDescending(b => b.at).Take(10).ToList();

        /// <summary>Sends one copy of an album to the Recycle Bin, after the person chose it.</summary>
        /// <summary>What an album folder may hold besides music: art, rip logs and cue sheets, players' and Windows' leftovers.</summary>
        static readonly HashSet<string> AlbumExtras = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff",
            ".cue", ".log", ".txt", ".nfo", ".m3u", ".m3u8", ".sfv", ".md5", ".ffp", ".accurip", ".pdf", ".ini", ".db", ".url", ".json", ".xml",
        };

        /// <summary>
        /// Null when the folder is an album (music, with only art, logs and the like beside it, in at most a few
        /// disc or scan folders); otherwise why Nightjar won't delete it. Keeps "Delete" from ever taking anything else.
        /// </summary>
        internal static string NotAnAlbum(string dir)
        {
            int audio = 0, files = 0;
            string Walk(string d, int depth)
            {
                if (depth > 3) return "This folder has too many folders inside it to be an album, so Nightjar won't delete it. Delete it in Explorer if you're sure.";
                foreach (var f in Directory.EnumerateFiles(d))
                {
                    if (++files > 3000) return "This folder has too many files to be an album, so Nightjar won't delete it. Delete it in Explorer if you're sure.";
                    var ext = Path.GetExtension(f);
                    if (Media.IsAudio(f)) audio++;
                    else if (!AlbumExtras.Contains(ext))
                        return "This folder has more than music in it (" + Path.GetFileName(f) + "), so Nightjar won't delete it. Delete it in Explorer if you're sure.";
                }
                foreach (var sub in Directory.EnumerateDirectories(d))
                {
                    var r = Walk(sub, depth + 1);
                    if (r != null) return r;
                }
                return null;
            }
            try
            {
                var why = Walk(dir, 0);
                if (why != null) return why;
            }
            catch (Exception e) { return "Nightjar couldn't look inside that folder (" + e.Message + "), so it didn't delete it."; }
            return audio == 0 ? "There's no music in this folder, so Nightjar won't delete it." : null;
        }

        public static object Recycle(string dir)
        {
            lock (Organizer.Gate)
            {
                var root = AppSettings.LibraryRoot;
                if (string.IsNullOrEmpty(dir) || !Organizer.Under(dir, root) || !Directory.Exists(dir)) return new { ok = false, error = "That album isn't in your library folder any more." };
                if (SamePath(Parent(dir), root)) return new { ok = false, error = "Nightjar doesn't delete whole format folders." };
                var why = NotAnAlbum(dir);
                if (why != null) return new { ok = false, error = why };
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(dir, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                TidyUp(Parent(dir), root);
                last = null;
                Log.Write("Library review: sent to the Recycle Bin " + dir);
                return new { ok = true };
            }
        }
    }
}
