using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Nightjar
{
    /// <summary>
    /// A problem report: Nightjar's and the engine's recent logs, its settings without passwords or keys,
    /// and what's installed, in one zip in Downloads, ready to send. Nothing is sent anywhere by Nightjar.
    /// </summary>
    static class Report
    {
        public static object Make(string note)
        {
            var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            if (!Directory.Exists(downloads)) downloads = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            var path = Path.Combine(downloads, "Nightjar report " + DateTime.Now.ToString("yyyy-MM-dd HHmm") + ".zip");
            try
            {
                using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
                {
                    Text(zip, "about.txt", About(note));
                    if (Directory.Exists(Paths.Logs))
                    {
                        // The newest logs, and only their last few megabytes.
                        foreach (var f in Directory.GetFiles(Paths.Logs).OrderByDescending(File.GetLastWriteTimeUtc).Take(6))
                            Text(zip, "logs/" + Path.GetFileName(f), Tail(f, 3 * 1024 * 1024));
                    }
                    if (File.Exists(Paths.Config)) Text(zip, "slskd.yml", Redact(Shared(Paths.Config)));
                    foreach (var name in new[] { "nightjar.json", "organizer-log.json" })
                    {
                        var f = Path.Combine(Paths.Data, name);
                        if (File.Exists(f)) Text(zip, name, Tail(f, 512 * 1024));
                    }
                }
                Log.Write("Problem report saved: " + path);
                return new { ok = true, path };
            }
            catch (Exception e)
            {
                try { File.Delete(path); } catch { }
                return new { ok = false, error = "Couldn't make the report: " + e.Message };
            }
        }

        static void Text(ZipArchive zip, string name, string text)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (var w = new StreamWriter(entry.Open(), new UTF8Encoding(false))) w.Write(text);
        }

        /// <summary>Reads a file another program is still writing to.</summary>
        static string Shared(string file)
        {
            using (var s = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new StreamReader(s)) return r.ReadToEnd();
        }

        static string Tail(string file, int max)
        {
            try
            {
                using (var s = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    if (s.Length > max) s.Seek(-max, SeekOrigin.End);
                    using (var r = new StreamReader(s)) return (s.Length > max ? "[…earlier lines left out…]\n" : "") + Redact(r.ReadToEnd());
                }
            }
            catch (Exception e) { return "(couldn't read: " + e.Message + ")"; }
        }

        /// <summary>Passwords, keys and tokens never leave the computer: their values become ***.</summary>
        public static string Redact(string text)
        {
            text = Regex.Replace(text, @"(?im)^(\s*[\w\-]*(password|passwd|secret|token|api_?key|key)[\w\-]*\s*:\s*)(.+)$", "$1***");
            return Regex.Replace(text, @"(?i)(password|token|api[_-]?key)=([^&\s]+)", "$1=***");
        }

        static string About(string note)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Nightjar problem report, " + DateTime.Now.ToString("yyyy-MM-dd HH:mm") + " (" + TimeZoneInfo.Local.StandardName + ")");
            sb.AppendLine("Nightjar " + Application.ProductVersion);
            sb.AppendLine("Windows " + Environment.OSVersion.Version + (Environment.Is64BitOperatingSystem ? " 64-bit" : " 32-bit"));
            try { sb.AppendLine("WebView2 " + Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString()); } catch { sb.AppendLine("WebView2 not found"); }
            sb.AppendLine("Installed in " + Paths.Root);
            sb.AppendLine("Library folder: " + (AppSettings.LibraryRoot ?? "(none)"));
            sb.AppendLine("Downloads folder: " + (Config.DownloadDir() ?? "(none)"));
            sb.AppendLine("SoulseekQt running: " + Engine.SoulseekQtRunning());
            if (!string.IsNullOrWhiteSpace(note)) { sb.AppendLine(); sb.AppendLine("What happened, in the person's words:"); sb.AppendLine(note.Trim()); }
            return sb.ToString();
        }
    }
}
