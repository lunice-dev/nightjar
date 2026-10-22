using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Nightjar
{
    /// <summary>
    /// slskd's config file. Nightjar writes the first one, keeps a few lines in line
    /// with this install before each start, and otherwise leaves it to the page
    /// (which edits it through slskd and keeps your comments).
    /// </summary>
    static class Config
    {
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        public static string Read()
        {
            try { return File.ReadAllText(Paths.Config); } catch { return ""; }
        }

        static void Save(string text)
        {
            var tmp = Paths.Config + ".tmp";
            File.WriteAllText(tmp, text, Utf8);
            if (File.Exists(Paths.Config)) File.Replace(tmp, Paths.Config, null);
            else File.Move(tmp, Paths.Config);
        }

        public static string Yaml(string s) => "'" + (s ?? "").Replace("'", "''") + "'";

        /// <summary>The value of the first "key:" line, quoted or not, without a trailing comment.</summary>
        public static string Value(string text, string key)
        {
            var m = Regex.Match(text, @"(?m)^\s*" + Regex.Escape(key) + @":\s*(?:'((?:[^']|'')*)'|""([^""]*)""|([^#\r\n]*?))\s*(#.*)?\r?$");
            if (!m.Success) return null;
            if (m.Groups[1].Success) return m.Groups[1].Value.Replace("''", "'");
            if (m.Groups[2].Success) return m.Groups[2].Value;
            var v = m.Groups[3].Value.Trim();
            return v.Length == 0 ? null : v;
        }

        /// <summary>The indented block under a "key:" line, up to the next top-level key.</summary>
        public static string Block(string text, string key)
        {
            var m = Regex.Match(text, @"(?ms)^[ \t]*" + Regex.Escape(key) + @":[ \t]*\r?\n(.*?)(?=^\S|\z)");
            return m.Success ? m.Groups[1].Value : "";
        }

        public static int ListenPort()
        {
            int.TryParse(Value(Read(), "listen_port") ?? "", out int port);
            return port > 0 ? port : 50300;
        }

        /// <summary>The web login slskd asks for (phone access), so programs on this computer can sign in for you.</summary>
        public static (string user, string pass) WebLogin()
        {
            var auth = Block(Read(), "authentication");
            if (auth.Length == 0 || Regex.IsMatch(auth, @"(?m)^\s*disabled:\s*true")) return (null, null);
            return (Value(auth, "username"), Value(auth, "password"));
        }

        public static string DownloadDir() => Value(Read(), "downloads");
        public static string IncompleteDir() => Value(Read(), "incomplete");

        static string Random(int bytes)
        {
            var b = new byte[bytes];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return Convert.ToBase64String(b).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        /// <summary>
        /// A new install: downloads go to Music\Nightjar, nothing is shared yet,
        /// the page is only reachable from this computer, and there's no Soulseek
        /// account yet (the page's setup steps ask for one).
        /// </summary>
        public static void WriteFirst()
        {
            Directory.CreateDirectory(Paths.Data);
            var music = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
            // Not inside OneDrive: albums are big, and syncing every download to the cloud is rarely what anyone wants.
            var oneDrive = Environment.GetEnvironmentVariable("OneDrive");
            var inCloud = !string.IsNullOrEmpty(oneDrive) && !string.IsNullOrEmpty(music) && music.StartsWith(oneDrive, StringComparison.OrdinalIgnoreCase);
            var downloads = Path.Combine(string.IsNullOrEmpty(music) || inCloud ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : music, "Nightjar");
            Directory.CreateDirectory(downloads);
            // Nothing is shared until the person chooses it in the setup steps (a Music folder can live in OneDrive,
            // and scanning files that are only in the cloud would download them all).
            var shares = "";
            var text =
                "# slskd config written by Nightjar. Safe to edit; Nightjar keeps your comments.\n" +
                "remote_configuration: true\n" +
                "directories:\n" +
                "  downloads: " + Yaml(downloads) + "\n" +
                "  incomplete: " + Yaml(Paths.Incomplete) + "\n" +
                shares +
                "transfers:\n" +
                "  upload:\n" +
                "    slots: 4 # fewer people at once, so each one downloads from you faster\n" +
                "web:\n" +
                "  port: 5030\n" +
                "  ip_address: 127.0.0.1 # only this computer; Settings can open it to phones on your network\n" +
                "  https:\n" +
                "    disabled: true\n" +
                "  content_path: nightjar-web\n" +
                "  authentication:\n" +
                "    disabled: false\n" +
                "    username: 'nightjar'\n" +
                "    password: " + Yaml(Random(18)) + "\n" +
                "    jwt:\n" +
                "      key: " + Yaml(Random(48)) + "\n" +
                "      ttl: 2073600000\n" +
                "soulseek:\n" +
                "  listen_port: 50300\n" +
                "  description: 'Sharing with Nightjar.'\n";
            Save(text);
            Log.Write("First config written");
        }

        /// <summary>
        /// Before each start: point slskd at this install's page and folders, and drop
        /// a profile picture slskd can't read (slskd refuses all its settings otherwise).
        /// Returns notes for the person, if any.
        /// </summary>
        public static List<string> Tidy()
        {
            var notes = new List<string>();
            var text = Read();
            var fixedText = Regex.Replace(text, @"(?m)^(\s*content_path:).*$", "$1 nightjar-web");
            fixedText = Regex.Replace(fixedText, @"(?m)^(\s*incomplete:).*$", "$1 " + Yaml(Paths.Incomplete).Replace("$", "$$"));

            var picture = Value(fixedText, "picture");
            if (!string.IsNullOrEmpty(picture) && !CanRead(picture))
            {
                fixedText = Regex.Replace(fixedText, @"(?m)^\s*picture:.*\r?\n?", "");
                notes.Add("Your profile picture (" + picture + ") couldn't be opened, so Nightjar took it off your profile. Choose it again in Settings.");
                Log.Write("Removed unreadable profile picture " + picture);
            }

            if (fixedText != text)
            {
                Save(fixedText);
                Log.Write("Config tidied");
            }
            foreach (var dir in new[] { Value(fixedText, "downloads"), Value(fixedText, "incomplete") })
            {
                try { if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir); }
                catch (Exception e) { notes.Add("Nightjar couldn't create the folder " + dir + ": " + e.Message); }
            }
            return notes;
        }

        static bool CanRead(string file)
        {
            try
            {
                using (var f = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) return f.ReadByte() >= -1;
            }
            catch { return false; }
        }
    }
}
