using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Nightjar
{
    /// <summary>
    /// The page's local helper on 127.0.0.1:5031: Windows' folder and picture
    /// pickers, Explorer, the Recycle Bin, the port test, UPnP and the firewall,
    /// shared preferences, album art and the sign-in token. Only the Nightjar page
    /// may use it (checked by Origin); album art, which goes into img tags that send
    /// no Origin, uses a random key handed only to that page.
    /// </summary>
    sealed class Helper
    {
        static readonly string[] Origins = { "http://127.0.0.1:5030", "http://localhost:5030" };
        static readonly Dictionary<string, string> ImageTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".gif"] = "image/gif", [".bmp"] = "image/bmp", [".webp"] = "image/webp",
        };
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly HttpClient Web = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };

        readonly string imgKey = Guid.NewGuid().ToString("N");
        readonly Func<Func<object>, object> onUi;   // runs dialogs on the window's thread
        readonly Action quit;
        readonly Action show;
        readonly Action restart;
        TcpListener listener;
        string leaseId;
        DateTime leaseUntil;
        readonly object leaseGate = new object();

        public bool Listening { get; private set; }

        public Helper(Func<Func<object>, object> onUi, Action quit, Action show, Action restart)
        {
            this.onUi = onUi;
            this.quit = quit;
            this.show = show;
            this.restart = restart;
        }

        /// <summary>Takes the port, and keeps trying every few seconds while another program holds it.</summary>
        public void Start()
        {
            var t = new Thread(() =>
            {
                while (true)
                {
                    try
                    {
                        listener = new TcpListener(IPAddress.Loopback, Paths.HelperPort);
                        listener.Start();
                        Listening = true;
                        Log.Write("Helper listening on " + Paths.HelperPort);
                        while (true)
                        {
                            var client = listener.AcceptTcpClient();
                            Task.Run(() => Serve(client));
                        }
                    }
                    catch (Exception e)
                    {
                        Listening = false;
                        try { listener?.Stop(); } catch { }
                        Log.Write("Helper port " + Paths.HelperPort + " unavailable (" + e.Message + "); trying again shortly");
                        Thread.Sleep(5000);
                    }
                }
            }) { IsBackground = true, Name = "helper" };
            t.Start();
        }

        sealed class Request
        {
            public string Method, Path, Origin;
            public Dictionary<string, string> Query = new Dictionary<string, string>();
            public Dictionary<string, string> Headers = new Dictionary<string, string>();
            public byte[] Body = new byte[0];
            public string Q(string k) => Query.TryGetValue(k, out var v) ? v : null;
        }

        async Task Serve(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 10000;
                    client.SendTimeout = 120000; // a paused phone player can stop reading for a while
                    var stream = client.GetStream();
                    var req = ReadRequest(stream);
                    if (req == null) return;
                    await Handle(req, stream).ConfigureAwait(false);
                }
                catch (Exception e)
                {
                    Log.Write("Helper error: " + e.Message);
                }
            }
        }

        static Request ReadRequest(NetworkStream stream)
        {
            var head = new MemoryStream();
            int b, state = 0;
            while (state < 4 && (b = stream.ReadByte()) >= 0)
            {
                head.WriteByte((byte)b);
                state = (b == '\r' && (state == 0 || state == 2)) || (b == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
                if (head.Length > 64 * 1024) return null;
            }
            var lines = Encoding.ASCII.GetString(head.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = lines[0].Split(' ');
            if (first.Length < 2) return null;
            var req = new Request { Method = first[0].ToUpperInvariant() };
            var target = first[1];
            var qi = target.IndexOf('?');
            req.Path = qi >= 0 ? target.Substring(0, qi) : target;
            if (qi >= 0)
                foreach (var pair in target.Substring(qi + 1).Split('&'))
                {
                    var kv = pair.Split(new[] { '=' }, 2);
                    if (kv.Length == 2) req.Query[Uri.UnescapeDataString(kv[0])] = Uri.UnescapeDataString(kv[1].Replace('+', ' '));
                }
            int length = 0;
            foreach (var l in lines.Skip(1))
            {
                var c = l.IndexOf(':');
                if (c <= 0) continue;
                var name = l.Substring(0, c).Trim().ToLowerInvariant();
                var value = l.Substring(c + 1).Trim();
                if (name == "origin") req.Origin = value;
                req.Headers[name] = value;
                if (name == "content-length") int.TryParse(value, out length);
            }
            if (length > 0)
            {
                if (length > 32 * 1024 * 1024) return null;
                req.Body = new byte[length];
                int read = 0;
                while (read < length)
                {
                    var n = stream.Read(req.Body, read, length - read);
                    if (n <= 0) break;
                    read += n;
                }
            }
            return req;
        }

        static void Reply(Stream stream, int code, string origin, object body)
        {
            var text = body is string s ? s : Json.Serialize(body);
            var bytes = Encoding.UTF8.GetBytes(text);
            var head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(code).Append(code == 200 ? " OK" : code == 204 ? " No Content" : " Status").Append("\r\n");
            head.Append("Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n");
            head.Append("Content-Length: ").Append(bytes.Length).Append("\r\n");
            if (origin != null)
                head.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Nightjar-Device\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n");
            head.Append("\r\n");
            var h = Encoding.ASCII.GetBytes(head.ToString());
            stream.Write(h, 0, h.Length);
            stream.Write(bytes, 0, bytes.Length);
        }

        static void SendImage(Stream stream, string file)
        {
            if (string.IsNullOrEmpty(file) || !ImageTypes.TryGetValue(Path.GetExtension(file), out var type) || !File.Exists(file))
            {
                var nf = Encoding.ASCII.GetBytes("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                stream.Write(nf, 0, nf.Length);
                return;
            }
            var bytes = File.ReadAllBytes(file);
            var head = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.Length + "\r\nCache-Control: private, max-age=3600\r\nConnection: close\r\n\r\n");
            stream.Write(head, 0, head.Length);
            stream.Write(bytes, 0, bytes.Length);
        }

        static string FindCover(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
            Func<string, List<FileInfo>> images = d =>
            {
                try { return new DirectoryInfo(d).GetFiles().Where(f => ImageTypes.ContainsKey(f.Extension) && f.Length < 15 * 1024 * 1024).ToList(); }
                catch { return new List<FileInfo>(); }
            };
            var list = images(dir);
            if (list.Count == 0)
            {
                // Some rips keep the art in a Scans or Artwork folder next to the tracks.
                var sub = new DirectoryInfo(dir).GetDirectories().FirstOrDefault(d => Regex.IsMatch(d.Name, "^(scans?|artwork|art|covers?|images?)$", RegexOptions.IgnoreCase));
                if (sub != null) list = images(sub.FullName);
            }
            if (list.Count == 0) return null;
            var named = list.FirstOrDefault(f => Regex.IsMatch(Path.GetFileNameWithoutExtension(f.Name), @"^(cover|folder|front|album|albumart|art)\b", RegexOptions.IgnoreCase));
            return (named ?? list.OrderByDescending(f => f.Length).First()).FullName;
        }

        static string InsideDownloads(string p)
        {
            if (string.IsNullOrEmpty(p)) return null;
            var full = Path.GetFullPath(p);
            foreach (var root in new[] { Config.DownloadDir(), Config.IncompleteDir() })
            {
                if (string.IsNullOrEmpty(root)) continue;
                var r = Path.GetFullPath(root).TrimEnd('\\') + "\\";
                if (full.StartsWith(r, StringComparison.OrdinalIgnoreCase)) return full;
            }
            return null;
        }

        static void ToRecycleBin(string path)
        {
            if (File.Exists(path)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(path, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
            else if (Directory.Exists(path)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(path, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
        }

        static string Sanitize(string segment)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) segment = segment.Replace(c, '_');
            return segment.Replace('/', '_').Replace('\\', '_');
        }

        /// <summary>Moves an album's folder, files and unfinished parts to the Recycle Bin. Never a download folder itself.</summary>
        static int TrashDownload(List<string> folders, List<string> files, List<Dictionary<string, object>> partials)
        {
            int removed = 0;
            var roots = new[] { Config.DownloadDir(), Config.IncompleteDir() }.Where(r => !string.IsNullOrEmpty(r)).Select(r => Path.GetFullPath(r).TrimEnd('\\')).ToList();
            Func<string, bool> isRoot = p => roots.Any(r => string.Equals(Path.GetFullPath(p).TrimEnd('\\'), r, StringComparison.OrdinalIgnoreCase));
            foreach (var folder in folders)
            {
                var full = InsideDownloads(folder);
                if (full == null || isRoot(full) || !Directory.Exists(full)) continue;
                try { ToRecycleBin(full); removed++; } catch (Exception e) { Log.Write("Couldn't delete " + full + ": " + e.Message); }
            }
            foreach (var file in files)
            {
                var full = InsideDownloads(file);
                if (full == null || !File.Exists(full)) continue;
                try { ToRecycleBin(full); removed++; } catch (Exception e) { Log.Write("Couldn't delete " + full + ": " + e.Message); }
            }
            var incomplete = Config.IncompleteDir();
            if (!string.IsNullOrEmpty(incomplete))
            {
                var touched = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var p in partials)
                {
                    var user = p.TryGetValue("user", out var u) ? u as string : null;
                    var remote = p.TryGetValue("file", out var r) ? r as string : null;
                    if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(remote)) continue;
                    var userDir = Path.Combine(incomplete, Sanitize(user));
                    if (!Directory.Exists(userDir)) continue;
                    var name = Sanitize(remote.Split('\\', '/').Last());
                    foreach (var hit in Directory.GetFiles(userDir, "*", SearchOption.AllDirectories).Where(x => string.Equals(Path.GetFileName(x), name, StringComparison.OrdinalIgnoreCase)))
                    {
                        try { ToRecycleBin(hit); removed++; touched.Add(userDir); } catch (Exception e) { Log.Write("Couldn't delete " + hit + ": " + e.Message); }
                    }
                }
                // Folders left empty in incomplete go too (they only held those parts).
                foreach (var dir in touched)
                    foreach (var d in Directory.GetDirectories(dir, "*", SearchOption.AllDirectories).OrderByDescending(x => x.Length).Concat(new[] { dir }))
                        try { if (!Directory.EnumerateFileSystemEntries(d).Any()) Directory.Delete(d); } catch { }
            }
            Log.Write("Deleted a download: " + removed + " items to the Recycle Bin");
            return removed;
        }

        /// <summary>
        /// Things only someone sitting at this computer may do: Windows dialogs and Explorer, changes that need
        /// Windows' permission, quitting, and the remote access setup itself. A phone can't use them, even when signed in.
        /// </summary>
        static readonly HashSet<string> ThisComputerOnly = new HashSet<string>
        {
            "/pick-folder", "/pick-image", "/reveal", "/upnp", "/firewall", "/quit", "/show",
            "/remote/code", "/remote/lan", "/tailscale/install", "/tailscale/login", "/tailscale/serve", "/tailscale/test",
        };

        async Task Handle(Request req, NetworkStream stream)
        {
            // Through Tailscale the helper is at https://<this computer>/nj; Tailscale may or may not pass the /nj on.
            if (req.Path == Tailscale.HelperPath || req.Path.StartsWith(Tailscale.HelperPath + "/"))
                req.Path = req.Path.Length == Tailscale.HelperPath.Length ? "/" : req.Path.Substring(Tailscale.HelperPath.Length);

            if (req.Path == "/img" || req.Path == "/cover" || req.Path == "/stream")
            {
                var k = req.Q("k");
                if (k != imgKey && !Remote.MediaKeyOk(k)) { Reply(stream, 403, null, new { }); return; }
                if (req.Path == "/stream") await SendTrack(req, stream).ConfigureAwait(false);
                else SendImage(stream, req.Path == "/cover" ? FindCover(req.Q("dir")) : req.Q("path"));
                return;
            }

            // The page in Nightjar's window (and luniceOS) comes from 127.0.0.1:5030, so the browser always says so.
            // Anything else (a phone through Tailscale, which asks from the same address) must show a device token.
            var local = Origins.Contains(req.Origin);
            var origin = local ? req.Origin : RemoteOrigin(req.Origin);
            if (req.Method == "OPTIONS") { Reply(stream, 204, origin, ""); return; }
            Remote.Device device = null;
            if (!local)
            {
                if (req.Path == "/ping") { Reply(stream, 200, origin, new { ok = true, host = "Nightjar" }); return; }
                if (req.Path == "/pair" && req.Method == "POST")
                {
                    var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                    string V(string key) => body.TryGetValue(key, out var v) ? v as string : null;
                    var (token, id, error, wait) = Remote.Pair(V("secret"), V("name"));
                    Reply(stream, token != null ? 200 : wait > 0 ? 429 : 401, origin, new { token, id, error, wait });
                    return;
                }
                device = Remote.Check(req.Headers.TryGetValue("x-nightjar-device", out var t) ? t : null);
                if (device == null) { Reply(stream, 401, origin, new { error = "signin" }); return; }
                if (ThisComputerOnly.Contains(req.Path)) { Reply(stream, 403, origin, new { error = "Only possible on the computer Nightjar runs on." }); return; }
            }

            switch (req.Path)
            {
                case "/remote/status":
                    {
                        var ts = Tailscale.Status(req.Q("fresh") == "1");
                        var (user, _) = Config.WebLogin();
                        Reply(stream, 200, origin, new
                        {
                            tailscale = ts,
                            address = ts.serving ? Tailscale.Address : null,
                            install = Tailscale.InstallState,
                            devices = Remote.List(),
                            you = device?.id,
                            passwordSet = Remote.RemotePasswordSet,
                            username = user,
                            lan = Config.WebAddress().StartsWith("0.0.0.0"),
                            lanAddresses = LanAddresses(),
                        });
                        return;
                    }
                case "/remote/code":
                    Reply(stream, 200, origin, req.Method == "DELETE" ? (object)new { ok = true, gone = Forget() } : Remote.NewCode());
                    return;
                case "/remote/device":
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        string V(string key) => body.TryGetValue(key, out var v) ? v as string : null;
                        if (req.Method == "DELETE" || V("action") == "remove")
                        {
                            var ok = Remote.Remove(V("id"));
                            // A new signing key ends the engine sessions that device still had.
                            if (ok) await EndSessions().ConfigureAwait(false);
                            Reply(stream, 200, origin, new { ok });
                        }
                        else Reply(stream, 200, origin, new { ok = Remote.Rename(V("id"), V("name")) });
                        return;
                    }
                case "/remote/signout-all":
                    if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                    Remote.RemoveAll();
                    Remote.ForgetCode();
                    await EndSessions().ConfigureAwait(false);
                    Reply(stream, 200, origin, new { ok = true });
                    return;
                case "/remote/password":
                    {
                        if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        var error = Remote.SetPassword(body.TryGetValue("password", out var v) ? v as string : null);
                        // The engine reads its login when it starts; the helper signs this page in again by itself.
                        if (error == null) restart();
                        Reply(stream, 200, origin, new { ok = error == null, error, restarting = error == null });
                        return;
                    }
                case "/remote/lan":
                    {
                        if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        var on = body.TryGetValue("on", out var v) && v is bool b && b;
                        if (on && !Remote.RemotePasswordSet) { Reply(stream, 200, origin, new { ok = false, error = "Choose a remote password first: it's what you type on the home network." }); return; }
                        var ok = Config.SetWebAddress(on);
                        if (ok) restart();
                        Reply(stream, 200, origin, new { ok, restarting = ok });
                        return;
                    }
                case "/tailscale/install":
                    if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                    Reply(stream, 200, origin, Tailscale.Install());
                    return;
                case "/tailscale/login":
                    if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                    Reply(stream, 200, origin, Tailscale.Login());
                    return;
                case "/tailscale/serve":
                    {
                        if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        Reply(stream, 200, origin, Tailscale.Serve(body.TryGetValue("on", out var v) && v is bool b && b));
                        return;
                    }
                case "/tailscale/test":
                    Reply(stream, 200, origin, await Tailscale.Test().ConfigureAwait(false));
                    return;
                case "/tracks":
                    {
                        var r = Media.Tracks(req.Q("dir"));
                        if (r == null) { Reply(stream, 404, origin, new { error = "That folder isn't in your library, downloads or shared folders." }); return; }
                        Reply(stream, 200, origin, r);
                        return;
                    }
                case "/fs/list":
                    Reply(stream, 200, origin, Media.Folders(req.Q("path")));
                    return;
                case "/ping":
                    Reply(stream, 200, origin, new { ok = true, host = "Nightjar" });
                    return;
                case "/img-key":
                    Reply(stream, 200, origin, new { key = device == null ? imgKey : Remote.MediaKeyFor(device.id) });
                    return;
                case "/token":
                    Reply(stream, 200, origin, new { token = await Engine.Token().ConfigureAwait(false) });
                    return;
                case "/library":
                    if (req.Method == "POST")
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        var root = body.TryGetValue("root", out var r) ? r as string : null;
                        if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) { Reply(stream, 400, origin, new { ok = false, error = "That folder doesn't exist." }); return; }
                        AppSettings.LibraryRoot = root;
                        Reply(stream, 200, origin, new { ok = true, root });
                    }
                    else
                    {
                        var root = AppSettings.LibraryRoot;
                        Reply(stream, 200, origin, new { root, formats = Organizer.Formats, exists = !string.IsNullOrEmpty(root) && Directory.Exists(root) });
                    }
                    return;
                case "/organize/waiting":
                    Reply(stream, 200, origin, new { albums = Organizer.Waiting(), recent = Organizer.Recent() });
                    return;
                case "/organize/plan":
                    {
                        var dir = req.Q("dir");
                        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) { Reply(stream, 404, origin, new { error = "That folder doesn't exist any more." }); return; }
                        Reply(stream, 200, origin, Organizer.Plan(dir));
                        return;
                    }
                case "/organize/move":
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        string V(string k) => body.TryGetValue(k, out var v) ? v as string : null;
                        Reply(stream, 200, origin, Organizer.Apply(V("dir"), V("format"), V("artist"), V("folder"), V("group")));
                        return;
                    }
                case "/organize/undo":
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        Reply(stream, 200, origin, Organizer.Undo(body.TryGetValue("id", out var v) ? v as string : null));
                        return;
                    }
                case "/library/scan":
                    if (req.Method == "POST") { Reply(stream, 200, origin, new { id = LibraryReview.StartScan().id }); return; }
                    {
                        var job = LibraryReview.GetScan(req.Q("id"));
                        if (job == null) { Reply(stream, 404, origin, new { error = "unknown" }); return; }
                        Reply(stream, 200, origin, new { job.id, job.root, job.done, job.total, job.finished, job.error, job.at, albums = job.finished ? job.albums : null });
                        return;
                    }
                case "/library/apply":
                    if (req.Method == "POST")
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        var job = LibraryReview.StartApply(body.TryGetValue("moves", out var mv) ? mv as System.Collections.IEnumerable : null);
                        Reply(stream, 200, origin, new { job.id, job.batch });
                        return;
                    }
                    {
                        var job = LibraryReview.GetApply(req.Q("id"));
                        if (job == null) { Reply(stream, 404, origin, new { error = "unknown" }); return; }
                        List<object> results;
                        lock (job.results) results = job.results.ToList();
                        Reply(stream, 200, origin, new { job.id, job.batch, job.done, job.total, job.finished, job.error, results });
                        return;
                    }
                case "/library/undo":
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        Reply(stream, 200, origin, LibraryReview.UndoBatch(body.TryGetValue("batch", out var v) ? v as string : null));
                        return;
                    }
                case "/library/batches":
                    Reply(stream, 200, origin, LibraryReview.Batches());
                    return;
                case "/library/recycle":
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        Reply(stream, 200, origin, LibraryReview.Recycle(body.TryGetValue("dir", out var v) ? v as string : null));
                        return;
                    }
                case "/validate":
                    if (req.Method == "POST")
                    {
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        var dir = body.TryGetValue("dir", out var d) ? d as string : null;
                        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) { Reply(stream, 404, origin, new { error = "That folder doesn't exist any more." }); return; }
                        Reply(stream, 200, origin, new { id = Validator.Start(dir).id });
                    }
                    else
                    {
                        var job = Validator.Get(req.Q("id"));
                        if (job == null) { Reply(stream, 404, origin, new { error = "unknown" }); return; }
                        List<Validator.Track> tracks;
                        lock (job.tracks) tracks = job.tracks.ToList();
                        Reply(stream, 200, origin, new { job.done, job.total, job.finished, job.error, job.album, tracks });
                    }
                    return;
                case "/known-folders":
                    {
                        var music = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
                        var od = Environment.GetEnvironmentVariable("OneDrive");
                        Reply(stream, 200, origin, new
                        {
                            music = Directory.Exists(music) ? music : null,
                            musicInOneDrive = !string.IsNullOrEmpty(od) && !string.IsNullOrEmpty(music) && music.StartsWith(od, StringComparison.OrdinalIgnoreCase),
                        });
                        return;
                    }
                case "/exists":
                    {
                        var p = req.Q("path");
                        Reply(stream, 200, origin, new { exists = !string.IsNullOrEmpty(p) && Directory.Exists(p) });
                        return;
                    }
                case "/pick-folder":
                    {
                        var start = req.Q("start");
                        var chosen = onUi(() =>
                        {
                            using (var d = new FolderBrowserDialog { Description = "Choose a folder for Nightjar", ShowNewFolderButton = true })
                            {
                                if (!string.IsNullOrEmpty(start) && Directory.Exists(start)) d.SelectedPath = start;
                                return d.ShowDialog() == DialogResult.OK ? d.SelectedPath : null;
                            }
                        }) as string;
                        Reply(stream, 200, origin, new { path = chosen });
                        return;
                    }
                case "/pick-image":
                    {
                        var chosen = onUi(() =>
                        {
                            using (var d = new OpenFileDialog { Title = "Choose your profile picture", Filter = "Pictures (JPG, PNG, GIF, BMP)|*.jpg;*.jpeg;*.png;*.gif;*.bmp" })
                                return d.ShowDialog() == DialogResult.OK ? d.FileName : null;
                        }) as string;
                        if (chosen == null) { Reply(stream, 200, origin, new { path = (string)null }); return; }
                        // Keep a copy next to the engine, so the picture works even if the original moves or lives only in OneDrive.
                        try
                        {
                            if (new FileInfo(chosen).Length > 5 * 1024 * 1024) { Reply(stream, 200, origin, new { path = (string)null, error = "That picture is larger than 5 MB." }); return; }
                            foreach (var old in Directory.GetFiles(Paths.Data, "profile.*")) File.Delete(old);
                            var copy = Path.Combine(Paths.Data, "profile" + Path.GetExtension(chosen).ToLowerInvariant());
                            File.Copy(chosen, copy, true);
                            Reply(stream, 200, origin, new { path = copy });
                        }
                        catch (Exception e)
                        {
                            Reply(stream, 200, origin, new { path = (string)null, error = "Nightjar couldn't read that picture: " + e.Message });
                        }
                        return;
                    }
                case "/image":
                    {
                        var p = req.Q("path") ?? "";
                        if (!ImageTypes.TryGetValue(Path.GetExtension(p), out var type) || !File.Exists(p) || new FileInfo(p).Length > 8 * 1024 * 1024)
                        {
                            Reply(stream, 404, origin, new { dataUrl = (string)null });
                            return;
                        }
                        Reply(stream, 200, origin, new { dataUrl = "data:" + type + ";base64," + Convert.ToBase64String(File.ReadAllBytes(p)) });
                        return;
                    }
                case "/update":
                    {
                        var st = req.Q("check") == "1" ? Updater.Check().GetAwaiter().GetResult() : Updater.Get();
                        Reply(stream, 200, origin, st);
                        return;
                    }
                case "/update/install":
                    if (req.Method != "POST") { Reply(stream, 405, origin, new { }); return; }
                    Reply(stream, 200, origin, Updater.Install());
                    return;
                case "/report":
                    {
                        var body = req.Body.Length > 0 ? Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body)) : new Dictionary<string, object>();
                        Reply(stream, 200, origin, Report.Make(body.TryGetValue("note", out var n) ? n as string : null));
                        return;
                    }
                case "/reveal":
                    {
                        var p = req.Q("path") ?? "";
                        if (File.Exists(p)) Process.Start("explorer.exe", "/select,\"" + p + "\"");
                        else if (Directory.Exists(p)) Process.Start("explorer.exe", "\"" + p + "\"");
                        else { Reply(stream, 404, origin, new { ok = false }); return; }
                        Reply(stream, 200, origin, new { ok = true });
                        return;
                    }
                case "/trash-download":
                    {
                        // An album you no longer want: its folder in Downloads, the files it saved, and the unfinished
                        // parts slskd keeps in its incomplete folder (incomplete\<user>\<their folders>\<file>).
                        var body = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(req.Body));
                        var folders = (body.TryGetValue("folders", out var f) ? f as System.Collections.ArrayList : null)?.Cast<object>().Select(x => x as string).Where(x => x != null).ToList() ?? new List<string>();
                        var files = (body.TryGetValue("files", out var fl) ? fl as System.Collections.ArrayList : null)?.Cast<object>().Select(x => x as string).Where(x => x != null).ToList() ?? new List<string>();
                        var partials = (body.TryGetValue("partials", out var pa) ? pa as System.Collections.ArrayList : null)?.Cast<object>().OfType<Dictionary<string, object>>().ToList() ?? new List<Dictionary<string, object>>();
                        Reply(stream, 200, origin, new { removed = TrashDownload(folders, files, partials) });
                        return;
                    }
                case "/trash":
                    {
                        // Only inside the download and incomplete folders, and only to the Recycle Bin.
                        var full = InsideDownloads(req.Q("path"));
                        if (full == null) { Reply(stream, 403, origin, new { ok = false, error = "outside download folders" }); return; }
                        try
                        {
                            if (File.Exists(full)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(full, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                            else if (Directory.Exists(full)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(full, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                            else { Reply(stream, 404, origin, new { ok = false }); return; }
                            Reply(stream, 200, origin, new { ok = true });
                        }
                        catch (Exception e) { Reply(stream, 500, origin, new { ok = false, error = e.Message }); }
                        return;
                    }
                case "/restart":
                    // Nightjar restarts the engine itself, so it keeps watching it.
                    restart();
                    Reply(stream, 202, origin, new { restarting = true });
                    return;
                case "/port-check":
                    {
                        var port = Config.ListenPort();
                        try
                        {
                            var page = await Web.GetStringAsync("http://tools.slsknet.org/porttest.php?port=" + port).ConfigureAwait(false);
                            var ip = Regex.Match(page, @"IP:\s*([0-9a-fA-F.:]+)").Groups[1].Value;
                            Reply(stream, 200, origin, new { port, open = page.Contains("/tcp open"), ip });
                        }
                        catch (Exception e) { Reply(stream, 200, origin, new { port, open = (bool?)null, error = e.Message }); }
                        return;
                    }
                case "/upnp":
                    {
                        string result = null;
                        var t = new Thread(() => result = Upnp.Open(Config.ListenPort()));
                        t.SetApartmentState(ApartmentState.STA);
                        t.Start();
                        t.Join(60000);
                        Log.Write("UPnP (asked): " + result);
                        Reply(stream, 200, origin, result ?? "{\"ok\":false,\"error\":\"The router did not answer in time.\"}");
                        return;
                    }
                case "/firewall":
                    Reply(stream, 200, origin, new { ok = Firewall.Allow() });
                    return;
                case "/prefs":
                    if (req.Method == "POST")
                    {
                        var text = Encoding.UTF8.GetString(req.Body);
                        Json.DeserializeObject(text); // refuse anything that isn't JSON
                        var tmp = Paths.Prefs + ".tmp";
                        File.WriteAllText(tmp, text, new UTF8Encoding(false));
                        if (File.Exists(Paths.Prefs)) File.Replace(tmp, Paths.Prefs, null); else File.Move(tmp, Paths.Prefs);
                        Reply(stream, 200, origin, new { ok = true });
                    }
                    else
                    {
                        string text = null;
                        try { text = File.ReadAllText(Paths.Prefs); } catch { }
                        Reply(stream, 200, origin, new { prefs = text });
                    }
                    return;
                case "/lease":
                    {
                        // Only one window runs the download manager; a window that stops asking loses it after 15 s.
                        var id = req.Q("id");
                        bool mine;
                        // The download manager runs on this computer; a phone only watches.
                        if (device != null) { Reply(stream, 200, origin, new { mine = false }); return; }
                        lock (leaseGate)
                        {
                            if (leaseId == null || leaseId == id || DateTime.UtcNow > leaseUntil) { leaseId = id; leaseUntil = DateTime.UtcNow.AddSeconds(15); }
                            mine = leaseId == id;
                        }
                        Reply(stream, 200, origin, new { mine });
                        return;
                    }
                case "/show":
                    show();
                    Reply(stream, 200, origin, new { ok = true });
                    return;
                case "/quit":
                    Reply(stream, 200, origin, new { ok = true });
                    quit();
                    return;
                default:
                    Reply(stream, 404, origin, new { });
                    return;
            }
        }

        /// <summary>The page's own https address through Tailscale, which a browser may name as the Origin.</summary>
        static string RemoteOrigin(string origin)
        {
            var address = Tailscale.Address;
            return origin != null && address != null && string.Equals(origin, address, StringComparison.OrdinalIgnoreCase) ? origin : null;
        }

        static bool Forget()
        {
            Remote.ForgetCode();
            return true;
        }

        /// <summary>Signs every page out of the engine (a new signing key, then a restart). This window signs in again by itself.</summary>
        async Task EndSessions()
        {
            if (Config.NewJwtKey()) restart();
            await Task.Delay(10).ConfigureAwait(false);
        }

        /// <summary>This computer's addresses on the home network, for "open http://192.168.x.x:5030 on your phone".</summary>
        static List<string> LanAddresses()
        {
            var list = new List<string>();
            try
            {
                foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
                    if (ni.Description.IndexOf("Tailscale", StringComparison.OrdinalIgnoreCase) >= 0 || ni.Description.IndexOf("Virtual", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    foreach (var a in ni.GetIPProperties().UnicastAddresses)
                    {
                        var ip = a.Address;
                        if (ip.AddressFamily != AddressFamily.InterNetwork) continue;
                        var b = ip.GetAddressBytes();
                        // Private ranges only: 192.168/16, 10/8, 172.16/12.
                        if (b[0] == 192 && b[1] == 168 || b[0] == 10 || b[0] == 172 && b[1] >= 16 && b[1] <= 31) list.Add(ip.ToString());
                    }
                }
            }
            catch { }
            return list.Distinct().ToList();
        }

        /// <summary>A track, as it is or as an AAC copy (aac=128 or 256), in the pieces the player asks for.</summary>
        static async Task SendTrack(Request req, NetworkStream stream)
        {
            var file = Media.Allowed(req.Q("path"));
            if (file == null || !File.Exists(file) || !Media.IsAudio(file)) { Reply(stream, 404, null, new { error = "not found" }); return; }
            req.Headers.TryGetValue("range", out var range);
            int.TryParse(req.Q("aac") ?? "", out var kbps);
            if (kbps > 0 && Media.CanConvert(file))
            {
                string copy;
                try { copy = await Media.Aac(file, kbps).ConfigureAwait(false); }
                catch (Exception e) { Reply(stream, 500, null, new { error = e.Message }); return; }
                Media.Send(stream, copy, range, "audio/mp4");
                return;
            }
            Media.Send(stream, file, range, Media.TypeOf(file));
        }
    }

    /// <summary>Lets the engine receive connections through Windows Firewall. Windows asks for permission first.</summary>
    static class Firewall
    {
        public static bool Allow()
        {
            var exe = Paths.Engine;
            // Removes old rules for the engine (including a "block" rule Windows adds when its own prompt is dismissed), then allows it.
            var cmd =
                "netsh advfirewall firewall delete rule name=all program=\"" + exe + "\" & " +
                "netsh advfirewall firewall add rule name=\"Nightjar (slskd)\" dir=in action=allow program=\"" + exe + "\" enable=yes profile=any & " +
                "netsh advfirewall firewall add rule name=\"Nightjar (slskd)\" dir=out action=allow program=\"" + exe + "\" enable=yes profile=any";
            try
            {
                var p = Process.Start(new ProcessStartInfo("cmd.exe", "/c " + cmd) { Verb = "runas", UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden });
                p.WaitForExit(120000);
                Log.Write("Firewall rule: exit " + p.ExitCode);
                return p.ExitCode == 0;
            }
            catch (Exception e)
            {
                Log.Write("Firewall rule not added: " + e.Message);
                return false;
            }
        }
    }
}
