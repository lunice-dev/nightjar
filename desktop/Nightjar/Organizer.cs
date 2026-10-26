using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Nightjar
{
    /// <summary>Nightjar's own settings (not slskd's): where the music library is.</summary>
    static class AppSettings
    {
        static string File => Path.Combine(Paths.Data, "nightjar.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        static readonly object Gate = new object();

        // A damaged nightjar.json is never read as empty and then saved over (that would forget the library folder): see SafeFile.
        static Dictionary<string, object> Read() => SafeFile.Load(File, t => Json.Deserialize<Dictionary<string, object>>(t), () => new Dictionary<string, object>());

        static void Change(Action<Dictionary<string, object>> change)
        {
            lock (Gate)
            {
                var d = Read();
                change(d);
                SafeFile.Write(File, Json.Serialize(d));
            }
        }

        /// <summary>Group folders found in the library ("JP City Pop"): artists inside them are matched there too.</summary>
        public static string[] Groups
        {
            get => Read().TryGetValue("groups", out var v) && v is System.Collections.IEnumerable e ? e.OfType<string>().ToArray() : new string[0];
            set => Change(d => d["groups"] = value);
        }

        public static object Get(string key) => Read().TryGetValue(key, out var v) ? v : null;

        public static void Set(string key, object value) => Change(d => { if (value == null) d.Remove(key); else d[key] = value; });

        /// <summary>Where updates come from ("owner/repo" on GitHub), when not the built-in one.</summary>
        public static string UpdateRepo => Read().TryGetValue("updateRepo", out var v) ? v as string : null;

        public static string LibraryRoot
        {
            get => Read().TryGetValue("libraryRoot", out var v) ? v as string : null;
            set => Change(d => d["libraryRoot"] = value);
        }
    }

    /// <summary>
    /// Puts downloaded albums into the library: Library\FLAC|Hi-Res|MP3|Other\Artist\Year - Album.
    /// Reads the artist, album and year from the files' tags, finds the artist's folder if it already
    /// exists (even spelled a little differently), and never moves anything the person hasn't confirmed.
    /// Never overwrites; every move can be undone.
    /// </summary>
    static class Organizer
    {
        static readonly string[] Audio = { ".flac", ".mp3", ".m4a", ".alac", ".wav", ".aif", ".aiff", ".ape", ".wv", ".ogg", ".opus", ".aac", ".wma", ".dsf", ".dff" };
        internal static readonly string[] Lossless = { ".flac", ".alac", ".wav", ".aif", ".aiff", ".ape", ".wv", ".dsf", ".dff" };
        public static readonly string[] Formats = { "FLAC", "Hi-Res", "MP3", "Other" };
        static string LogFile => Path.Combine(Paths.Data, "organizer-log.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        internal static readonly object Gate = new object();

        public static bool IsAudio(string f) => Audio.Contains(Path.GetExtension(f).ToLowerInvariant());

        // ---------------------------------------------------------------- what's waiting

        /// <summary>Album folders in the downloads folder: any folder with audio files directly in it.</summary>
        public static List<object> Waiting()
        {
            var list = new List<object>();
            var root = Config.DownloadDir();
            if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return list;
            foreach (var dir in Directory.EnumerateDirectories(root, "*", SearchOption.AllDirectories).Take(5000))
            {
                string[] files;
                try { files = Directory.GetFiles(dir); } catch { continue; }
                var audio = files.Where(IsAudio).ToList();
                if (audio.Count == 0) continue;
                long size = 0;
                foreach (var f in files) try { size += new FileInfo(f).Length; } catch { }
                DateTime when = DateTime.MinValue;
                try { when = Directory.GetLastWriteTimeUtc(dir); } catch { }
                list.Add(new { dir, name = Path.GetFileName(dir), tracks = audio.Count, size, at = (long)(when - new DateTime(1970, 1, 1)).TotalMilliseconds });
            }
            return list;
        }

        // ---------------------------------------------------------------- the plan for one album

        internal static string Clean(string s) => (s ?? "").Trim();

        /// <summary>For matching artist folders: case, accents, "The", "&amp;" and punctuation don't count.</summary>
        public static string Key(string name)
        {
            var s = (name ?? "").Trim().ToLowerInvariant();
            s = Regex.Replace(s, @",\s*the$", "");
            s = Regex.Replace(s, @"^the\s+", "");
            s = s.Replace("&", " and ");
            var norm = s.Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder();
            foreach (var c in norm)
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark && char.IsLetterOrDigit(c)) sb.Append(c);
            return sb.ToString();
        }

        internal static int Distance(string a, string b)
        {
            var d = new int[a.Length + 1, b.Length + 1];
            for (int i = 0; i <= a.Length; i++) d[i, 0] = i;
            for (int j = 0; j <= b.Length; j++) d[0, j] = j;
            for (int i = 1; i <= a.Length; i++)
                for (int j = 1; j <= b.Length; j++)
                    d[i, j] = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            return d[a.Length, b.Length];
        }

        internal static string Most(IEnumerable<string> values) =>
            values.Where(v => !string.IsNullOrWhiteSpace(v)).GroupBy(v => v.Trim(), StringComparer.OrdinalIgnoreCase).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();

        /// <summary>The folder's album name without the year and the usual rip labels: "2007 - In Rainbows [FLAC 24-96]" → "In Rainbows".</summary>
        internal static string AlbumFromFolder(string name)
        {
            var s = Regex.Replace(name, @"[\[\(\{][^\]\)\}]*(flac|mp3|kbps|bit|khz|web|cd|vinyl|rip|24|16|320|v0|hi.?res|lossless|remaster)[^\]\)\}]*[\]\)\}]", "", RegexOptions.IgnoreCase);
            s = Regex.Replace(s, @"^\s*\(?(19|20)\d{2}\)?\s*[-–.]\s*", "");
            s = Regex.Replace(s, @"\s*[\(\[]?(19|20)\d{2}[\)\]]?\s*$", "");
            return Regex.Replace(s, @"\s+", " ").Trim(' ', '-', '–', '.');
        }

        /// <summary>A year in a folder's name: "(2007)", "2007 - ", " - 2007"; not part of a range like "1996-2006".</summary>
        internal static readonly Regex FolderYear = new Regex(@"(?<![\d\-–])(19[5-9]\d|20[0-4]\d)(?!\d|\s*[-–]\s*\d)");

        /// <summary>An album title as tags carry it, without what doesn't belong: "«multiple values»", a leading year.</summary>
        internal static string CleanAlbum(string album)
        {
            var s = Regex.Replace(album ?? "", @"«\s*multiple values\s*»|<\s*multiple values\s*>", "", RegexOptions.IgnoreCase);
            s = Regex.Replace(s, @"^\s*[\(\[]?(19|20)\d{2}[\)\]]?\s*[-–.]\s+", "");
            return Regex.Replace(s, @"\s+", " ").Trim();
        }

        public static string Safe(string segment)
        {
            var s = segment ?? "";
            // What Windows doesn't allow, written the way people usually do: "GO:OD AM" → "GO-OD AM", "Vicennial: 2 Decades" → "Vicennial - 2 Decades".
            s = Regex.Replace(s, @"\s*:\s+", " - ");
            s = s.Replace(":", "-").Replace("?", "").Replace("*", "").Replace("\"", "'").Replace("/", "-").Replace("\\", "-").Replace("<", "").Replace(">", "").Replace("|", "-");
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            s = s.Trim().TrimEnd('.', ' ');
            return s.Length == 0 ? "_" : s;
        }

        public static object Plan(string dir)
        {
            var root = AppSettings.LibraryRoot;
            var files = Directory.GetFiles(dir).Where(IsAudio).ToList();
            var artists = new List<string>();
            var albums = new List<string>();
            var years = new List<string>();
            int hires = 0, lossless = 0, mp3 = 0;
            foreach (var f in files)
            {
                var ext = Path.GetExtension(f).ToLowerInvariant();
                if (ext == ".mp3") mp3++;
                try
                {
                    using (var t = TagLib.File.Create(f, TagLib.ReadStyle.Average))
                    {
                        artists.Add(t.Tag.FirstAlbumArtist ?? t.Tag.FirstPerformer);
                        albums.Add(t.Tag.Album);
                        if (t.Tag.Year > 1900) years.Add(t.Tag.Year.ToString());
                        var p = t.Properties;
                        var isLossless = Lossless.Contains(ext) || (p?.Codecs?.Any(c => c?.Description?.IndexOf("lossless", StringComparison.OrdinalIgnoreCase) >= 0 || c?.Description?.IndexOf("ALAC", StringComparison.OrdinalIgnoreCase) >= 0) ?? false);
                        if (isLossless)
                        {
                            lossless++;
                            if ((p?.BitsPerSample ?? 0) > 16 || (p?.AudioSampleRate ?? 0) > 48000) hires++;
                        }
                    }
                }
                catch
                {
                    if (Lossless.Contains(ext)) lossless++;
                }
            }
            var name = Path.GetFileName(dir);
            var parent = Path.GetFileName(Path.GetDirectoryName(dir) ?? "");
            var artist = Clean(Most(artists));
            // No tags: the folder above the album is often the artist ("Bjork\1997 - Homogenic"), unless it's the downloads folder.
            var dl = Config.DownloadDir();
            var parentIsDownloads = string.Equals(Path.GetFullPath(Path.GetDirectoryName(dir) ?? "").TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(dl ?? "/").TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
            var guessed = false;
            if (string.IsNullOrEmpty(artist) && !parentIsDownloads && parent.Length > 0) { artist = parent; guessed = true; }
            var album = CleanAlbum(Most(albums));
            if (string.IsNullOrEmpty(album)) album = AlbumFromFolder(name);
            // "Radiohead - In Rainbows": the artist doesn't belong in the album's name.
            var lead = Most(artists) ?? parent;
            if (!string.IsNullOrEmpty(lead) && album.StartsWith(lead + " - ", StringComparison.OrdinalIgnoreCase)) album = album.Substring(lead.Length + 3).Trim();
            // The original year: tags often carry a reissue's year ("2004") while the folder says "1997".
            var year = Most(years);
            var fy = FolderYear.Match(name);
            if (fy.Success && (year == null || string.CompareOrdinal(fy.Value, year) < 0)) year = fy.Value;
            var format = files.Count == 0 ? "Other" : hires * 2 > files.Count ? "Hi-Res" : lossless * 2 > files.Count ? "FLAC" : mp3 * 2 > files.Count ? "MP3" : "Other";

            // Artist folders already in the library, in every format folder, to match against.
            var existing = new List<string>();
            if (!string.IsNullOrEmpty(root))
                foreach (var fmt in Formats)
                {
                    var d = Path.Combine(root, fmt);
                    if (Directory.Exists(d)) existing.AddRange(Directory.GetDirectories(d).Select(Path.GetFileName));
                }
            existing = existing.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            // Which format folders already have this artist (Daft Punk in FLAC doesn't mean Hi-Res\Daft Punk exists).
            Func<string, string[]> formatsOf = a => string.IsNullOrEmpty(root) ? new string[0] : Formats.Where(f => Directory.Exists(Path.Combine(root, f)) && Directory.GetDirectories(Path.Combine(root, f)).Any(d => Key(Path.GetFileName(d)) == Key(a))).ToArray();
            var key = Key(artist);
            string match = null;
            string group = null;
            // An artist kept inside a group folder ("FLAC\JP City Pop\Anri") goes there.
            if (!string.IsNullOrEmpty(root) && key.Length > 0 && !existing.Any(e => Key(e) == key))
                foreach (var fmt in Formats)
                    foreach (var g in AppSettings.Groups)
                    {
                        var gd = Path.Combine(root, fmt, g);
                        if (group != null || !Directory.Exists(gd)) continue;
                        var hit = Directory.GetDirectories(gd).Select(Path.GetFileName).FirstOrDefault(n => Key(n) == key);
                        if (hit != null) { group = g; match = hit; }
                    }
            var close = new List<string>();
            if (key.Length > 0 && group == null)
            {
                match = existing.FirstOrDefault(e => Key(e) == key);
                if (match == null)
                    close = existing.Where(e => { var k = Key(e); return k.Length > 3 && Distance(k, key) <= Math.Max(1, Math.Min(2, key.Length / 6)); }).Take(5).ToList();
            }
            return new
            {
                dir,
                root,
                tracks = files.Count,
                artist = match ?? artist,
                artistFromTags = artist,
                artistExists = match != null,
                artistFormats = group != null ? Formats.Where(f => Directory.Exists(Path.Combine(root, f, group, match))).ToArray() : match != null ? formatsOf(match) : new string[0],
                group,
                similar = close,
                album,
                year,
                format,
                formats = Formats,
                artistGuessed = guessed,
            };
        }

        // ---------------------------------------------------------------- moving

        internal sealed class Move
        {
            public string id, from, to, createdArtist, batch;
            public long at;
            public bool undone;
        }

        internal static List<Move> Log()
        {
            try { return Json.Deserialize<List<Move>>(File.ReadAllText(LogFile)) ?? new List<Move>(); } catch { return new List<Move>(); }
        }

        internal static void SaveLog(List<Move> log) => File.WriteAllText(LogFile, Json.Serialize(log.Skip(Math.Max(0, log.Count - 500)).ToList()), new UTF8Encoding(false));

        internal static bool Under(string path, string root) =>
            !string.IsNullOrEmpty(root) && Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        static bool SameVolume(string a, string b) => string.Equals(Path.GetPathRoot(Path.GetFullPath(a)), Path.GetPathRoot(Path.GetFullPath(b)), StringComparison.OrdinalIgnoreCase);

        /// <summary>Moves a folder, copying and checking sizes first when it goes to another drive.</summary>
        internal static void MoveDir(string from, string to)
        {
            try
            {
                if (SameVolume(from, to)) { Directory.Move(from, to); return; }
                CopyDir(from, to);
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(from, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                // Windows won't move a folder while one of its files is open, and only says "access denied" (in the
                // system's language). Name the files instead: usually a track still playing, or open in another app.
                var open = OpenFiles(from);
                if (open.Count == 0) throw;
                var names = string.Join(", ", open.Take(3)) + (open.Count > 3 ? " and " + (open.Count - 3) + " more" : "");
                throw new IOException((open.Count == 1 ? "a file in it is" : "files in it are") + " open, playing or in another app (" + names + "). Stop playback or close that app, then try again.", e);
            }
        }

        /// <summary>The files in a folder that something else has open right now (they can't be opened exclusively).</summary>
        static List<string> OpenFiles(string dir)
        {
            var open = new List<string>();
            try
            {
                foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try { using (new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.None)) { } }
                    catch (IOException) { open.Add(Path.GetFileName(f)); }
                    catch (UnauthorizedAccessException) { }
                }
            }
            catch { }
            return open;
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from))
            {
                var dest = Path.Combine(to, Path.GetFileName(f));
                File.Copy(f, dest, false);
                if (new FileInfo(dest).Length != new FileInfo(f).Length) throw new IOException("Copy of " + Path.GetFileName(f) + " doesn't match the original.");
            }
            foreach (var d in Directory.GetDirectories(from)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        internal static bool SameContents(string a, string b)
        {
            var fa = Directory.GetFiles(a, "*", SearchOption.AllDirectories).Select(f => (f.Substring(a.Length).ToLowerInvariant(), new FileInfo(f).Length)).OrderBy(x => x.Item1).ToList();
            var fb = Directory.GetFiles(b, "*", SearchOption.AllDirectories).Select(f => (f.Substring(b.Length).ToLowerInvariant(), new FileInfo(f).Length)).OrderBy(x => x.Item1).ToList();
            return fa.SequenceEqual(fb);
        }

        public static object Apply(string dir, string format, string artist, string folder, string group = null)
        {
            lock (Gate)
            {
                var root = AppSettings.LibraryRoot;
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return new { ok = false, error = "Choose your library folder in Settings first." };
                var dl = Config.DownloadDir();
                if (!Under(dir, dl) || !Directory.Exists(dir)) return new { ok = false, error = "That album isn't in your downloads folder any more." };
                if (!Formats.Contains(format)) return new { ok = false, error = "Unknown format folder." };
                if (string.IsNullOrWhiteSpace(artist) || string.IsNullOrWhiteSpace(folder)) return new { ok = false, error = "The artist and the album folder need a name." };

                var artistDir = string.IsNullOrWhiteSpace(group) ? Path.Combine(root, format, Safe(artist)) : Path.Combine(root, format, Safe(group), Safe(artist));
                var createdArtist = !Directory.Exists(artistDir);
                var to = Path.Combine(artistDir, Safe(folder));
                if (!Under(to, root)) return new { ok = false, error = "That name would leave the library folder." };

                if (Directory.Exists(to))
                {
                    if (SameContents(dir, to))
                    {
                        // Already there, identically: the download is a duplicate.
                        Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(dir, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                        Log2("Album already in the library; download moved to the Recycle Bin: " + dir);
                        return new { ok = true, to, duplicate = true };
                    }
                    var n = 2;
                    var baseTo = to;
                    while (Directory.Exists(to)) to = baseTo + " (" + n++ + ")";
                }
                Directory.CreateDirectory(artistDir);
                try { MoveDir(dir, to); }
                catch (Exception e)
                {
                    if (createdArtist) try { if (!Directory.EnumerateFileSystemEntries(artistDir).Any()) Directory.Delete(artistDir); } catch { }
                    return new { ok = false, error = "Couldn't move it: " + e.Message };
                }
                // Folders the album leaves empty in Downloads ("Bjork" after "Bjork\1997 - Homogenic") go too.
                try
                {
                    var up = Path.GetDirectoryName(dir);
                    while (up != null && Under(up, dl) && !Directory.EnumerateFileSystemEntries(up).Any()) { Directory.Delete(up); up = Path.GetDirectoryName(up); }
                }
                catch { }
                var move = new Move { id = Guid.NewGuid().ToString("N"), from = dir, to = to, createdArtist = createdArtist ? artistDir : null, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                var log = Log();
                log.Add(move);
                SaveLog(log);
                Log2("Organized " + dir + " → " + to);
                return new { ok = true, to, id = move.id, newArtist = createdArtist };
            }
        }

        public static object Undo(string id)
        {
            lock (Gate)
            {
                var log = Log();
                var m = log.FirstOrDefault(x => x.id == id && !x.undone);
                if (m == null) return new { ok = false, error = "Nothing to undo." };
                if (!Directory.Exists(m.to)) return new { ok = false, error = "The album isn't where Nightjar put it any more." };
                if (Directory.Exists(m.from)) return new { ok = false, error = "Something else is already where the album was." };
                Directory.CreateDirectory(Path.GetDirectoryName(m.from));
                MoveDir(m.to, m.from);
                if (m.createdArtist != null) try { if (!Directory.EnumerateFileSystemEntries(m.createdArtist).Any()) Directory.Delete(m.createdArtist); } catch { }
                m.undone = true;
                SaveLog(log);
                Log2("Undid " + m.to + " → " + m.from);
                return new { ok = true, to = m.from };
            }
        }

        public static object Recent() => Log().Where(m => !m.undone && m.batch == null).Reverse().Take(20).Select(m => new { m.id, m.from, m.to, m.at }).ToList();

        static void Log2(string s) => Nightjar.Log.Write(s);
    }
}
