using System;
using System.IO;
using System.Text;
using System.Threading;

namespace Nightjar
{
    /// <summary>
    /// Nightjar's small settings files (devices, settings), written so they can't be lost: each save goes to a
    /// temporary file first and keeps the previous version as ".bak". A damaged file is kept aside and the .bak
    /// is used; a file that is only busy for a moment is waited for. Nothing damaged or busy is ever read as empty
    /// and then saved over.
    /// </summary>
    static class SafeFile
    {
        /// <summary>The file's text; null when it doesn't exist. Throws when it stays busy (so callers don't mistake it for empty).</summary>
        static string Read(string file)
        {
            for (int attempt = 0; ; attempt++)
            {
                try { return File.Exists(file) ? File.ReadAllText(file) : null; }
                catch (IOException) when (attempt < 5) { Thread.Sleep(150); }
            }
        }

        /// <summary>
        /// Reads and parses the file. Missing: <paramref name="empty"/>. Damaged: the damaged file is kept aside as
        /// ".damaged-…" and the previous version (.bak) is used instead, if it can be read.
        /// </summary>
        public static T Load<T>(string file, Func<string, T> parse, Func<T> empty, bool backup = true) where T : class
        {
            var text = Read(file);
            if (text == null) return (backup ? LoadBackup(file, parse) : null) ?? empty();
            try { return parse(text) ?? empty(); }
            catch (Exception e)
            {
                Log.Write(Path.GetFileName(file) + " is damaged (" + e.Message + ")");
                try { File.Move(file, file + ".damaged-" + DateTime.Now.ToString("yyyyMMdd-HHmmss")); } catch { }
                var restored = backup ? LoadBackup(file, parse) : null;
                if (restored != null) Log.Write(Path.GetFileName(file) + ": using the previous version");
                return restored ?? empty();
            }
        }

        static T LoadBackup<T>(string file, Func<string, T> parse) where T : class
        {
            var bak = file + ".bak";
            try
            {
                var text = Read(bak);
                if (text == null) return null;
                var value = parse(text);
                if (value != null) File.Copy(bak, file, true);
                return value;
            }
            catch { return null; }
        }

        /// <summary>Writes through a temporary file, keeping the version it replaces as ".bak" (unless <paramref name="backup"/> is false).</summary>
        public static void Write(string file, string text, bool backup = true)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            var tmp = file + ".tmp";
            File.WriteAllText(tmp, text, new UTF8Encoding(false));
            if (File.Exists(file)) File.Replace(tmp, file, backup ? file + ".bak" : null);
            else File.Move(tmp, file);
        }
    }
}
