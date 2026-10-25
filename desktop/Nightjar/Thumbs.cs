using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Nightjar
{
    /// <summary>
    /// Covers at the size they're shown. Album art is often 1–5 MB at 3000 px; a phone showing it at 120 px over
    /// mobile data only needs a few dozen KB. Small copies are made once and kept in data\cover-cache (up to 300 MB).
    /// </summary>
    static class Thumbs
    {
        static string Dir => Path.Combine(Paths.Data, "cover-cache");
        static readonly int[] Sizes = { 160, 320, 640, 1000 };
        /// <summary>A few at a time: making them is the PC's work, and a fast scroll asks for dozens at once.</summary>
        static readonly SemaphoreSlim Work = new SemaphoreSlim(3, 3);
        static int writes;

        /// <summary>The size to make for a requested width (0: the original picture).</summary>
        public static int Bucket(string asked)
        {
            if (!int.TryParse(asked, out var n) || n <= 0) return 0;
            foreach (var s in Sizes) if (n <= s) return s;
            return Sizes[Sizes.Length - 1];
        }

        static string Key(string text)
        {
            using (var sha = SHA1.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
        }

        /// <summary>A small copy of an image file (kept until the file changes).</summary>
        public static byte[] OfFile(string file, int size)
        {
            var fi = new FileInfo(file);
            return Make(Key(fi.FullName.ToLowerInvariant() + "|" + fi.LastWriteTimeUtc.Ticks + "|" + fi.Length + "|" + size), () => File.ReadAllBytes(file), size);
        }

        /// <summary>A small copy of a picture saved inside a music file.</summary>
        public static byte[] OfBytes(byte[] picture, int size)
        {
            string hash;
            using (var sha = SHA1.Create()) hash = BitConverter.ToString(sha.ComputeHash(picture)).Replace("-", "");
            return Make(Key("embedded|" + hash + "|" + size), () => picture, size);
        }

        static byte[] Make(string key, Func<byte[]> source, int size)
        {
            var cached = Path.Combine(Dir, key + ".jpg");
            try { if (File.Exists(cached)) return File.ReadAllBytes(cached); } catch { }
            Work.Wait();
            try
            {
                if (File.Exists(cached)) return File.ReadAllBytes(cached); // made while this one waited
                byte[] jpeg;
                using (var ms = new MemoryStream(source()))
                using (var img = Image.FromStream(ms, false, false))
                {
                    var scale = Math.Min(1.0, (double)size / Math.Max(img.Width, img.Height));
                    int w = Math.Max(1, (int)Math.Round(img.Width * scale)), h = Math.Max(1, (int)Math.Round(img.Height * scale));
                    using (var bmp = new Bitmap(w, h))
                    {
                        using (var g = Graphics.FromImage(bmp))
                        {
                            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                            g.CompositingQuality = CompositingQuality.HighQuality;
                            g.Clear(Color.Black); // transparent PNGs
                            using (var wrap = new ImageAttributes())
                            {
                                wrap.SetWrapMode(WrapMode.TileFlipXY); // no light edge from the resize
                                g.DrawImage(img, new Rectangle(0, 0, w, h), 0, 0, img.Width, img.Height, GraphicsUnit.Pixel, wrap);
                            }
                        }
                        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                        using (var q = new EncoderParameters(1))
                        using (var outMs = new MemoryStream())
                        {
                            q.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 84L);
                            bmp.Save(outMs, codec, q);
                            jpeg = outMs.ToArray();
                        }
                    }
                }
                try
                {
                    Directory.CreateDirectory(Dir);
                    var tmp = cached + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    File.WriteAllBytes(tmp, jpeg);
                    if (!File.Exists(cached)) File.Move(tmp, cached); else File.Delete(tmp);
                    if (Interlocked.Increment(ref writes) % 200 == 0) Prune();
                }
                catch { }
                return jpeg;
            }
            finally { Work.Release(); }
        }

        /// <summary>Keeps the cache under 300 MB, dropping the oldest copies first.</summary>
        static void Prune()
        {
            try
            {
                var files = new DirectoryInfo(Dir).GetFiles("*.jpg").OrderBy(f => f.LastWriteTimeUtc).ToList();
                long total = files.Sum(f => f.Length);
                foreach (var f in files)
                {
                    if (total <= 300L * 1024 * 1024) break;
                    total -= f.Length;
                    try { f.Delete(); } catch { }
                }
            }
            catch { }
        }
    }
}
