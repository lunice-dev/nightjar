using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Nightjar
{
    /// <summary>
    /// Your playlists, kept on this computer (data\playlists.json) so every device sees the same ones.
    /// A track remembers its file and what it is (artist, title, album). When the file has moved (Tidy,
    /// Put in library) it is found again by artist and title in the library, and the playlist follows it.
    /// </summary>
    static class Playlists
    {
        static string File => Path.Combine(Paths.Data, "playlists.json");
        static string CoverDir => Path.Combine(Paths.Data, "playlist-covers");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly object Gate = new object();

        public sealed class Entry
        {
            public string path { get; set; }
            public string dir { get; set; }
            public string title { get; set; }
            public string artist { get; set; }
            public string album { get; set; }
            public double seconds { get; set; }
            public string format { get; set; }
            public int bits { get; set; }
            public int rate { get; set; }
            public int kbps { get; set; }
            public int no { get; set; }
        }

        public sealed class Playlist
        {
            public string id { get; set; }
            public string name { get; set; }
            public string created { get; set; }
            public string updated { get; set; }
            /// <summary>"album:&lt;folder&gt;" or "image:&lt;file in data\playlist-covers&gt;"; null = a mosaic of its albums.</summary>
            public string cover { get; set; }
            public List<Entry> tracks { get; set; } = new List<Entry>();
        }

        static List<Playlist> Load()
        {
            try { return Json.Deserialize<List<Playlist>>(System.IO.File.ReadAllText(File)) ?? new List<Playlist>(); }
            catch { return new List<Playlist>(); }
        }

        static void Save(List<Playlist> all)
        {
            Directory.CreateDirectory(Paths.Data);
            var tmp = File + ".tmp";
            System.IO.File.WriteAllText(tmp, Json.Serialize(all), new UTF8Encoding(false));
            if (System.IO.File.Exists(File)) System.IO.File.Replace(tmp, File, null); else System.IO.File.Move(tmp, File);
        }

        static string NewId()
        {
            var b = new byte[9];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return Convert.ToBase64String(b).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        static string Now() => DateTime.UtcNow.ToString("o");

        /// <summary>Up to four different album folders, for the mosaic.</summary>
        static List<string> MosaicDirs(Playlist p) => p.tracks.Select(t => t.dir).Where(d => !string.IsNullOrEmpty(d)).Distinct(StringComparer.OrdinalIgnoreCase).Take(4).ToList();

        static object Summary(Playlist p) => new
        {
            p.id,
            p.name,
            p.created,
            p.updated,
            p.cover,
            count = p.tracks.Count,
            seconds = Math.Round(p.tracks.Sum(t => t.seconds)),
            mosaic = MosaicDirs(p),
        };

        public static object List()
        {
            lock (Gate) return Load().OrderByDescending(p => p.updated).Select(Summary).ToList();
        }

        /// <summary>One playlist with its tracks; moved files are found again (and remembered), lost ones marked missing.</summary>
        public static object Get(string id)
        {
            lock (Gate)
            {
                var all = Load();
                var p = all.FirstOrDefault(x => x.id == id);
                if (p == null) return null;
                bool changed = false;
                var tracks = new List<object>();
                foreach (var t in p.tracks)
                {
                    bool missing = false;
                    if (!System.IO.File.Exists(t.path))
                    {
                        var found = FindAgain(t);
                        if (found != null)
                        {
                            Log.Write("Playlist " + p.name + ": " + t.title + " moved to " + found);
                            t.path = found;
                            t.dir = Path.GetDirectoryName(found);
                            changed = true;
                        }
                        else missing = true;
                    }
                    tracks.Add(new { t.path, t.dir, t.title, t.artist, t.album, t.seconds, t.format, t.bits, t.rate, t.kbps, t.no, missing });
                }
                if (changed) { p.updated = Now(); Save(all); }
                return new { p.id, p.name, p.created, p.updated, p.cover, mosaic = MosaicDirs(p), tracks };
            }
        }

        /// <summary>Everything that changes playlists: create, rename, delete, add, remove, move, cover.</summary>
        public static object Change(Dictionary<string, object> body)
        {
            string V(string k) => body.TryGetValue(k, out var v) ? v as string : null;
            int I(string k) => body.TryGetValue(k, out var v) && v is int i ? i : -1;
            var action = V("action");
            lock (Gate)
            {
                var all = Load();
                if (action == "create")
                {
                    var name = Clean(V("name"));
                    if (name.Length == 0) return new { ok = false, error = "Give the playlist a name." };
                    var p = new Playlist { id = NewId(), name = name, created = Now(), updated = Now() };
                    p.tracks.AddRange(Entries(body));
                    all.Add(p);
                    Save(all);
                    Log.Write("Playlist created: " + name + " (" + p.tracks.Count + " tracks)");
                    return new { ok = true, playlist = Summary(p) };
                }
                var pl = all.FirstOrDefault(x => x.id == V("id"));
                if (pl == null) return new { ok = false, error = "That playlist doesn't exist any more." };
                switch (action)
                {
                    case "rename":
                        {
                            var name = Clean(V("name"));
                            if (name.Length == 0) return new { ok = false, error = "Give the playlist a name." };
                            pl.name = name;
                            break;
                        }
                    case "delete":
                        all.Remove(pl);
                        DropImage(pl);
                        Save(all);
                        Log.Write("Playlist deleted: " + pl.name);
                        return new { ok = true };
                    case "add":
                        {
                            var add = Entries(body).ToList();
                            pl.tracks.AddRange(add);
                            pl.updated = Now();
                            Save(all);
                            return new { ok = true, added = add.Count, playlist = Summary(pl) };
                        }
                    case "remove":
                        {
                            var i = I("index");
                            if (i < 0 || i >= pl.tracks.Count) return new { ok = false, error = "That track isn't in the playlist." };
                            pl.tracks.RemoveAt(i);
                            break;
                        }
                    case "move":
                        {
                            int from = I("from"), to = I("to");
                            if (from < 0 || from >= pl.tracks.Count || to < 0 || to >= pl.tracks.Count) return new { ok = false, error = "Couldn't move that track." };
                            var t = pl.tracks[from];
                            pl.tracks.RemoveAt(from);
                            pl.tracks.Insert(to, t);
                            break;
                        }
                    case "cover":
                        {
                            var dir = V("dir");
                            if (string.IsNullOrEmpty(dir)) { DropImage(pl); pl.cover = null; }
                            else { DropImage(pl); pl.cover = "album:" + dir; }
                            break;
                        }
                    default:
                        return new { ok = false, error = "unknown" };
                }
                pl.updated = Now();
                Save(all);
                return new { ok = true, playlist = Summary(pl) };
            }
        }

        /// <summary>A picture sent from a device becomes the playlist's cover (made at most 1000 px, saved as JPEG).</summary>
        public static object SetImage(string id, byte[] data)
        {
            if (data == null || data.Length == 0) return new { ok = false, error = "No picture arrived." };
            lock (Gate)
            {
                var all = Load();
                var pl = all.FirstOrDefault(x => x.id == id);
                if (pl == null) return new { ok = false, error = "That playlist doesn't exist any more." };
                try
                {
                    Directory.CreateDirectory(CoverDir);
                    var file = Path.Combine(CoverDir, pl.id + "-" + DateTime.UtcNow.Ticks + ".jpg");
                    using (var ms = new MemoryStream(data))
                    using (var img = System.Drawing.Image.FromStream(ms))
                    {
                        var scale = Math.Min(1.0, 1000.0 / Math.Max(img.Width, img.Height));
                        int w = Math.Max(1, (int)(img.Width * scale)), h = Math.Max(1, (int)(img.Height * scale));
                        // A square, cut from the middle, like album art.
                        int side = Math.Min(w, h);
                        using (var bmp = new System.Drawing.Bitmap(side, side))
                        using (var g = System.Drawing.Graphics.FromImage(bmp))
                        {
                            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                            g.DrawImage(img, -(w - side) / 2, -(h - side) / 2, w, h);
                            bmp.Save(file, System.Drawing.Imaging.ImageFormat.Jpeg);
                        }
                    }
                    DropImage(pl);
                    pl.cover = "image:" + file;
                    pl.updated = Now();
                    Save(all);
                    return new { ok = true, playlist = Summary(pl) };
                }
                catch (Exception e)
                {
                    Log.Write("Playlist cover not saved: " + e.Message);
                    return new { ok = false, error = "That picture couldn't be read. Try a JPEG or PNG." };
                }
            }
        }

        static void DropImage(Playlist pl)
        {
            if (pl.cover != null && pl.cover.StartsWith("image:"))
                try { System.IO.File.Delete(pl.cover.Substring(6)); } catch { }
        }

        static string Clean(string s)
        {
            s = Regex.Replace(s ?? "", @"[\x00-\x1f]", "").Trim();
            return s.Length > 80 ? s.Substring(0, 80) : s;
        }

        /// <summary>The tracks sent with "add" or "create": only files inside your music folders.</summary>
        static IEnumerable<Entry> Entries(Dictionary<string, object> body)
        {
            if (!body.TryGetValue("tracks", out var v) || !(v is System.Collections.ArrayList list)) yield break;
            foreach (var o in list.OfType<Dictionary<string, object>>())
            {
                string S(string k) => o.TryGetValue(k, out var x) ? Convert.ToString(x, CultureInfo.InvariantCulture) : null;
                double D(string k) => o.TryGetValue(k, out var x) && x != null ? Convert.ToDouble(x, CultureInfo.InvariantCulture) : 0;
                var path = Media.Allowed(S("path"));
                if (path == null) continue;
                yield return new Entry
                {
                    path = path,
                    dir = S("dir") ?? Path.GetDirectoryName(path),
                    title = S("title") ?? Path.GetFileNameWithoutExtension(path),
                    artist = S("artist"),
                    album = S("album"),
                    seconds = D("seconds"),
                    format = S("format") ?? Path.GetExtension(path).TrimStart('.').ToLowerInvariant(),
                    bits = (int)D("bits"),
                    rate = (int)D("rate"),
                    kbps = (int)D("kbps"),
                    no = (int)D("no"),
                };
            }
        }

        // --- finding moved files again --------------------------------------------------

        static Dictionary<string, List<string>> byName;
        static DateTime byNameAt;

        static string Norm(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var d = s.Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder();
            foreach (var c in d)
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark && char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
            return sb.ToString();
        }

        /// <summary>The library's audio files by a normalised file name, rebuilt at most every 10 minutes.</summary>
        static Dictionary<string, List<string>> Index()
        {
            if (byName != null && (DateTime.UtcNow - byNameAt).TotalMinutes < 10) return byName;
            var idx = new Dictionary<string, List<string>>();
            foreach (var root in new[] { AppSettings.LibraryRoot, Config.DownloadDir() }.Where(r => !string.IsNullOrEmpty(r) && Directory.Exists(r)).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                    {
                        if (!Media.IsAudio(f)) continue;
                        var key = Norm(Path.GetFileNameWithoutExtension(f));
                        if (!idx.TryGetValue(key, out var l)) idx[key] = l = new List<string>();
                        l.Add(f);
                    }
                }
                catch { }
            }
            byName = idx;
            byNameAt = DateTime.UtcNow;
            return idx;
        }

        /// <summary>The same song somewhere else in the library: a file whose name contains the title and whose tags agree.</summary>
        static string FindAgain(Entry t)
        {
            var title = Norm(t.title);
            if (title.Length < 2) return null;
            var artist = Norm(t.artist);
            foreach (var kv in Index())
            {
                if (!kv.Key.Contains(title)) continue;
                foreach (var f in kv.Value)
                {
                    try
                    {
                        using (var tag = TagLib.File.Create(f))
                        {
                            if (Norm(tag.Tag.Title) != title) continue;
                            var a = Norm(tag.Tag.FirstPerformer ?? tag.Tag.FirstAlbumArtist);
                            if (artist.Length > 0 && a.Length > 0 && a != artist) continue;
                            return f;
                        }
                    }
                    catch { }
                }
            }
            return null;
        }
    }
}
