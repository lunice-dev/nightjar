using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Nightjar
{
    /// <summary>
    /// Checks whether downloaded music is what it claims to be, on request:
    ///  - FLAC: decoded by the official decoder (flac.exe), which also checks its built-in checksum;
    ///  - where the sound really stops (spectrum of many moments across the track, both channels):
    ///    a FLAC that stops sharply at 16-20 kHz was made from an MP3 or AAC;
    ///  - hi-res whose sound stops at CD frequencies was made from a CD-quality master;
    ///  - 24-bit whose lowest 8 bits are always zero is 16-bit in disguise;
    ///  - MP3: the real bitrate from the frames, the encoder's own note (LAME), and the spectrum.
    /// Then one verdict for the album.
    /// </summary>
    static class Validator
    {
        public sealed class Track
        {
            public string file, name, verdict, note;
            public int rate, bits, channels;
            public double cutoff;       // Hz where the sound stops
            public bool sharp;          // stops like a cliff (a lossy encoder's filter), not a slope
            public int kbps;            // MP3: average bitrate; others: file size over length
            public string encoder;      // MP3: LAME version, if it says
            public int severity;        // higher is worse, for sorting and the album verdict
        }

        public sealed class Job
        {
            public string id, dir;
            public int total, done;
            public bool finished;
            public string error;
            public readonly List<Track> tracks = new List<Track>();
            public object album;
        }

        static readonly ConcurrentDictionary<string, Job> Jobs = new ConcurrentDictionary<string, Job>();
        static string FlacExe => Path.Combine(Paths.Root, "tools", "flac.exe");

        public static Job Start(string dir)
        {
            var job = new Job { id = Guid.NewGuid().ToString("N"), dir = dir };
            Jobs[job.id] = job;
            Task.Run(() => Run(job));
            return job;
        }

        public static Job Get(string id) => Jobs.TryGetValue(id, out var j) ? j : null;

        static void Run(Job job)
        {
            try
            {
                // Disc folders ("CD1", "Disc 2") belong to the album too.
                var all = Directory.GetFiles(job.dir, "*", SearchOption.AllDirectories);
                var files = all.Where(f => Checkable.Contains(Path.GetExtension(f).ToLowerInvariant())).OrderBy(f => f).ToList();
                job.total = files.Count;
                if (files.Count == 0)
                {
                    var kinds = all.Where(Organizer.IsAudio).Select(f => Path.GetExtension(f).TrimStart('.').ToUpperInvariant()).Distinct().ToList();
                    job.error = kinds.Count > 0
                        ? "Nightjar can check FLAC, WAV and MP3 files; this album is " + string.Join(" and ", kinds) + "."
                        : "There's no music in this folder any more.";
                    return;
                }
                // Two at a time: quick, without taking the whole computer.
                Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = 2 }, f =>
                {
                    Track t;
                    var ext = Path.GetExtension(f).ToLowerInvariant();
                    try { t = ext == ".flac" ? Flac(f) : ext == ".wav" ? Wav(f) : Mp3(f); }
                    catch (Exception e) { t = new Track { verdict = "Unreadable", note = "Nightjar couldn't read it: " + e.Message, severity = 9 }; }
                    t.file = f;
                    t.name = f.Substring(job.dir.TrimEnd(Path.DirectorySeparatorChar).Length + 1);
                    lock (job.tracks) job.tracks.Add(t);
                    Interlocked.Increment(ref job.done);
                });
                lock (job.tracks) job.tracks.Sort((a, b) => string.Compare(a.name, b.name, StringComparison.OrdinalIgnoreCase));
                job.album = AlbumVerdict(job.tracks);
                Log.Write("Checked " + job.dir + ": " + Summary(job.tracks));
            }
            catch (Exception e) { job.error = e.Message; }
            finally { job.finished = true; }
        }

        static string Summary(List<Track> t) => string.Join(", ", t.GroupBy(x => x.verdict).Select(g => g.Count() + " " + g.Key));

        static readonly string[] Checkable = { ".flac", ".wav", ".mp3" };

        // ---------------------------------------------------------------- WAV

        /// <summary>WAV is plain PCM: the same checks as FLAC, read straight from the file (there's no checksum, but a file cut short shows).</summary>
        static Track Wav(string file)
        {
            using (var f = File.OpenRead(file))
            using (var br = new BinaryReader(f))
            {
                if (new string(br.ReadChars(4)) != "RIFF") throw new InvalidDataException("not a WAV file");
                br.ReadInt32();
                if (new string(br.ReadChars(4)) != "WAVE") throw new InvalidDataException("not a WAV file");
                int format = 0, channels = 0, rate = 0, bits = 0, align = 0;
                long dataAt = -1, dataSize = 0;
                while (f.Position + 8 <= f.Length)
                {
                    var id = new string(br.ReadChars(4));
                    long size = br.ReadUInt32();
                    var next = f.Position + size + (size & 1);
                    if (id == "fmt ")
                    {
                        format = br.ReadUInt16(); channels = br.ReadUInt16(); rate = br.ReadInt32(); br.ReadInt32(); align = br.ReadUInt16(); bits = br.ReadUInt16();
                        if (format == 0xFFFE && size >= 26) { br.ReadUInt16(); br.ReadUInt16(); br.ReadUInt32(); format = br.ReadUInt16(); }
                    }
                    else if (id == "data") { dataAt = f.Position; dataSize = size; break; }
                    f.Position = next;
                }
                if (dataAt < 0 || channels == 0 || rate == 0 || align == 0) throw new InvalidDataException("no sound data in this WAV");
                bool isFloat = format == 3;
                if (!(format == 1 || isFloat) || (isFloat && bits != 32) || (!isFloat && (bits < 8 || bits > 32))) throw new InvalidDataException("this kind of WAV (" + format + ", " + bits + "-bit) isn't supported");
                var available = Math.Min(dataSize, f.Length - dataAt);
                long total = available / align;
                int n = rate > 48000 ? 8192 : 4096;
                var picker = new Windows(total, n, 48);
                int bytes = bits / 8;
                long lowBits = 0;
                double scale = isFloat ? 1.0 : 1.0 / (1L << (bits - 1));
                var buf = new byte[align * 4096];
                long index = 0;
                f.Position = dataAt;
                while (index < total)
                {
                    int want = (int)Math.Min(buf.Length / align, total - index) * align;
                    int got = 0, r;
                    while (got < want && (r = f.Read(buf, got, want - got)) > 0) got += r;
                    if (got < align) break;
                    for (int o = 0; o + align <= got; o += align, index++)
                    {
                        double l = 0, rr = 0;
                        for (int c = 0; c < channels && c < 2; c++)
                        {
                            int at = o + c * bytes;
                            double x;
                            if (isFloat) x = BitConverter.ToSingle(buf, at);
                            else if (bits == 8) x = (buf[at] - 128) / 128.0;
                            else
                            {
                                long v = 0;
                                for (int k = 0; k < bytes; k++) v |= (long)buf[at + k] << (8 * k);
                                if ((v & (1L << (bits - 1))) != 0) v -= 1L << bits;
                                if (bits > 16) lowBits |= v & ((1L << (bits - 16)) - 1);
                                x = v * scale;
                            }
                            if (c == 0) l = x; else rr = x;
                        }
                        picker.Add(index, l, channels > 1 ? rr : l);
                    }
                }
                var t = new Track { rate = rate, bits = bits, channels = channels, kbps = (int)((long)rate * align * 8 / 1000) };
                if (dataSize > f.Length - dataAt + align)
                {
                    t.verdict = "Corrupt";
                    t.note = "The file is cut short: part of the music is missing. Download it again from someone else.";
                    t.severity = 10;
                    return t;
                }
                var spec = Spectrum.Analyse(picker, rate);
                t.cutoff = spec.cutoff;
                t.sharp = spec.sharp;
                Judge(t, spec, lossless: true, fake24: !isFloat && bits > 16 && lowBits == 0);
                return t;
            }
        }

        // ---------------------------------------------------------------- FLAC

        static Track Flac(string file)
        {
            int rate, channels, bits;
            long total;
            ReadStreamInfo(file, out rate, out channels, out bits, out total);
            if (!File.Exists(FlacExe)) throw new FileNotFoundException("The FLAC decoder is missing; install Nightjar again.");

            int n = rate > 48000 ? 8192 : 4096;
            var picker = new Windows(total, n, 48);
            int bytes = (bits + 7) / 8;
            long lowBits = 0;           // every bit seen below the top 16, for 24-bit files
            var psi = new ProcessStartInfo(FlacExe, "-d -c -s --force-raw-format --endian=little --sign=signed \"" + file + "\"")
            {
                UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
            };
            string err;
            int code;
            long decoded;
            using (var p = Process.Start(psi))
            {
                var errTask = p.StandardError.ReadToEndAsync();
                var s = p.StandardOutput.BaseStream;
                var frame = new byte[bytes * channels];
                var buf = new byte[frame.Length * 4096];
                long index = 0;
                int have = 0, read;
                double scale = 1.0 / (1L << (bits - 1));
                while ((read = s.Read(buf, have, buf.Length - have)) > 0)
                {
                    have += read;
                    int whole = have / frame.Length * frame.Length;
                    for (int o = 0; o < whole; o += frame.Length, index++)
                    {
                        double l = 0, r = 0;
                        for (int c = 0; c < channels && c < 2; c++)
                        {
                            int at = o + c * bytes;
                            long v = 0;
                            for (int k = 0; k < bytes; k++) v |= (long)buf[at + k] << (8 * k);
                            if ((v & (1L << (bits - 1))) != 0) v -= 1L << bits; // sign
                            if (bits > 16) lowBits |= v & ((1L << (bits - 16)) - 1);
                            if (c == 0) l = v * scale; else r = v * scale;
                        }
                        picker.Add(index, l, channels > 1 ? r : l);
                    }
                    Buffer.BlockCopy(buf, whole, buf, 0, have - whole);
                    have -= whole;
                }
                p.WaitForExit();
                err = errTask.Result;
                code = p.ExitCode;
                decoded = index;
            }
            // An old ID3 tag stuck on the end ("TAG…") makes the decoder complain after the last sound; every sample
            // is there and its checksum isn't in question, so it plays fine everywhere.
            var junkAtEnd = code != 0 && total > 0 && decoded >= total && err.IndexOf("MD5", StringComparison.OrdinalIgnoreCase) < 0;
            if (code != 0) Log.Write("flac " + code + " on " + Path.GetFileName(file) + ": " + decoded + " of " + total + " samples; " + (err ?? "").Replace("\r", " ").Replace("\n", " ").Trim());
            if (junkAtEnd) code = 0;

            var t = new Track { rate = rate, bits = bits, channels = channels };
            var len = rate > 0 ? total / (double)rate : 0;
            t.kbps = len > 0 ? (int)(new FileInfo(file).Length * 8 / len / 1000) : 0;
            if (code != 0)
            {
                t.verdict = "Corrupt";
                t.note = err.IndexOf("MD5", StringComparison.OrdinalIgnoreCase) >= 0
                    ? "The sound doesn't match the file's own checksum: it was damaged after it was made. Download it again from someone else."
                    : "The file is damaged and can't be played all the way through. Download it again from someone else.";
                t.severity = 10;
                return t;
            }
            var spec = Spectrum.Analyse(picker, rate);
            t.cutoff = spec.cutoff;
            t.sharp = spec.sharp;
            Judge(t, spec, lossless: true, fake24: bits > 16 && lowBits == 0);
            if (junkAtEnd) t.note = (t.note ?? "").TrimEnd() + " (It has some extra data after the music, left by an old tagger: harmless.)";
            return t;
        }

        static void ReadStreamInfo(string file, out int rate, out int channels, out int bits, out long total)
        {
            using (var f = File.OpenRead(file))
            {
                var head = new byte[4];
                f.Read(head, 0, 4);
                // Some FLACs start with an ID3 tag.
                if (head[0] == 'I' && head[1] == 'D' && head[2] == '3')
                {
                    var h = new byte[6];
                    f.Read(h, 0, 6);
                    int size = (h[2] << 21) | (h[3] << 14) | (h[4] << 7) | h[5];
                    f.Seek(10 + size, SeekOrigin.Begin);
                    f.Read(head, 0, 4);
                }
                if (Encoding.ASCII.GetString(head) != "fLaC") throw new InvalidDataException("Not a FLAC file.");
                var block = new byte[4 + 34];
                f.Read(block, 0, block.Length);
                var b = block.Skip(4).ToArray();
                rate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
                channels = ((b[12] >> 1) & 7) + 1;
                bits = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
                total = ((long)(b[13] & 0xF) << 32) | ((long)b[14] << 24) | ((long)b[15] << 16) | ((long)b[16] << 8) | b[17];
            }
        }

        // ---------------------------------------------------------------- MP3

        static Track Mp3(string file)
        {
            var info = Mp3Info.Read(file);
            var t = new Track { rate = info.rate, bits = 16, channels = info.channels, kbps = info.kbps, encoder = info.encoder };
            using (var mp = new NLayer.MpegFile(file))
            {
                int rate = mp.SampleRate, ch = mp.Channels;
                long total = (long)(info.seconds * rate);
                var picker = new Windows(total, 4096, 40);
                var buf = new float[4096 * ch];
                long index = 0;
                int got;
                while ((got = mp.ReadSamples(buf, 0, buf.Length)) > 0)
                    for (int i = 0; i + ch - 1 < got; i += ch, index++) picker.Add(index, buf[i], ch > 1 ? buf[i + 1] : buf[i]);
                var spec = Spectrum.Analyse(picker, rate);
                t.cutoff = spec.cutoff;
                t.sharp = spec.sharp;
                Judge(t, spec, lossless: false, fake24: false);
            }
            return t;
        }

        // ---------------------------------------------------------------- verdicts

        static string KHz(double hz) => (hz / 1000).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " kHz";

        static void Judge(Track t, Spectrum.Result s, bool lossless, bool fake24)
        {
            var nyq = t.rate / 2.0;
            if (s.silent) { t.verdict = "Uncertain"; t.note = "Too quiet to tell."; t.severity = 1; return; }
            if (lossless)
            {
                if (t.rate > 48000)
                {
                    // A CD-quality master resampled to hi-res stops at 22-26 kHz, where the resampler's filter is.
                    if (s.cutoff <= 26500 && s.sharp) { t.verdict = "Upsampled"; t.note = "Sold as hi-res, but the sound stops at " + KHz(s.cutoff) + ": made from a CD-quality master."; t.severity = 5; }
                    else if (s.cutoff < 20500 && s.sharp) LossySource(t, s.cutoff);
                    else if (s.cutoff >= nyq * 0.55) { t.verdict = "True hi-res"; t.note = "Sound goes up to " + KHz(s.cutoff) + "."; }
                    else { t.verdict = "Hi-res"; t.note = "Little sound above " + KHz(s.cutoff) + ", but no sign of a lossy source."; }
                }
                else
                {
                    if (s.cutoff >= Math.Min(20500, nyq * 0.93)) { t.verdict = "Lossless"; t.note = "Full range, up to " + KHz(s.cutoff) + "."; }
                    else if (s.sharp) LossySource(t, s.cutoff);
                    else { t.verdict = "Lossless"; t.note = "The sound fades out gently near " + KHz(s.cutoff) + ", as many recordings do; no sign of a lossy source."; t.severity = 1; }
                }
                if (fake24 && t.severity < 6)
                {
                    t.verdict = t.verdict == "Lossless" || t.verdict == "True hi-res" || t.verdict == "Hi-res" ? "Fake 24-bit" : t.verdict;
                    t.note = "Labelled 24-bit, but the last 8 bits are always zero: it's 16-bit in a 24-bit file. " + t.note;
                    t.severity = Math.Max(t.severity, 4);
                }
            }
            else
            {
                // MP3: does the sound match the bitrate it claims?
                // What an honest file of this bitrate reaches (a little under LAME's filter, for other encoders).
                var expected = t.kbps >= 300 ? 19800 : t.kbps >= 240 ? 19200 : t.kbps >= 210 ? 18800 : t.kbps >= 180 ? 18200 : t.kbps >= 150 ? 17300 : 16500;
                var enc = t.encoder != null ? " Encoded with " + t.encoder + "." : "";
                if (s.sharp && s.cutoff < expected - 1500)
                {
                    var real = SourceFor(s.cutoff);
                    t.verdict = "Upconverted";
                    t.note = "Says " + t.kbps + " kbps, but the sound stops at " + KHz(s.cutoff) + ", like a " + real + " kbps file re-encoded at a higher bitrate." + enc;
                    t.severity = 6;
                }
                else { t.verdict = "MP3 " + t.kbps + " kbps"; t.note = "Sound up to " + KHz(s.cutoff) + ", as expected for " + t.kbps + " kbps." + enc; }
            }
        }

        /// <summary>
        /// The bitrate a cut points to. LAME, the usual MP3 encoder, filters at about 17 kHz for 128 kbps,
        /// 17.5 for 160, 18.6 for 192, 19.4 for 224, 19.7 for 256 and 20-20.5 for 320.
        /// </summary>
        public static string SourceFor(double cutoff) =>
            cutoff < 16000 ? "96–112" : cutoff < 17300 ? "128" : cutoff < 18100 ? "160" : cutoff < 19000 ? "192" : cutoff < 19900 ? "224–256" : "320";

        static void LossySource(Track t, double cutoff)
        {
            var src = SourceFor(cutoff);
            if (cutoff >= 19900) { t.verdict = "Suspicious"; t.note = "A sharp cut at " + KHz(cutoff) + ", typical of a 320 kbps MP3/AAC source. Often sounds fine, but probably not true lossless."; t.severity = 6; }
            else { t.verdict = "Lossy source"; t.note = "A sharp cut at " + KHz(cutoff) + ": converted from a " + src + " kbps MP3/AAC. Not true lossless."; t.severity = 8; }
        }

        static object AlbumVerdict(List<Track> tracks)
        {
            var worst = tracks.OrderByDescending(t => t.severity).First();
            var flagged = tracks.Where(t => t.severity >= 4).ToList();
            string verdict, note;
            if (flagged.Count == 0)
            {
                var main = tracks.GroupBy(t => t.verdict).OrderByDescending(g => g.Count()).First().Key;
                verdict = main == "Lossless" ? "Verified lossless" : main == "True hi-res" ? "Verified hi-res" : main;
                note = "Every track looks genuine.";
            }
            else if (flagged.Count * 2 >= tracks.Count)
            {
                verdict = worst.verdict;
                var kinds = flagged.GroupBy(t => t.verdict).OrderByDescending(g => g.Max(t => t.severity)).ToList();
                note = kinds.Count == 1
                    ? (flagged.Count == tracks.Count ? "Every track: " : flagged.Count + " of " + tracks.Count + " tracks: ") + worst.note
                    : flagged.Count + " of " + tracks.Count + " tracks look wrong: " + string.Join(", ", kinds.Select(g => g.Count() + " " + g.Key.ToLowerInvariant())) + ".";
            }
            else
            {
                verdict = "Mostly fine";
                note = flagged.Count + " of " + tracks.Count + (flagged.Count == 1 ? " track looks" : " tracks look") + " wrong: " + string.Join(", ", flagged.Select(t => t.name + " (" + t.verdict.ToLowerInvariant() + ")")) + ".";
            }
            return new { verdict, note, severity = flagged.Count * 2 >= tracks.Count ? worst.severity : flagged.Count > 0 ? 3 : 0, tracks = tracks.Count, flagged = flagged.Count };
        }
    }

    /// <summary>Picks evenly spread moments of a track as it streams by (skipping the first and last 5%).</summary>
    sealed class Windows
    {
        readonly long[] starts;
        readonly int n;
        public readonly List<double[]> Left = new List<double[]>(), Right = new List<double[]>();
        int current = -1, next;
        double[] l, r;
        public int Size => n;

        public Windows(long total, int n, int count)
        {
            this.n = n;
            var span = total * 0.9 - n;
            starts = span <= 0 ? new long[] { 0 } : Enumerable.Range(0, count).Select(i => (long)(total * 0.05 + span * i / (count - 1))).ToArray();
        }

        public void Add(long index, double left, double right)
        {
            if (current < 0)
            {
                // Windows overlapping the one just taken are skipped.
                while (next < starts.Length && starts[next] < index) next++;
                if (next >= starts.Length || starts[next] != index) return;
                next++;
                current = 0;
                l = new double[n];
                r = new double[n];
            }
            l[current] = left;
            r[current] = right;
            if (++current == n)
            {
                Left.Add(l);
                Right.Add(r);
                current = -1;
            }
        }
    }

    /// <summary>Where the sound stops, from the average spectrum of many moments of a track.</summary>
    static class Spectrum
    {
        public sealed class Result { public double cutoff; public bool sharp; public bool silent; }

        public static Result Analyse(Windows w, int rate)
        {
            var a = Cutoff(w.Left, rate, w.Size);
            var b = Cutoff(w.Right, rate, w.Size);
            // The channel that reaches higher tells the truth (one channel can be quieter).
            return a.silent ? b : b.silent ? a : a.cutoff >= b.cutoff ? a : b;
        }

        static Result Cutoff(List<double[]> windows, int rate, int n)
        {
            var power = new double[n / 2];
            int used = 0;
            var win = new double[n];
            for (int i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (n - 1));
            foreach (var x in windows)
            {
                double energy = 0;
                for (int i = 0; i < n; i++) energy += x[i] * x[i];
                if (energy / n < 1e-7) continue; // silence
                var re = new double[n];
                var im = new double[n];
                for (int i = 0; i < n; i++) re[i] = x[i] * win[i];
                Fft(re, im);
                for (int k = 0; k < n / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
                used++;
            }
            if (used == 0) return new Result { silent = true };
            double hz = rate / (double)n;
            var db = new double[n / 2];
            for (int k = 0; k < n / 2; k++) db[k] = 10 * Math.Log10(power[k] / used + 1e-20);
            // Smooth over about 100 Hz.
            int half = Math.Max(2, (int)(50 / hz));
            var sm = new double[n / 2];
            for (int k = 0; k < n / 2; k++)
            {
                double s = 0; int c = 0;
                for (int j = k - half; j <= k + half; j++) if (j >= 0 && j < n / 2) { s += db[j]; c++; }
                sm[k] = s / c;
            }
            var mid = sm.Skip((int)(1000 / hz)).Take((int)(7000 / hz)).OrderBy(v => v).ToList();
            var refDb = mid[mid.Count / 2];
            int cut = 0;
            for (int k = n / 2 - 1; k > 0; k--) if (sm[k] > refDb - 48) { cut = k; break; }
            double cutoff = cut * hz;
            Func<double, double, double> near = (from, to) =>
            {
                int a2 = Math.Max(0, (int)(from / hz)), z = Math.Min(n / 2 - 1, (int)(to / hz));
                double t = 0; int c = 0;
                for (int q = a2; q <= z; q++) { t += sm[q]; c++; }
                return c > 0 ? t / c : refDb;
            };
            // A lossy encoder's filter drops like a cliff; real recordings slope down.
            bool sharp = near(cutoff - 700, cutoff - 250) - near(cutoff + 250, cutoff + 700) > 18;
            return new Result { cutoff = cutoff, sharp = sharp };
        }

        static void Fft(double[] re, double[] im)
        {
            int n = re.Length;
            for (int i = 1, j = 0; i < n; i++)
            {
                int bit = n >> 1;
                for (; (j & bit) != 0; bit >>= 1) j ^= bit;
                j ^= bit;
                if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
            }
            for (int len = 2; len <= n; len <<= 1)
            {
                double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
                for (int i = 0; i < n; i += len)
                {
                    double cr = 1, ci = 0;
                    for (int j = 0; j < len / 2; j++)
                    {
                        int a = i + j, b = a + len / 2;
                        double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                        re[b] = re[a] - xr; im[b] = im[a] - xi;
                        re[a] += xr; im[a] += xi;
                        double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                    }
                }
            }
        }
    }

    /// <summary>What an MP3 says about itself: frame bitrates, length and the LAME note.</summary>
    sealed class Mp3Info
    {
        public int kbps, rate, channels;
        public double seconds;
        public string encoder;

        static readonly int[] RatesV1L3 = { 0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320 };
        static readonly int[] RatesV2L3 = { 0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160 };
        static readonly int[][] SampleRates = { new[] { 11025, 12000, 8000 }, null, new[] { 22050, 24000, 16000 }, new[] { 44100, 48000, 32000 } };

        public static Mp3Info Read(string file)
        {
            var data = File.ReadAllBytes(file);
            int p = 0;
            if (data.Length > 10 && data[0] == 'I' && data[1] == 'D' && data[2] == '3')
                p = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]);
            var info = new Mp3Info();
            long bitsum = 0; int frames = 0; double secs = 0;
            bool first = true;
            while (p + 4 <= data.Length)
            {
                if (data[p] != 0xFF || (data[p + 1] & 0xE0) != 0xE0) { p++; continue; }
                int ver = (data[p + 1] >> 3) & 3, layer = (data[p + 1] >> 1) & 3, bi = data[p + 2] >> 4, si = (data[p + 2] >> 2) & 3, pad = (data[p + 2] >> 1) & 1;
                if (ver == 1 || layer != 1 || bi == 0 || bi == 15 || si == 3) { p++; continue; }
                int kb = ver == 3 ? RatesV1L3[bi] : RatesV2L3[bi];
                int sr = SampleRates[ver][si];
                int spf = ver == 3 ? 1152 : 576;
                int len = (spf / 8 * kb * 1000) / sr + pad;
                if (len < 24) { p++; continue; }
                if (first)
                {
                    first = false;
                    info.rate = sr;
                    info.channels = (data[p + 3] >> 6) == 3 ? 1 : 2;
                    // The first frame of most files is a Xing/Info header with the LAME note; it carries no audio.
                    var text = Encoding.ASCII.GetString(data, p, Math.Min(len, data.Length - p));
                    var x = Math.Max(text.IndexOf("Xing", StringComparison.Ordinal), text.IndexOf("Info", StringComparison.Ordinal));
                    var lame = text.IndexOf("LAME", StringComparison.Ordinal);
                    if (lame < 0) lame = text.IndexOf("Lavc", StringComparison.Ordinal);
                    if (lame >= 0) info.encoder = new string(text.Substring(lame, Math.Min(9, text.Length - lame)).Where(c => c >= 32 && c < 127).ToArray()).Trim();
                    if (x >= 0) { p += len; continue; }
                }
                bitsum += kb; frames++; secs += spf / (double)sr;
                p += len;
            }
            info.kbps = frames > 0 ? (int)Math.Round(bitsum / (double)frames) : 0;
            info.seconds = secs;
            return info;
        }
    }
}
