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

        /// <summary>Replaces "key: value" inside a block (e.g. password under authentication). False when the line isn't there.</summary>
        static bool SetInBlock(string blockKey, string key, string yamlValue)
        {
            var text = Read();
            var m = Regex.Match(text, @"(?ms)^[ \t]*" + Regex.Escape(blockKey) + @":[ \t]*\r?\n(.*?)(?=^\S|\z)");
            if (!m.Success) return false;
            var block = m.Groups[1].Value;
            var line = new Regex(@"(?m)^(\s*" + Regex.Escape(key) + @":)[^\r\n]*");
            if (!line.IsMatch(block)) return false;
            var changed = line.Replace(block, "$1 " + yamlValue.Replace("$", "$$"), 1);
            Save(text.Substring(0, m.Groups[1].Index) + changed + text.Substring(m.Groups[1].Index + block.Length));
            return true;
        }

        /// <summary>The web login's password: the remote password, also used on the home network.</summary>
        public static bool SetWebPassword(string password) => SetInBlock("authentication", "password", Yaml(password));

        /// <summary>A new signing key: every page signed in with the old one has to sign in again.</summary>
        public static bool NewJwtKey() => SetInBlock("jwt", "key", Yaml(Random(48)));

        /// <summary>Where slskd's web page listens: 0.0.0.0 for phones on the home network too, 127.0.0.1 for this computer only.</summary>
        public static string WebAddress() => Value(Block(Read(), "web"), "ip_address") ?? "0.0.0.0";

        public static bool SetWebAddress(bool homeNetwork)
        {
            var value = homeNetwork ? "0.0.0.0 # phones on the home network too (login required)" : "127.0.0.1 # only this computer (and remote access through Tailscale)";
            if (SetInBlock("web", "ip_address", value)) return true;
            var text = Read();
            var web = Regex.Match(text, @"(?m)^web:[ \t]*\r?\n");
            if (!web.Success) return false;
            Save(text.Insert(web.Index + web.Length, "  ip_address: " + value + "\n"));
            return true;
        }

        public static string DownloadDir() => Value(Read(), "downloads");

        /// <summary>The shared folders as written in the config ("[alias]C:\path" and "!" exclusions handled).</summary>
        public static List<string> ShareDirs()
        {
            var list = new List<string>();
            var shares = Block(Read(), "shares");
            foreach (Match m in Regex.Matches(Block(shares, "directories"), @"(?m)^\s*-\s*(?:'((?:[^']|'')*)'|""([^""]*)""|([^#\r\n]*?))\s*(#.*)?\r?$"))
            {
                var v = m.Groups[1].Success ? m.Groups[1].Value.Replace("''", "'") : m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value.Trim();
                if (v.StartsWith("!") || v.Length == 0) continue;
                v = Regex.Replace(v, @"^\[[^\]]*\]", "");
                list.Add(v);
            }
            return list;
        }
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
