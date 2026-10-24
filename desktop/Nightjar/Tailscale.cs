using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Nightjar
{
    /// <summary>
    /// Remote access goes through Tailscale, a private network between your own devices.
    /// Nightjar installs it (the official installer, after checking it is signed by Tailscale),
    /// starts its sign-in, and asks it to serve Nightjar on this computer's private https address:
    ///   /    → slskd and the page (127.0.0.1:5030)
    ///   /nj  → this app's helper (127.0.0.1:5031)
    /// Only devices signed in to the same Tailscale account can reach that address.
    /// </summary>
    static class Tailscale
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly HttpClient Web = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        public const string HelperPath = "/nj";

        public static string Exe
        {
            get
            {
                foreach (var dir in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetEnvironmentVariable("ProgramW6432") })
                {
                    if (string.IsNullOrEmpty(dir)) continue;
                    var p = Path.Combine(dir, "Tailscale", "tailscale.exe");
                    if (File.Exists(p)) return p;
                }
                return null;
            }
        }

        /// <summary>Runs the Tailscale command line and returns its exit code and output (both streams).</summary>
        static (int code, string output) Run(string args, int timeoutMs = 15000, Func<string, bool> stopWhen = null)
        {
            var exe = Exe;
            if (exe == null) return (-1, "Tailscale isn't installed.");
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            var output = new StringBuilder();
            var done = new ManualResetEventSlim();
            using (var p = new Process { StartInfo = psi })
            {
                DataReceivedEventHandler on = (s, e) =>
                {
                    if (e.Data == null) return;
                    lock (output) output.AppendLine(e.Data);
                    if (stopWhen != null) { string all; lock (output) all = output.ToString(); if (stopWhen(all)) done.Set(); }
                };
                p.OutputDataReceived += on;
                p.ErrorDataReceived += on;
                try { p.Start(); }
                catch (Exception e) { return (-1, e.Message); }
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                var waitExit = Task.Run(() => p.WaitForExit(timeoutMs));
                Task.WaitAny(waitExit, Task.Run(() => done.Wait(timeoutMs)));
                if (!p.HasExited)
                {
                    try { p.Kill(); } catch { }
                    lock (output) return (-2, output.ToString());
                }
                p.WaitForExit(); // flushes the output events
                lock (output) return (p.ExitCode, output.ToString());
            }
        }

        static readonly Regex LoginUrl = new Regex(@"https://login\.tailscale\.com/\S+");

        public sealed class State
        {
            public bool installed;
            /// <summary>Running, NeedsLogin, NeedsMachineAuth, Stopped, Starting or NoState.</summary>
            public string backend;
            public string dnsName;     // this computer's private name, e.g. pc.tail1234.ts.net
            public bool https;         // the account allows https certificates
            public bool serving;       // Nightjar is served on that name
            public string account;
            public string error;
        }

        static State cached;
        static DateTime cachedAt;

        /// <summary>What Tailscale is doing now. Cached for a few seconds: the page asks often while a step runs.</summary>
        public static State Status(bool fresh = false)
        {
            if (!fresh && cached != null && (DateTime.UtcNow - cachedAt).TotalSeconds < 3) return cached;
            var st = new State { installed = Exe != null };
            if (st.installed)
            {
                var (code, text) = Run("status --json", 8000);
                try
                {
                    var j = Json.Deserialize<Dictionary<string, object>>(text.Substring(Math.Max(0, text.IndexOf('{'))));
                    st.backend = j.TryGetValue("BackendState", out var b) ? b as string : null;
                    if (j.TryGetValue("Self", out var self) && self is Dictionary<string, object> s && s.TryGetValue("DNSName", out var dns))
                        st.dnsName = (dns as string ?? "").TrimEnd('.');
                    if (j.TryGetValue("CertDomains", out var certs) && certs is System.Collections.ArrayList list) st.https = list.Count > 0;
                    if (j.TryGetValue("CurrentTailnet", out var tn) && tn is Dictionary<string, object> t && t.TryGetValue("Name", out var name)) st.account = name as string;
                }
                catch
                {
                    // Not running (the service is stopped) or an answer we don't know.
                    st.backend = "NoState";
                    st.error = text.Trim();
                }
                if (st.backend == "Running") st.serving = Serving();
            }
            if (string.IsNullOrEmpty(st.dnsName)) st.dnsName = null;
            cached = st;
            cachedAt = DateTime.UtcNow;
            return st;
        }

        public static string Address => cached?.dnsName == null ? null : "https://" + cached.dnsName;

        /// <summary>True when both of Nightjar's paths are in Tailscale's serve settings.</summary>
        static bool Serving()
        {
            var (code, text) = Run("serve status --json", 8000);
            if (code != 0) return false;
            // {"TCP":{"443":{"HTTPS":true}},"Web":{"name:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:5030"},"/nj":{"Proxy":"http://127.0.0.1:5031"}}}}}
            return Regex.IsMatch(text, @"""/""\s*:\s*\{\s*""Proxy""\s*:\s*""http://127\.0\.0\.1:5030/?""")
                && Regex.IsMatch(text, @"""" + HelperPath + @"/?""\s*:\s*\{\s*""Proxy""\s*:\s*""http://127\.0\.0\.1:" + Paths.HelperPort + @"/?""");
        }

        // --- install ------------------------------------------------------------------

        public sealed class Job
        {
            public string step = "starting";   // download, check, install, done, failed
            public int percent;
            public string error;
            public bool finished;
        }

        static Job install;

        public static Job InstallState => install;

        /// <summary>Downloads the official installer, checks it is signed by Tailscale, and runs it (Windows asks for permission).</summary>
        public static Job Install()
        {
            if (install != null && !install.finished) return install;
            var job = install = new Job();
            Task.Run(async () =>
            {
                string msi = null;
                try
                {
                    job.step = "download";
                    var name = await LatestMsi().ConfigureAwait(false);
                    var dir = Path.Combine(Paths.Data, "tmp");
                    Directory.CreateDirectory(dir);
                    msi = Path.Combine(dir, name);
                    using (var r = await Web.GetAsync("https://pkgs.tailscale.com/stable/" + name, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                    {
                        r.EnsureSuccessStatusCode();
                        var total = r.Content.Headers.ContentLength ?? 0;
                        using (var src = await r.Content.ReadAsStreamAsync().ConfigureAwait(false))
                        using (var dst = File.Create(msi))
                        {
                            var buf = new byte[81920];
                            long got = 0;
                            int n;
                            while ((n = await src.ReadAsync(buf, 0, buf.Length).ConfigureAwait(false)) > 0)
                            {
                                await dst.WriteAsync(buf, 0, n).ConfigureAwait(false);
                                got += n;
                                if (total > 0) job.percent = (int)(got * 100 / total);
                            }
                        }
                    }
                    job.step = "check";
                    var signer = Signer(msi);
                    if (signer == null || !signer.Contains("Tailscale"))
                        throw new Exception("The downloaded installer isn't signed by Tailscale" + (signer == null ? "" : " (signed by " + signer + ")") + ", so Nightjar didn't run it.");
                    job.step = "install";
                    Log.Write("Installing Tailscale from " + name);
                    var p = Process.Start(new ProcessStartInfo("msiexec.exe", "/i \"" + msi + "\" /passive /norestart") { Verb = "runas", UseShellExecute = true });
                    p.WaitForExit();
                    if (p.ExitCode != 0 && p.ExitCode != 3010 && p.ExitCode != 1641)
                        throw new Exception(p.ExitCode == 1602 ? "The installation was cancelled." : "The installer stopped with code " + p.ExitCode + ".");
                    // The service takes a moment to start.
                    for (int i = 0; i < 30 && Exe == null; i++) await Task.Delay(1000).ConfigureAwait(false);
                    job.step = "done";
                    Log.Write("Tailscale installed");
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    job.step = "failed";
                    job.error = "Windows permission was not given, so Tailscale wasn't installed.";
                }
                catch (Exception e)
                {
                    job.step = "failed";
                    job.error = e.Message;
                    Log.Write("Tailscale install failed: " + e.Message);
                }
                finally
                {
                    try { if (msi != null) File.Delete(msi); } catch { }
                    job.finished = true;
                }
            });
            return job;
        }

        /// <summary>The current stable 64-bit MSI's file name, from Tailscale's package site.</summary>
        static async Task<string> LatestMsi()
        {
            try
            {
                var json = await Web.GetStringAsync("https://pkgs.tailscale.com/stable/?mode=json").ConfigureAwait(false);
                var j = Json.Deserialize<Dictionary<string, object>>(json);
                if (j.TryGetValue("MSIs", out var m) && m is Dictionary<string, object> msis && msis.TryGetValue("amd64", out var a) && a is string s && s.EndsWith(".msi"))
                    return s;
            }
            catch { }
            var page = await Web.GetStringAsync("https://pkgs.tailscale.com/stable/").ConfigureAwait(false);
            var hit = Regex.Match(page, @"tailscale-setup-[0-9.]+-amd64\.msi");
            if (!hit.Success) throw new Exception("Couldn't find the Tailscale installer on pkgs.tailscale.com.");
            return hit.Value;
        }

        /// <summary>Who signed a file, when Windows says the signature is valid; otherwise null.</summary>
        static string Signer(string file)
        {
            var script = "$s = Get-AuthenticodeSignature -LiteralPath '" + file.Replace("'", "''") + "'; if ($s.Status -eq 'Valid') { $s.SignerCertificate.Subject }";
            var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -Command \"" + script.Replace("\"", "\\\"") + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
            };
            try
            {
                using (var p = Process.Start(psi))
                {
                    var text = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(30000);
                    text = text.Trim();
                    return text.Length == 0 ? null : text;
                }
            }
            catch { return null; }
        }

        // --- sign in --------------------------------------------------------------------

        /// <summary>
        /// Starts Tailscale's sign-in and opens its page in the browser. Returns the page's address
        /// (to show as a link too), or a message when Tailscale needs something else first.
        /// </summary>
        public static object Login()
        {
            var st = Status(true);
            if (!st.installed) return new { ok = false, error = "Tailscale isn't installed yet." };
            if (st.backend == "Running") return new { ok = true, already = true };
            // "login" starts a sign-in without changing any setting; "up" is for a computer that was disconnected.
            var verb = st.backend == "Stopped" ? "up" : "login";
            var (code, text) = Run(verb, 20000, all => LoginUrl.IsMatch(all));
            var url = LoginUrl.Match(text).Value;
            if (url.Length > 0)
            {
                try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
                return new { ok = true, url };
            }
            if (Status(true).backend == "Running") return new { ok = true, already = true };
            Log.Write("Tailscale " + verb + ": " + text.Trim());
            return new
            {
                ok = false,
                error = text.Contains("mention all non-default flags")
                    ? "Tailscale is set up differently on this computer. Open Tailscale from the icon next to the clock and choose Connect."
                    : (text.Trim().Length > 0 ? text.Trim() : "Tailscale didn't start its sign-in."),
            };
        }

        // --- serve ----------------------------------------------------------------------

        /// <summary>
        /// Serves Nightjar on this computer's private https address. When the Tailscale account
        /// hasn't allowed https yet, returns the page where the person allows it (once per account).
        /// </summary>
        public static object Serve(bool on)
        {
            if (!on)
            {
                Run("serve --https=443 --set-path=" + HelperPath + " off", 10000);
                var (c, t) = Run("serve --https=443 --set-path=/ off", 10000);
                Status(true);
                Log.Write("Tailscale serve off");
                return new { ok = true };
            }
            var st = Status(true);
            if (st.backend != "Running") return new { ok = false, error = "Tailscale isn't connected." };
            foreach (var args in new[]
            {
                "serve --bg --yes --https=443 http://127.0.0.1:5030",
                "serve --bg --yes --https=443 --set-path=" + HelperPath + " http://127.0.0.1:" + Paths.HelperPort,
            })
            {
                var (code, text) = Run(args, 20000, all => LoginUrl.IsMatch(all));
                var url = LoginUrl.Match(text).Value;
                if (url.Length > 0)
                {
                    // Tailscale waits until https (Serve) is allowed for the account; that page allows it.
                    return new { ok = false, consent = url };
                }
                if (code != 0)
                {
                    Log.Write("Tailscale serve failed (" + code + "): " + text.Trim());
                    return new
                    {
                        ok = false,
                        error = Regex.IsMatch(text, "access denied|Access is denied", RegexOptions.IgnoreCase)
                            ? "Tailscale only lets the Windows user who signed in to it change this. Sign in to Tailscale on this Windows account."
                            : text.Trim(),
                    };
                }
            }
            st = Status(true);
            Log.Write("Tailscale serve on: " + Address);
            return new { ok = st.serving, address = Address, error = st.serving ? null : "Tailscale didn't keep the setting." };
        }

        /// <summary>Opens Nightjar's own address the way a phone would, to prove the whole path works.</summary>
        public static async Task<object> Test()
        {
            var st = Status(true);
            if (!st.serving || st.dnsName == null) return new { ok = false, error = "Remote access isn't on." };
            try
            {
                using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) })
                {
                    var page = await http.GetAsync("https://" + st.dnsName + "/").ConfigureAwait(false);
                    var helper = await http.GetAsync("https://" + st.dnsName + HelperPath + "/ping").ConfigureAwait(false);
                    var ok = page.IsSuccessStatusCode && helper.IsSuccessStatusCode;
                    return new { ok, error = ok ? null : "The address answered with " + (int)page.StatusCode + " / " + (int)helper.StatusCode + "." };
                }
            }
            catch (Exception e)
            {
                // The first https request can take a while: Tailscale fetches the certificate then.
                return new { ok = false, error = e.InnerException?.Message ?? e.Message };
            }
        }
    }
}
