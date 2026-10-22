using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Nightjar
{
    /// <summary>
    /// The slskd engine: started hidden, watched, restarted after a crash, and
    /// stopped cleanly on Quit. Nightjar is the only program that starts or stops it.
    /// </summary>
    sealed class Engine
    {
        public event Action<string> Status;          // a line for the start screen
        public event Action<Problem> Failed;         // the start screen's error, with what to do
        public event Action Ready;                   // the page can be shown
        public event Action ExitedOnPurpose;          // slskd was asked to shut down (Quit elsewhere)

        static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(6) };
        Process proc;
        volatile bool quitting;
        int crashes;
        DateTime firstCrash;

        public bool Running => proc != null && !proc.HasExited;

        public static async Task<bool> Up(int ms = 1500)
        {
            try
            {
                using (var cts = new CancellationTokenSource(ms))
                {
                    var r = await Http.GetAsync(Paths.EngineUrl + "/api/v0/session/enabled", cts.Token).ConfigureAwait(false);
                    return (int)r.StatusCode < 500;
                }
            }
            catch { return false; }
        }

        static bool PortFree(int port)
        {
            try
            {
                var l = new TcpListener(IPAddress.Loopback, port);
                l.Start();
                l.Stop();
                return true;
            }
            catch { return false; }
        }

        /// <summary>A token for slskd's API, signed in with the web login from the config.</summary>
        public static async Task<string> Token()
        {
            var (user, pass) = Config.WebLogin();
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass)) return null;
            try
            {
                var body = new JavaScriptSerializer().Serialize(new { username = user, password = pass });
                var r = await Http.PostAsync(Paths.EngineUrl + "/api/v0/session", new StringContent(body, Encoding.UTF8, "application/json")).ConfigureAwait(false);
                if (!r.IsSuccessStatusCode) return null;
                var json = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(await r.Content.ReadAsStringAsync().ConfigureAwait(false));
                return json.TryGetValue("token", out var t) ? t as string : null;
            }
            catch { return null; }
        }

        public static async Task<HttpResponseMessage> Call(HttpMethod method, string path, string jsonBody = null, int timeoutMs = 6000)
        {
            var req = new HttpRequestMessage(method, Paths.EngineUrl + "/api/v0/" + path);
            var t = await Token().ConfigureAwait(false);
            if (t != null) req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", t);
            if (jsonBody != null) req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
            using (var cts = new CancellationTokenSource(timeoutMs))
            {
                try { return await Http.SendAsync(req, cts.Token).ConfigureAwait(false); }
                catch { return null; }
            }
        }

        /// <summary>Checks, starts slskd and waits for it. Runs on a worker thread.</summary>
        int starting;

        /// <summary>Checks, starts slskd and waits for it. Runs on a worker thread; a second call while one runs does nothing.</summary>
        public async Task Start()
        {
            if (Interlocked.Exchange(ref starting, 1) == 1) return;
            try { await StartOnce().ConfigureAwait(false); }
            finally { Interlocked.Exchange(ref starting, 0); }
        }

        async Task StartOnce()
        {
            quitting = false;
            Status?.Invoke("Checking…");

            // Our own engine is already running (Try again after a slow start): just wait for it.
            if (Running)
            {
                await WaitUntilUp().ConfigureAwait(false);
                return;
            }

            if (!File.Exists(Paths.Engine))
            {
                Failed?.Invoke(Problem.Missing());
                return;
            }

            // One Soulseek login per account: SoulseekQt signs Nightjar out (and the other way round).
            if (SoulseekQtRunning())
            {
                Failed?.Invoke(Problem.SoulseekQtOpen());
                return;
            }

            // Something already answers on Nightjar's address: an older SSK-Lite, or an engine left behind.
            if (await Up().ConfigureAwait(false) || !PortFree(5030))
            {
                var stray = Process.GetProcessesByName("slskd").ToList();
                Failed?.Invoke(stray.Count > 0 ? Problem.StrayEngine() : Problem.PortBusy(5030));
                return;
            }

            if (!File.Exists(Paths.Config)) Config.WriteFirst();
            Notes = Config.Tidy();

            Status?.Invoke("Starting the engine…");
            Launch();
            await WaitUntilUp().ConfigureAwait(false);
        }

        async Task WaitUntilUp()
        {
            var until = DateTime.UtcNow.AddSeconds(90);
            while (DateTime.UtcNow < until)
            {
                if (proc == null || proc.HasExited) return; // the exit handler reports it
                if (await Up().ConfigureAwait(false))
                {
                    Log.Write("Engine is up");
                    Status?.Invoke("Opening…");
                    Ready?.Invoke();
                    OpenPortInBackground();
                    return;
                }
                await Task.Delay(700).ConfigureAwait(false);
            }
            Failed?.Invoke(Problem.Slow());
        }

        /// <summary>SoulseekQt open, checked a few times so one that is just closing isn't counted.</summary>
        internal static bool SoulseekQtRunning()
        {
            for (int i = 0; i < 6; i++)
            {
                if (!Process.GetProcessesByName("SoulseekQt").Any(p => { try { return !p.HasExited; } catch { return false; } })) return false;
                Thread.Sleep(500);
            }
            return true;
        }

        /// <summary>Stops the engine and starts it again (Restart now in Settings).</summary>
        public async Task Restart()
        {
            Log.Write("Restarting the engine");
            await Stop().ConfigureAwait(false);
            await Start().ConfigureAwait(false);
        }

        /// <summary>
        /// slskd can restart itself (PUT /application, from a browser tab): the old process ends with 0 and a new one
        /// starts on its own. Nightjar then watches the new one instead of quitting.
        /// </summary>
        async Task<bool> AdoptRestarted()
        {
            for (int i = 0; i < 16; i++)
            {
                await Task.Delay(500).ConfigureAwait(false);
                var p = Process.GetProcessesByName("slskd").Where(x => { try { return !x.HasExited; } catch { return false; } })
                    .OrderByDescending(x => { try { return x.StartTime; } catch { return DateTime.MinValue; } }).FirstOrDefault();
                if (p == null) continue;
                try
                {
                    p.EnableRaisingEvents = true;
                    p.Exited += (s, e) => OnExit(p);
                    proc = p;
                    Log.Write("slskd restarted itself (pid " + p.Id + "); watching it");
                    await WaitUntilUp().ConfigureAwait(false);
                    return true;
                }
                catch (Exception e) { Log.Write("Couldn't watch the restarted engine: " + e.Message); return false; }
            }
            return false;
        }

        public System.Collections.Generic.List<string> Notes = new System.Collections.Generic.List<string>();

        void Launch()
        {
            var psi = new ProcessStartInfo(Paths.Engine, "--app-dir \"" + Paths.Data + "\" --config \"" + Paths.Config + "\"")
            {
                WorkingDirectory = Path.GetDirectoryName(Paths.Engine),
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.Exited += (s, e) => OnExit(p);
            p.Start();
            proc = p;
            Log.Write("slskd started (pid " + p.Id + ")");
        }

        void OnExit(Process p)
        {
            if (p != proc) return;
            int code;
            try { code = p.ExitCode; } catch { code = -1; }
            Log.Write("slskd stopped (code " + code + ")");
            if (quitting) return;
            if (code == 0)
            {
                // slskd ends with 0 when asked to shut down (Quit in a browser tab, Turn off in luniceOS),
                // and also when it restarts itself: then a new one appears within a few seconds.
                Task.Run(async () => { if (!await AdoptRestarted().ConfigureAwait(false)) ExitedOnPurpose?.Invoke(); });
                return;
            }
            // A crash: start again, up to three times in two minutes.
            if (crashes == 0 || DateTime.UtcNow - firstCrash > TimeSpan.FromMinutes(2)) { crashes = 0; firstCrash = DateTime.UtcNow; }
            crashes++;
            if (crashes <= 3)
            {
                Status?.Invoke("The engine stopped unexpectedly. Starting it again…");
                Task.Run(async () => { await Task.Delay(1500); await Start(); });
            }
            else
            {
                Failed?.Invoke(Problem.Crashing(code, EngineLogTail()));
            }
        }

        public static string EngineLogTail()
        {
            try
            {
                var latest = new DirectoryInfo(Paths.Logs).GetFiles("slskd-*.log").OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
                if (latest == null) return "";
                using (var fs = new FileStream(latest.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sr = new StreamReader(fs))
                {
                    var lines = sr.ReadToEnd().Split('\n');
                    return string.Join("\n", lines.Where(l => l.Contains(" ERR]") || l.Contains(" FTL]") || l.Contains(" WRN]")).Reverse().Take(6).Reverse());
                }
            }
            catch { return ""; }
        }

        /// <summary>Asks slskd to close cleanly (it saves its state), then makes sure it's gone.</summary>
        public async Task Stop()
        {
            quitting = true;
            if (proc == null || proc.HasExited) return;
            Log.Write("Stopping the engine");
            await Call(HttpMethod.Delete, "application").ConfigureAwait(false);
            for (int i = 0; i < 40 && !proc.HasExited; i++) await Task.Delay(250).ConfigureAwait(false);
            if (!proc.HasExited)
            {
                try { proc.Kill(); } catch { }
                Log.Write("slskd didn't close in time and was ended");
            }
        }

        /// <summary>Ends every slskd process (an engine an older SSK-Lite left behind).</summary>
        public static void EndStrayEngines()
        {
            foreach (var p in Process.GetProcessesByName("slskd"))
            {
                try { p.Kill(); p.WaitForExit(5000); Log.Write("Ended slskd pid " + p.Id); } catch { }
            }
            // An older SSK-Lite keeps its tray icon running in PowerShell; it would start the engine again.
            foreach (var p in Process.GetProcessesByName("powershell"))
            {
                try
                {
                    if (CommandLine(p).IndexOf("SSK-Lite.ps1", StringComparison.OrdinalIgnoreCase) >= 0) { p.Kill(); Log.Write("Ended the old SSK-Lite launcher"); }
                }
                catch { }
            }
        }

        static string CommandLine(Process p)
        {
            try
            {
                using (var s = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + p.Id))
                    foreach (System.Management.ManagementObject o in s.Get()) return o["CommandLine"] as string ?? "";
            }
            catch { }
            return "";
        }

        /// <summary>Closes SoulseekQt (it hides next to the clock when its window closes, so it's ended) and waits until it's gone.</summary>
        public static void CloseSoulseekQt()
        {
            foreach (var p in Process.GetProcessesByName("SoulseekQt"))
            {
                try
                {
                    p.CloseMainWindow();
                    if (!p.WaitForExit(3000)) p.Kill();
                    p.WaitForExit(10000);
                    Log.Write("Closed SoulseekQt");
                }
                catch (Exception e) { Log.Write("Couldn't close SoulseekQt: " + e.Message); }
            }
            // Windows takes a moment to forget a process that just ended.
            for (int i = 0; i < 20 && Process.GetProcessesByName("SoulseekQt").Any(); i++) Thread.Sleep(250);
        }

        /// <summary>Asks the router to forward the listening port here (UPnP), without holding anything up.</summary>
        void OpenPortInBackground()
        {
            var t = new Thread(() =>
            {
                var r = Upnp.Open(Config.ListenPort());
                Log.Write("UPnP: " + r);
            }) { IsBackground = true };
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }
    }

    /// <summary>What went wrong, in plain words, and the buttons that fix it.</summary>
    sealed class Problem
    {
        public string Title, Text, Details;
        public (string id, string label)[] Actions;

        public static Problem Missing() => new Problem
        {
            Title = "Part of Nightjar is missing",
            Text = "The engine (slskd.exe) isn't where it should be. Your antivirus may have moved it to quarantine. Install Nightjar again; your settings and music stay.",
            Actions = new[] { ("logs", "Open the log folder"), ("quit", "Close") },
        };

        public static Problem SoulseekQtOpen() => new Problem
        {
            Title = "SoulseekQt is open",
            Text = "Soulseek allows one connection per account, so SoulseekQt and Nightjar would keep signing each other out. Close SoulseekQt (including its icon next to the clock), or let Nightjar close it.",
            Actions = new[] { ("close-soulseekqt", "Close SoulseekQt and continue"), ("retry", "I closed it, try again"), ("quit", "Quit Nightjar") },
        };

        public static Problem StrayEngine() => new Problem
        {
            Title = "Another copy of the engine is running",
            Text = "An older SSK-Lite (or one it left behind) is still running, so Nightjar can't start its own. Nightjar can end it for you; nothing is lost.",
            Actions = new[] { ("end-engines", "End it and continue"), ("retry", "Try again"), ("quit", "Quit Nightjar") },
        };

        public static Problem PortBusy(int port) => new Problem
        {
            Title = "Another program is using Nightjar's address",
            Text = "Port " + port + " on this computer is taken by another program, so the engine can't start. Close programs you don't need (or restart the computer), then try again.",
            Actions = new[] { ("retry", "Try again"), ("logs", "Open the log folder"), ("quit", "Quit Nightjar") },
        };

        public static Problem Slow() => new Problem
        {
            Title = "The engine is taking too long to start",
            Text = "This can happen right after Windows starts, or when an antivirus scans the engine. Try again; if it keeps happening, the log folder has the details.",
            Actions = new[] { ("retry", "Try again"), ("logs", "Open the log folder"), ("quit", "Quit Nightjar") },
        };

        public static Problem Crashing(int code, string details) => new Problem
        {
            Title = "The engine keeps stopping",
            Text = "It stopped three times in a row (code " + code + "). The lines below come from its log; usually it's a folder that no longer exists or a setting it can't read.",
            Details = details,
            Actions = new[] { ("retry", "Try again"), ("logs", "Open the log folder"), ("quit", "Quit Nightjar") },
        };

        public static Problem NoWebView() => new Problem
        {
            Title = "Microsoft Edge WebView2 is missing",
            Text = "Nightjar shows its window with WebView2, part of Windows 10 and 11. It seems to be missing or broken here. Install it from Microsoft (search for \"WebView2 Runtime\"), then open Nightjar again.",
            Actions = new[] { ("quit", "Close") },
        };
    }
}
