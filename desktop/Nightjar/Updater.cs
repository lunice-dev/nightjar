using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Nightjar
{
    /// <summary>
    /// Keeps Nightjar up to date from its GitHub releases: looks now and then, says when there's a new version,
    /// and on request downloads the installer, checks it, runs it quietly and opens the new Nightjar.
    /// Your data folder stays as it is.
    /// </summary>
    static class Updater
    {
        /// <summary>Where releases are published ("owner/repo"); data\nightjar.json "updateRepo" overrides it.</summary>
        public const string DefaultRepo = "lunice-dev/nightjar";

        public sealed class State
        {
            public string current, latest, notes, url, page, error, repo;
            public bool available, checking, downloading, ready;
            public long size, received;
            public long checkedAt;
        }

        static readonly State state = new State { current = Current() };
        static readonly object Gate = new object();
        static string sha256Url;
        static Action quit;
        static System.Threading.Timer timer;

        public static string Repo => (AppSettings.UpdateRepo ?? DefaultRepo ?? "").Trim();

        public static State Get()
        {
            lock (Gate) { state.repo = Repo; return state; }
        }

        /// <summary>The version this is: "0.6.0" from "0.6.0+abc123".</summary>
        static string Current() => Regex.Match(Application.ProductVersion ?? "0.0.0", @"^\d+(\.\d+){0,3}").Value;

        static Version V(string s)
        {
            var m = Regex.Match(s ?? "", @"\d+(\.\d+){0,3}");
            return m.Success && Version.TryParse(m.Value.Contains('.') ? m.Value : m.Value + ".0", out var v) ? v : new Version(0, 0);
        }

        public static void Start(Action quitApp)
        {
            quit = quitApp;
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            // A minute after starting, then every six hours.
            timer = new System.Threading.Timer(_ => { _ = Check(); }, null, TimeSpan.FromMinutes(1), TimeSpan.FromHours(6));
        }

        static HttpClient Client()
        {
            var c = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Nightjar/" + Current());
            c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            return c;
        }

        public static async Task<State> Check()
        {
            var repo = Repo;
            lock (Gate)
            {
                if (state.checking || state.downloading) return state;
                if (string.IsNullOrEmpty(repo)) { state.error = null; return state; }
                state.checking = true;
            }
            try
            {
                using (var c = Client())
                {
                    var json = await c.GetStringAsync("https://api.github.com/repos/" + repo + "/releases/latest");
                    var r = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                    var tag = r.TryGetValue("tag_name", out var t) ? t as string : null;
                    var assets = (r.TryGetValue("assets", out var a) ? a as System.Collections.IEnumerable : null)?.OfType<Dictionary<string, object>>().ToList() ?? new List<Dictionary<string, object>>();
                    var setup = assets.FirstOrDefault(x => Regex.IsMatch(x["name"] as string ?? "", @"^Nightjar-Setup-.*\.exe$", RegexOptions.IgnoreCase));
                    var sum = assets.FirstOrDefault(x => (x["name"] as string ?? "").EndsWith(".sha256", StringComparison.OrdinalIgnoreCase));
                    lock (Gate)
                    {
                        state.latest = Regex.Match(tag ?? "", @"\d+(\.\d+){0,3}").Value;
                        state.notes = r.TryGetValue("body", out var b) ? b as string : null;
                        state.page = r.TryGetValue("html_url", out var h) ? h as string : null;
                        state.url = setup?["browser_download_url"] as string;
                        state.size = setup != null && setup.TryGetValue("size", out var sz) ? Convert.ToInt64(sz) : 0;
                        sha256Url = sum?["browser_download_url"] as string;
                        state.available = state.url != null && V(state.latest) > V(state.current);
                        state.error = null;
                        state.checkedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    }
                    if (state.available) Log.Write("Update available: " + state.latest);
                }
            }
            catch (Exception e)
            {
                lock (Gate) state.error = "Couldn't look for updates: " + (e.InnerException?.Message ?? e.Message);
            }
            finally { lock (Gate) state.checking = false; }
            return state;
        }

        /// <summary>Downloads, checks and runs the new installer, then quits so it can replace the files.</summary>
        public static object Install()
        {
            string url, version;
            lock (Gate)
            {
                if (!state.available || state.url == null) return new { ok = false, error = "There's no new version to install." };
                if (state.downloading) return new { ok = true };
                state.downloading = true;
                state.received = 0;
                state.error = null;
                url = state.url;
                version = state.latest;
            }
            Task.Run(async () =>
            {
                var file = Path.Combine(Path.GetTempPath(), "Nightjar-Setup-" + version + ".exe");
                try
                {
                    using (var c = Client())
                    using (var res = await c.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                    {
                        res.EnsureSuccessStatusCode();
                        using (var src = await res.Content.ReadAsStreamAsync())
                        using (var dst = File.Create(file))
                        {
                            var buf = new byte[81920];
                            int n;
                            while ((n = await src.ReadAsync(buf, 0, buf.Length)) > 0)
                            {
                                await dst.WriteAsync(buf, 0, n);
                                lock (Gate) state.received += n;
                            }
                        }
                        if (state.size > 0 && new FileInfo(file).Length != state.size) throw new IOException("the download is incomplete");
                        if (sha256Url != null)
                        {
                            var expected = Regex.Match(await c.GetStringAsync(sha256Url), "[0-9a-fA-F]{64}").Value.ToLowerInvariant();
                            string actual;
                            using (var h = SHA256.Create())
                            using (var s = File.OpenRead(file)) actual = BitConverter.ToString(h.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
                            if (expected.Length == 64 && expected != actual) throw new IOException("the download doesn't match its checksum");
                        }
                    }
                    Log.Write("Installing update " + version);
                    lock (Gate) { state.ready = true; state.downloading = false; }
                    // The installer closes Nightjar, replaces the program (your data stays) and opens it again.
                    Process.Start(new ProcessStartInfo(file, "/S /update") { UseShellExecute = true });
                    await Task.Delay(1500);
                    quit?.Invoke();
                }
                catch (Exception e)
                {
                    Log.Write("Update failed: " + e.Message);
                    try { File.Delete(file); } catch { }
                    lock (Gate) { state.downloading = false; state.error = "The update couldn't be installed: " + e.Message; }
                }
            });
            return new { ok = true };
        }
    }
}
