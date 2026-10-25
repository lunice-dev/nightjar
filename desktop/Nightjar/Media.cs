using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using NAudio.MediaFoundation;
using NAudio.Wave;

namespace Nightjar
{
    /// <summary>
    /// Playing your music on a phone (or in the app): the tracks of an album, the files
    /// themselves with byte ranges (iPhones ask for audio in pieces), and, when asked, an
    /// AAC copy made with the encoder built into Windows: for hi-res files a phone may not
    /// play, and to use less mobile data. Copies are kept in data\stream-cache (up to 2 GB).
    /// Only files inside the library, the download folder and the shared folders are served.
    /// </summary>
    static class Media
    {
        static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".flac"] = "audio/flac", [".mp3"] = "audio/mpeg", [".m4a"] = "audio/mp4", [".alac"] = "audio/mp4", [".aac"] = "audio/aac",
            [".wav"] = "audio/wav", [".aif"] = "audio/aiff", [".aiff"] = "audio/aiff", [".ogg"] = "audio/ogg", [".opus"] = "audio/ogg",
        };
        static string Cache => Path.Combine(Paths.Data, "stream-cache");
        static string FlacExe => Path.Combine(Paths.Root, "tools", "flac.exe");
        const long CacheLimit = 2L * 1024 * 1024 * 1024;

        /// <summary>The folders whose music may be played: library, downloads, shared folders.</summary>
        static List<string> Roots()
        {
            var roots = new List<string>();
            foreach (var r in new[] { AppSettings.LibraryRoot, Config.DownloadDir() }.Concat(Config.ShareDirs()))
            {
                if (string.IsNullOrEmpty(r)) continue;
                try { roots.Add(Path.GetFullPath(r).TrimEnd('\\') + "\\"); } catch { }
            }
            return roots;
        }

        /// <summary>The full path when it is inside one of the allowed folders; otherwise null.</summary>
        public static string Allowed(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            string full;
            try { full = Path.GetFullPath(path); } catch { return null; }
            return Roots().Any(r => full.StartsWith(r, StringComparison.OrdinalIgnoreCase) || (full + "\\").Equals(r, StringComparison.OrdinalIgnoreCase)) ? full : null;
        }

        public static bool IsAudio(string file) => Types.ContainsKey(Path.GetExtension(file));

        /// <summary>An album's tracks (disc folders included), in play order, with what the tags say.</summary>
        public static object Tracks(string dir)
        {
            var full = Allowed(dir);
            if (full == null || !Directory.Exists(full)) return null;
            var files = Directory.GetFiles(full, "*", SearchOption.AllDirectories).Where(IsAudio).ToList();
            var tracks = files.Select(f =>
            {
                string title = null, artist = null, album = null;
                uint no = 0, disc = 0;
                double seconds = 0;
                int bits = 0, rate = 0, kbps = 0;
                try
                {
                    using (var t = TagLib.File.Create(f))
                    {
                        title = t.Tag.Title;
                        artist = t.Tag.FirstPerformer ?? t.Tag.FirstAlbumArtist;
                        album = t.Tag.Album;
                        no = t.Tag.Track;
                        disc = t.Tag.Disc;
                        seconds = t.Properties.Duration.TotalSeconds;
                        bits = t.Properties.BitsPerSample;
                        rate = t.Properties.AudioSampleRate;
                        kbps = t.Properties.AudioBitrate;
                    }
                }
                catch { }
                // Disc folders ("CD2") count as disc numbers when the tags don't say.
                if (disc == 0)
                {
                    var m = Regex.Match(Path.GetDirectoryName(f).Substring(full.Length), @"(?i)(?:cd|disc|disk)\s*(\d+)");
                    if (m.Success) uint.TryParse(m.Groups[1].Value, out disc);
                }
                return new
                {
                    path = f,
                    title = string.IsNullOrWhiteSpace(title) ? Path.GetFileNameWithoutExtension(f) : title,
                    artist,
                    album,
                    no = (int)no,
                    disc = (int)disc,
                    seconds = Math.Round(seconds, 1),
                    format = Path.GetExtension(f).TrimStart('.').ToLowerInvariant(),
                    bits,
                    rate,
                    kbps,
                    size = new FileInfo(f).Length,
                };
            })
            .OrderBy(t => t.disc).ThenBy(t => t.no == 0 ? int.MaxValue : t.no).ThenBy(t => t.path, StringComparer.OrdinalIgnoreCase)
            .ToList();
            return new { dir = full, tracks };
        }

        // --- sending a file -----------------------------------------------------------

        /// <summary>Sends a file, or the byte range the player asked for ("Range: bytes=a-b").</summary>
        public static void Send(Stream stream, string file, string range, string type)
        {
            using (var f = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16))
            {
                long length = f.Length, start = 0, end = length - 1;
                bool partial = false;
                var m = Regex.Match(range ?? "", @"^bytes=(\d*)-(\d*)$");
                if (m.Success && length > 0)
                {
                    if (m.Groups[1].Value.Length > 0)
                    {
                        start = long.Parse(m.Groups[1].Value);
                        if (m.Groups[2].Value.Length > 0) end = Math.Min(length - 1, long.Parse(m.Groups[2].Value));
                    }
                    else if (m.Groups[2].Value.Length > 0)
                    {
                        start = Math.Max(0, length - long.Parse(m.Groups[2].Value)); // the last N bytes
                    }
                    if (start > end || start >= length)
                    {
                        Head(stream, "416 Range Not Satisfiable", type, 0, "Content-Range: bytes */" + length + "\r\n");
                        return;
                    }
                    partial = true;
                }
                var count = end - start + 1;
                Head(stream, partial ? "206 Partial Content" : "200 OK", type, count,
                    "Accept-Ranges: bytes\r\n" + (partial ? "Content-Range: bytes " + start + "-" + end + "/" + length + "\r\n" : ""));
                f.Position = start;
                var buf = new byte[1 << 16];
                while (count > 0)
                {
                    var n = f.Read(buf, 0, (int)Math.Min(buf.Length, count));
                    if (n <= 0) break;
                    stream.Write(buf, 0, n);
                    count -= n;
                }
            }
        }

        // --- FLAC as a WAV stream (for Apple devices) ---------------------------------------

        /// <summary>Sample rate, channels, bits and length of a FLAC file, from its STREAMINFO block; null when unreadable.</summary>
        static (int rate, int channels, int bits, long samples)? FlacInfo(string file)
        {
            try
            {
                using (var f = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    var head = new byte[4];
                    if (f.Read(head, 0, 4) != 4) return null;
                    // An ID3 tag in front of the FLAC data: skip it.
                    if (head[0] == 'I' && head[1] == 'D' && head[2] == '3')
                    {
                        var id3 = new byte[6];
                        f.Read(id3, 0, 6);
                        var size = (id3[2] & 0x7f) << 21 | (id3[3] & 0x7f) << 14 | (id3[4] & 0x7f) << 7 | (id3[5] & 0x7f);
                        f.Position = 10 + size;
                        if (f.Read(head, 0, 4) != 4) return null;
                    }
                    if (head[0] != 'f' || head[1] != 'L' || head[2] != 'a' || head[3] != 'C') return null;
                    var block = new byte[4 + 34];
                    if (f.Read(block, 0, block.Length) != block.Length || (block[0] & 0x7f) != 0) return null;
                    var si = new byte[34];
                    Array.Copy(block, 4, si, 0, 34);
                    int rate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
                    int channels = ((si[12] >> 1) & 7) + 1;
                    int bits = (((si[12] & 1) << 4) | (si[13] >> 4)) + 1;
                    long samples = ((long)(si[13] & 0x0f) << 32) | ((long)si[14] << 24) | ((long)si[15] << 16) | ((long)si[16] << 8) | si[17];
                    if (rate <= 0 || samples <= 0 || (bits != 16 && bits != 24) || channels > 2) return null;
                    return (rate, channels, bits, samples);
                }
            }
            catch { return null; }
        }

        public static bool CanSendPcm(string file) =>
            Path.GetExtension(file).Equals(".flac", StringComparison.OrdinalIgnoreCase) && File.Exists(FlacExe) && FlacInfo(file) != null;

        /// <summary>
        /// The FLAC file unpacked to WAV, bit for bit, decoded only from the point the player asks for: the
        /// header is worked out from the file's length, and flac.exe starts at the right sample. Starts at once
        /// and jumps exactly, where Safari's own FLAC playback drifts when you skip around.
        /// </summary>
        public static void SendPcm(Stream stream, string file, string range)
        {
            var info = FlacInfo(file).Value;
            int bytesPerSample = info.bits / 8;
            int frame = bytesPerSample * info.channels;
            long dataLength = info.samples * frame;
            long length = 44 + dataLength;

            long start = 0, end = length - 1;
            bool partial = false;
            var m = Regex.Match(range ?? "", @"^bytes=(\d*)-(\d*)$");
            if (m.Success)
            {
                if (m.Groups[1].Value.Length > 0)
                {
                    start = long.Parse(m.Groups[1].Value);
                    if (m.Groups[2].Value.Length > 0) end = Math.Min(length - 1, long.Parse(m.Groups[2].Value));
                }
                else if (m.Groups[2].Value.Length > 0) start = Math.Max(0, length - long.Parse(m.Groups[2].Value));
                if (start > end || start >= length)
                {
                    Head(stream, "416 Range Not Satisfiable", "audio/wav", 0, "Content-Range: bytes */" + length + "\r\n");
                    return;
                }
                partial = true;
            }
            long count = end - start + 1;
            Head(stream, partial ? "206 Partial Content" : "200 OK", "audio/wav", count,
                "Accept-Ranges: bytes\r\n" + (partial ? "Content-Range: bytes " + start + "-" + end + "/" + length + "\r\n" : ""));

            // The 44-byte header, or the part of it that was asked for.
            if (start < 44)
            {
                var header = WavHeader(info.rate, info.channels, info.bits, dataLength);
                var n = (int)Math.Min(44 - start, count);
                stream.Write(header, (int)start, n);
                start += n;
                count -= n;
            }
            if (count <= 0) return;

            long offset = start - 44;
            long firstSample = offset / frame;
            int drop = (int)(offset % frame);
            var psi = new ProcessStartInfo(FlacExe,
                "-d -c -s --force-raw-format --endian=little --sign=signed" + (firstSample > 0 ? " --skip=" + firstSample : "") + " \"" + file + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (var p = Process.Start(psi))
            {
                p.ErrorDataReceived += (s, e) => { };
                p.BeginErrorReadLine();
                try
                {
                    var src = p.StandardOutput.BaseStream;
                    var buf = new byte[1 << 16];
                    while (drop > 0)
                    {
                        var n = src.Read(buf, 0, drop);
                        if (n <= 0) break;
                        drop -= n;
                    }
                    while (count > 0)
                    {
                        var n = src.Read(buf, 0, (int)Math.Min(buf.Length, count));
                        if (n <= 0) break;
                        stream.Write(buf, 0, n);
                        count -= n;
                    }
                    // A damaged file can come out short: pad with silence, so the player isn't left waiting.
                    if (count > 0)
                    {
                        Array.Clear(buf, 0, buf.Length);
                        while (count > 0)
                        {
                            var n = (int)Math.Min(buf.Length, count);
                            stream.Write(buf, 0, n);
                            count -= n;
                        }
                    }
                }
                finally
                {
                    try { if (!p.HasExited) p.Kill(); } catch { }
                }
            }
        }

        static byte[] WavHeader(int rate, int channels, int bits, long dataLength)
        {
            var h = new byte[44];
            void Text(int at, string t) { for (int i = 0; i < 4; i++) h[at + i] = (byte)t[i]; }
            void U32(int at, long v) { h[at] = (byte)v; h[at + 1] = (byte)(v >> 8); h[at + 2] = (byte)(v >> 16); h[at + 3] = (byte)(v >> 24); }
            void U16(int at, int v) { h[at] = (byte)v; h[at + 1] = (byte)(v >> 8); }
            var data = (uint)Math.Min(dataLength, uint.MaxValue - 36);
            Text(0, "RIFF"); U32(4, 36 + data); Text(8, "WAVE");
            Text(12, "fmt "); U32(16, 16); U16(20, 1); U16(22, channels); U32(24, rate);
            U32(28, (long)rate * channels * bits / 8); U16(32, channels * bits / 8); U16(34, bits);
            Text(36, "data"); U32(40, data);
            return h;
        }

        static void Head(Stream stream, string status, string type, long length, string extra)
        {
            var h = Encoding.ASCII.GetBytes(
                "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + length +
                "\r\nCache-Control: private, max-age=86400\r\n" + extra + "Connection: close\r\n\r\n");
            stream.Write(h, 0, h.Length);
        }

        public static string TypeOf(string file) => Types.TryGetValue(Path.GetExtension(file), out var t) ? t : "application/octet-stream";

        // --- AAC copies -------------------------------------------------------------------

        static readonly ConcurrentDictionary<string, Task<string>> making = new ConcurrentDictionary<string, Task<string>>();

        /// <summary>Formats Nightjar can turn into AAC (decoded by flac.exe or read directly).</summary>
        public static bool CanConvert(string file) => Regex.IsMatch(Path.GetExtension(file), @"(?i)^\.(flac|wav|aiff?)$");

        /// <summary>
        /// An AAC copy at the given bitrate (kbit/s), made once and then kept. Several requests
        /// for the same copy wait for the same work.
        /// </summary>
        public static Task<string> Aac(string file, int kbps)
        {
            kbps = kbps <= 160 ? 128 : 256;
            var fi = new FileInfo(file);
            string name;
            using (var sha = SHA1.Create())
                name = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(fi.FullName.ToLowerInvariant() + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks + "|" + kbps)))
                    .Replace("-", "").ToLowerInvariant() + ".m4a";
            var target = Path.Combine(Cache, name);
            if (File.Exists(target))
            {
                try { File.SetLastAccessTimeUtc(target, DateTime.UtcNow); } catch { }
                return Task.FromResult(target);
            }
            return making.GetOrAdd(target, key => Task.Run(() =>
            {
                try { return MakeAac(fi.FullName, target, kbps); }
                finally { making.TryRemove(target, out _); }
            }));
        }

        static string MakeAac(string source, string target, int kbps)
        {
            Directory.CreateDirectory(Cache);
            var work = target + ".part.m4a";
            string pcm = null;
            // What the reader reads from: a RawSourceWaveStream doesn't close it, so it is closed here.
            Stream inner = null;
            try
            {
                WaveStream reader;
                if (Path.GetExtension(source).Equals(".flac", StringComparison.OrdinalIgnoreCase))
                {
                    if (!File.Exists(FlacExe)) throw new FileNotFoundException("The FLAC decoder is missing; install Nightjar again.");
                    var info = FlacInfo(source) ?? throw new InvalidDataException("Nightjar can make phone copies of 16- and 24-bit mono or stereo FLAC only.");
                    pcm = target + ".pcm";
                    // Raw samples through standard output, as playing does. Written to a file, flac.exe deletes it
                    // again when the FLAC ends in junk (an old ID3v1 tag, common), though every sample was there.
                    var psi = new ProcessStartInfo(FlacExe, "-d -c -s --force-raw-format --endian=little --sign=signed \"" + source + "\"")
                    {
                        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    };
                    string err;
                    using (var p = Process.Start(psi))
                    {
                        var errTask = p.StandardError.ReadToEndAsync();
                        using (var file = File.Create(pcm)) p.StandardOutput.BaseStream.CopyTo(file);
                        p.WaitForExit();
                        err = errTask.Result;
                    }
                    // Short means damaged before the end of the music (a junk tag after it costs nothing).
                    long expected = info.samples * info.channels * (info.bits / 8);
                    if (new FileInfo(pcm).Length < expected * 0.98) throw new Exception("The FLAC decoder couldn't read this file. " + err.Trim());
                    inner = File.OpenRead(pcm);
                    reader = new RawSourceWaveStream(inner, new WaveFormat(info.rate, info.bits, info.channels));
                }
                else
                {
                    reader = Path.GetExtension(source).StartsWith(".aif", StringComparison.OrdinalIgnoreCase) ? (WaveStream)new AiffFileReader(source) : new WaveFileReader(source);
                    // A 24-bit or multichannel WAV says "extensible"; Windows' resampler takes it as the plain PCM it is.
                    if (reader.WaveFormat.Encoding == WaveFormatEncoding.Extensible && reader.WaveFormat.BitsPerSample != 32)
                    {
                        var wf = reader.WaveFormat;
                        inner = reader;
                        reader = new RawSourceWaveStream(inner, new WaveFormat(wf.SampleRate, wf.BitsPerSample, wf.Channels));
                    }
                }
                MediaFoundationApi.Startup();
                using (reader)
                {
                    var f = reader.WaveFormat;
                    // Windows' AAC encoder takes 16-bit 44.1 or 48 kHz, mono or stereo.
                    var rate = f.SampleRate % 44100 == 0 ? 44100 : 48000;
                    var channels = Math.Min(2, f.Channels);
                    IWaveProvider audio = reader;
                    MediaFoundationResampler resampler = null;
                    if (f.SampleRate != rate || f.BitsPerSample != 16 || f.Channels != channels || f.Encoding != WaveFormatEncoding.Pcm)
                        audio = resampler = new MediaFoundationResampler(reader, new WaveFormat(rate, 16, channels)) { ResamplerQuality = 60 };
                    try
                    {
                        if (File.Exists(work)) File.Delete(work);
                        MediaFoundationEncoder.EncodeToAac(audio, work, kbps * 1000);
                    }
                    finally { resampler?.Dispose(); }
                }
                if (File.Exists(target)) File.Delete(target);
                File.Move(work, target);
                Trim();
                return target;
            }
            catch (Exception e)
            {
                Log.Write("Couldn't make an AAC copy of " + source + ": " + e.Message);
                throw;
            }
            finally
            {
                try { inner?.Dispose(); } catch { }
                try { if (pcm != null) File.Delete(pcm); } catch { }
                try { if (File.Exists(work)) File.Delete(work); } catch { }
            }
        }

        /// <summary>Keeps the cache under its limit, dropping the copies played longest ago.</summary>
        static void Trim()
        {
            try
            {
                var files = new DirectoryInfo(Cache).GetFiles("*.m4a").Where(x => !x.Name.Contains(".part")).OrderByDescending(x => x.LastAccessTimeUtc).ToList();
                long total = 0;
                foreach (var f in files)
                {
                    total += f.Length;
                    if (total > CacheLimit) try { f.Delete(); } catch { }
                }
            }
            catch { }
        }

        // --- folders, for choosing one from a phone ------------------------------------------

        /// <summary>The folders inside a folder (or the drives and usual places when none is given).</summary>
        public static object Folders(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                var places = new List<object>();
                void Add(string label, string p) { if (!string.IsNullOrEmpty(p) && Directory.Exists(p)) places.Add(new { name = label, path = p }); }
                Add("Music", Environment.GetFolderPath(Environment.SpecialFolder.MyMusic));
                Add("Your library", AppSettings.LibraryRoot);
                Add("Downloads folder", Config.DownloadDir());
                Add("Your user folder", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
                foreach (var d in DriveInfo.GetDrives().Where(d => { try { return d.IsReady && (d.DriveType == DriveType.Fixed || d.DriveType == DriveType.Removable || d.DriveType == DriveType.Network); } catch { return false; } }))
                    places.Add(new { name = d.Name.TrimEnd('\\') + (string.IsNullOrEmpty(SafeLabel(d)) ? "" : " (" + SafeLabel(d) + ")"), path = d.RootDirectory.FullName });
                return new { path = (string)null, parent = (string)null, folders = places };
            }
            var full = Path.GetFullPath(path);
            if (!Directory.Exists(full)) return new { path = full, parent = (string)null, folders = new List<object>(), error = "That folder doesn't exist." };
            var list = new DirectoryInfo(full).EnumerateDirectories()
                .Where(d => { try { return (d.Attributes & (FileAttributes.Hidden | FileAttributes.System)) == 0; } catch { return false; } })
                .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
                .Take(2000)
                .Select(d => (object)new { name = d.Name, path = d.FullName })
                .ToList();
            return new { path = full, parent = Directory.GetParent(full)?.FullName, folders = list };
        }

        static string SafeLabel(DriveInfo d)
        {
            try { return d.VolumeLabel; } catch { return null; }
        }
    }
}
