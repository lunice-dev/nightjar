using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Nightjar
{
    /// <summary>
    /// Phones and other computers that may use Nightjar from away (through Tailscale).
    /// Each one holds a device token; only its SHA-256 is kept, in data\devices.json.
    /// A device gets its token by typing a short pairing code shown on this computer,
    /// or the remote password. Wrong attempts make everyone wait longer.
    /// </summary>
    static class Remote
    {
        static string File => Path.Combine(Paths.Data, "devices.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static readonly object Gate = new object();

        public sealed class Device
        {
            public string id { get; set; }
            public string name { get; set; }
            public string hash { get; set; }
            public string created { get; set; }
            public string lastSeen { get; set; }
        }

        static List<Device> Load()
        {
            try { return Json.Deserialize<List<Device>>(System.IO.File.ReadAllText(File)) ?? new List<Device>(); }
            catch { return new List<Device>(); }
        }

        static void Save(List<Device> list)
        {
            Directory.CreateDirectory(Paths.Data);
            var tmp = File + ".tmp";
            System.IO.File.WriteAllText(tmp, Json.Serialize(list), new UTF8Encoding(false));
            if (System.IO.File.Exists(File)) System.IO.File.Replace(tmp, File, null); else System.IO.File.Move(tmp, File);
        }

        static string RandomText(int bytes)
        {
            var b = new byte[bytes];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return Convert.ToBase64String(b).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        static string Hash(string token)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(token ?? ""))).Replace("-", "").ToLowerInvariant();
        }

        /// <summary>The devices, without their hashes, newest first.</summary>
        public static object List()
        {
            lock (Gate)
                return Load().OrderByDescending(d => d.created).Select(d => new { d.id, d.name, d.created, d.lastSeen }).ToList();
        }

        /// <summary>The device a token belongs to, or null. Notes when it was last seen (at most once a minute).</summary>
        public static Device Check(string token)
        {
            if (string.IsNullOrEmpty(token) || token.Length > 200) return null;
            var h = Hash(token);
            lock (Gate)
            {
                var list = Load();
                var d = list.FirstOrDefault(x => FixedEquals(x.hash, h));
                if (d == null) return null;
                var now = DateTime.UtcNow;
                if (!DateTime.TryParse(d.lastSeen, null, System.Globalization.DateTimeStyles.RoundtripKind, out var seen) || (now - seen).TotalMinutes >= 1)
                {
                    d.lastSeen = now.ToString("o");
                    try { Save(list); } catch { }
                }
                return d;
            }
        }

        static bool FixedEquals(string a, string b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        public static bool Remove(string id)
        {
            lock (Gate)
            {
                var list = Load();
                var n = list.RemoveAll(d => d.id == id);
                if (n > 0) Save(list);
                Log.Write("Remote device removed (" + n + ")");
                return n > 0;
            }
        }

        public static void RemoveAll()
        {
            lock (Gate) Save(new List<Device>());
            Log.Write("All remote devices removed");
        }

        // --- pairing ----------------------------------------------------------

        // No look-alike letters (0/O, 1/I/L), so the code is easy to read off the screen and type on a phone.
        const string CodeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        static string code;
        static DateTime codeUntil;
        static int failures;
        static DateTime waitUntil;

        /// <summary>A new six-character code, valid for ten minutes and for one device. Replaces the previous one.</summary>
        public static object NewCode()
        {
            var b = new byte[6];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            lock (Gate)
            {
                code = new string(b.Select(x => CodeLetters[x % CodeLetters.Length]).ToArray());
                codeUntil = DateTime.UtcNow.AddMinutes(10);
                return new { code, expires = codeUntil.ToString("o") };
            }
        }

        public static void ForgetCode()
        {
            lock (Gate) code = null;
        }

        /// <summary>
        /// Signs a device in with the pairing code or the remote password. Returns its new token,
        /// or an error and how many seconds to wait before trying again.
        /// </summary>
        public static (string token, string id, string error, int wait) Pair(string secret, string name)
        {
            lock (Gate)
            {
                var now = DateTime.UtcNow;
                if (now < waitUntil) return (null, null, "Too many wrong tries. Wait a moment and try again.", (int)Math.Ceiling((waitUntil - now).TotalSeconds));
                secret = (secret ?? "").Trim();
                var typed = Regex.Replace(secret.ToUpperInvariant(), @"[\s-]", "");
                bool ok = false;
                if (code != null && now < codeUntil && typed.Length == code.Length && FixedEquals(typed, code))
                {
                    ok = true;
                    code = null; // one device per code
                }
                else
                {
                    var (_, pass) = Config.WebLogin();
                    if (RemotePasswordSet && !string.IsNullOrEmpty(pass) && secret.Length > 0 && FixedEquals(secret, pass)) ok = true;
                }
                if (!ok)
                {
                    failures++;
                    // The first few slips are free; then 30 s, 1 min, 2 min… up to 15 min.
                    if (failures >= 5) waitUntil = now.AddSeconds(Math.Min(900, 30 * Math.Pow(2, failures - 5)));
                    Log.Write("Remote sign-in refused (" + failures + " wrong in a row)");
                    return (null, null, "That code or password isn’t right.", 0);
                }
                failures = 0;
                var token = RandomText(32);
                var device = new Device
                {
                    id = RandomText(9),
                    name = CleanName(name),
                    hash = Hash(token),
                    created = now.ToString("o"),
                    lastSeen = now.ToString("o"),
                };
                var list = Load();
                list.Add(device);
                Save(list);
                Log.Write("Remote device added: " + device.name);
                return (token, device.id, null, 0);
            }
        }

        static string CleanName(string name)
        {
            name = Regex.Replace(name ?? "", @"[\x00-\x1f]", "").Trim();
            if (name.Length > 40) name = name.Substring(0, 40);
            return name.Length == 0 ? "A device" : name;
        }

        public static bool Rename(string id, string name)
        {
            lock (Gate)
            {
                var list = Load();
                var d = list.FirstOrDefault(x => x.id == id);
                if (d == null) return false;
                d.name = CleanName(name);
                Save(list);
                return true;
            }
        }

        // --- the remote password ------------------------------------------------

        /// <summary>
        /// Whether the person chose the password (it is also slskd's web login, for the home network).
        /// Until then the login is a random one nobody knows, and only the pairing code works.
        /// </summary>
        public static bool RemotePasswordSet
        {
            get
            {
                // Before this setting existed, a login open to the home network meant someone knew (had chosen) the password.
                var v = AppSettings.Get("remotePasswordSet");
                return v is bool b ? b : Config.WebAddress().StartsWith("0.0.0.0");
            }
        }

        /// <summary>Saves the password the person chose. Returns an error in words, or null.</summary>
        public static string SetPassword(string password)
        {
            if (string.IsNullOrEmpty(password) || password.Length < 8) return "Use at least 8 characters.";
            if (password.Length > 200) return "That's too long.";
            if (Config.WebLogin().user == null) return "The engine's login is turned off in its config file (data\\slskd.yml).";
            if (!Config.SetWebPassword(password)) return "Couldn't write the engine's config file.";
            AppSettings.Set("remotePasswordSet", true);
            Log.Write("Remote password changed");
            return null;
        }

        // --- keys for pictures and music -----------------------------------------

        // <img> and <audio> send no headers, so their addresses carry a key instead. One per device,
        // kept in memory: a restart of Nightjar hands out new ones, and removing a device ends its key.
        static readonly Dictionary<string, string> mediaKeys = new Dictionary<string, string>();

        public static string MediaKeyFor(string deviceId)
        {
            lock (Gate)
            {
                var found = mediaKeys.FirstOrDefault(kv => kv.Value == deviceId).Key;
                if (found != null) return found;
                var key = RandomText(24);
                mediaKeys[key] = deviceId;
                return key;
            }
        }

        /// <summary>True when the key belongs to a device that is still allowed.</summary>
        public static bool MediaKeyOk(string key)
        {
            if (string.IsNullOrEmpty(key)) return false;
            string id;
            lock (Gate) if (!mediaKeys.TryGetValue(key, out id)) return false;
            lock (Gate)
                if (Load().Any(d => d.id == id)) return true;
            lock (Gate) mediaKeys.Remove(key);
            return false;
        }
    }
}
