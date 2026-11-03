using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Nightjar
{
    /// <summary>
    /// Everything Nightjar is on Windows: the window (no Windows title bar; the page
    /// draws its own), the icon next to the clock, the engine and the helper.
    /// Closing the window keeps Nightjar running next to the clock; Quit ends it all.
    /// </summary>
    sealed class AppContext : ApplicationContext
    {
        readonly Nightjar.MainForm form;
        readonly NotifyIcon tray;
        readonly Engine engine = new Engine();
        readonly Helper helper;
        bool quitting;
        bool toldAboutTray;

        public AppContext(EventWaitHandle show)
        {
            form = new Nightjar.MainForm();
            form.Closing += (s, e) =>
            {
                if (quitting) return;
                e.Cancel = true;
                form.Hide();
                if (!toldAboutTray)
                {
                    toldAboutTray = true;
                    tray.ShowBalloonTip(5000, "nightjar is still running", "Downloads and sharing continue. Open nightjar from this icon, or choose Quit to stop everything.", ToolTipIcon.Info);
                }
            };
            form.QuitRequested += () => Quit();
            form.ActionRequested += OnAction;

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open nightjar", null, (s, e) => ShowWindow());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit nightjar", null, (s, e) => Quit());
            tray = new NotifyIcon { Icon = Nightjar.MainForm.AppIcon(), Text = "nightjar", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (s, e) => ShowWindow();

            helper = new Helper(fn => form.Invoke(fn), () => form.BeginInvoke((Action)(() => Quit())), () => form.BeginInvoke((Action)ShowWindow), () => Task.Run(() => engine.Restart()));
            Updater.Start(() => form.BeginInvoke((Action)(() => Quit())));
            helper.Start();
            Tailscale.UpgradeServe();
            Playlists.Backup();

            engine.Status += text => form.BeginInvoke((Action)(() => form.SetStatus(text)));
            engine.Failed += p => form.BeginInvoke((Action)(() => { form.ShowProblem(p); ShowWindow(); }));
            engine.Ready += () => form.BeginInvoke((Action)(() =>
            {
                form.OpenPage();
                foreach (var note in engine.Notes) tray.ShowBalloonTip(8000, "nightjar", note, ToolTipIcon.Warning);
            }));
            engine.ExitedOnPurpose += () => form.BeginInvoke((Action)(() => Quit(engineAlreadyStopped: true)));

            // A second start of Nightjar asks this one to show its window.
            var waiter = new Thread(() => { while (true) { show.WaitOne(); try { form.BeginInvoke((Action)ShowWindow); } catch { } } }) { IsBackground = true };
            waiter.Start();

            form.Load += async (s, e) =>
            {
                // The engine doesn't wait for the window: downloads and sharing start even if the window has trouble.
                try { Migration.FromSskLite(); } catch (Exception ex) { Log.Write("Moving from SSK-Lite failed: " + ex.Message); }
                _ = Task.Run(() => engine.Start());
                await form.Prepare();
                if (Program.Background && !shownOnPurpose) form.HideAfterBackgroundStart();
            };
            if (Program.Background)
            {
                // Started in the background (with Windows, or by luniceOS): the window is created off screen and
                // invisible so the page and its download manager run, then hidden once it's ready. WebView2 needs a
                // visible, stable window while it starts, so nothing about the window changes until then.
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-32000, -32000);
                form.Opacity = 0;
            }
            form.Show();
        }

        bool shownOnPurpose;

        void ShowWindow()
        {
            if (quitting) return;
            shownOnPurpose = true;
            form.ComeOnScreen();
            if (!form.Visible) form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Activate();
        }

        async void OnAction(string id)
        {
            switch (id)
            {
                case "retry":
                    form.SetStatus("Trying again…");
                    _ = Task.Run(() => engine.Start());
                    break;
                case "close-soulseekqt":
                    form.SetStatus("Closing SoulseekQt…");
                    await Task.Run(() => Engine.CloseSoulseekQt());
                    _ = Task.Run(() => engine.Start());
                    break;
                case "end-engines":
                    form.SetStatus("Ending the other engine…");
                    await Task.Run(() => Engine.EndStrayEngines());
                    await Task.Delay(1500);
                    _ = Task.Run(() => engine.Start());
                    break;
                case "logs":
                    Directory.CreateDirectory(Paths.Logs);
                    Process.Start("explorer.exe", "\"" + Paths.Logs + "\"");
                    break;
                case "quit":
                    Quit();
                    break;
            }
        }

        async void Quit(bool engineAlreadyStopped = false)
        {
            if (quitting) return;
            quitting = true;
            Log.Write("Quitting");
            form.Hide();
            tray.Text = "nightjar is closing…";
            if (!engineAlreadyStopped) await engine.Stop();
            tray.Visible = false;
            tray.Dispose();
            form.Close();
            ExitThread();
        }
    }

    sealed class MainForm : Form
    {
        public event Action QuitRequested;
        public event Action<string> ActionRequested;
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        bool pageOpen;
        Rectangle normalBounds;
        bool maximized;
        string pendingScript;

        public static Icon AppIcon()
        {
            using (var s = typeof(MainForm).Assembly.GetManifestResourceStream("nightjar.ico")) return new Icon(s);
        }

        public MainForm()
        {
            Text = "nightjar";
            Icon = AppIcon();
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = ThemeBack(ChosenTheme);
            web.DefaultBackgroundColor = BackColor; // no white flash between the opening screen and the app
            AutoScaleMode = AutoScaleMode.None;
            var scale = DeviceDpi / 96f;
            MinimumSize = new Size((int)(960 * scale), (int)(600 * scale));
            // Where it was last time, or filling the screen the first time; the page's edges and buttons resize it.
            Place(Screen.FromPoint(Cursor.Position).WorkingArea);
            Controls.Add(web);
        }

        static string StatePath => Path.Combine(Paths.Data, "window.json");

        /// <summary>Puts the window where it was last time (size, place, maximised), or maximised on `area` the first time.</summary>
        void Place(Rectangle area)
        {
            var scale = DeviceDpi / 96f;
            Rectangle? saved = null;
            bool max = true;
            try
            {
                if (File.Exists(StatePath))
                {
                    var d = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(File.ReadAllText(StatePath));
                    var r = new Rectangle(Convert.ToInt32(d["x"]), Convert.ToInt32(d["y"]), Convert.ToInt32(d["w"]), Convert.ToInt32(d["h"]));
                    max = d.TryGetValue("maximized", out var mx) && mx is bool b && b;
                    // Only if enough of it is still on a screen (a monitor may have been unplugged).
                    foreach (var s in Screen.AllScreens)
                    {
                        var seen = Rectangle.Intersect(s.WorkingArea, r);
                        if (seen.Width >= 160 && seen.Height >= 100 && r.Width >= MinimumSize.Width && r.Height >= MinimumSize.Height) { saved = r; area = s.WorkingArea; break; }
                    }
                }
            }
            catch { }
            if (saved == null)
            {
                // What Restore goes back to: a normal window, clearly smaller than the screen.
                var w = Math.Min((int)(1280 * scale), (int)(area.Width * 0.85));
                var h = Math.Min((int)(800 * scale), (int)(area.Height * 0.85));
                saved = new Rectangle(area.Left + (area.Width - w) / 2, area.Top + (area.Height - h) / 2, w, h);
                max = true; // the first time, the whole screen
            }
            StartPosition = FormStartPosition.Manual;
            normalBounds = saved.Value;
            maximized = max;
            Bounds = max ? area : saved.Value;
        }

        void SaveState()
        {
            // Not while minimised or parked off screen: those positions mean nothing.
            if (WindowState != FormWindowState.Normal || Location.X <= -30000) return;
            try
            {
                var b = maximized ? normalBounds : Bounds;
                File.WriteAllText(StatePath, new JavaScriptSerializer().Serialize(new { x = b.X, y = b.Y, w = b.Width, h = b.Height, maximized }));
            }
            catch { }
        }

        protected override void OnResizeEnd(EventArgs e)
        {
            base.OnResizeEnd(e);
            if (!maximized) SaveState(); // after a move or a resize
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_MINIMIZEBOX = 0x20000, WS_THICKFRAME = 0x40000, CS_DROPSHADOW = 0x20000;
                var cp = base.CreateParams;
                cp.Style |= WS_MINIMIZEBOX; // so the taskbar button can minimise it
                cp.Style |= WS_THICKFRAME; // so Windows will resize and snap it; the frame itself is never drawn (see WndProc)
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            // WM_NCCALCSIZE: the page covers the whole window, so there is no frame to make room for.
            if (m.Msg == 0x0083 && m.WParam != IntPtr.Zero) { m.Result = IntPtr.Zero; return; }
            // WM_HOTKEY: a media key while the bit-perfect player has a track.
            if (m.Msg == 0x0312)
            {
                int i = m.WParam.ToInt32() - MediaKeyId;
                if (i >= 0 && i < MediaActions.Length)
                    try { web.CoreWebView2?.PostWebMessageAsJson("{\"type\":\"media\",\"action\":\"" + MediaActions[i] + "\"}"); } catch { }
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // Rounded corners on Windows 11.
            int round = 2;
            try { Native.DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)); } catch { }
            BitPerfect.Holding += on => { try { BeginInvoke((Action)(() => MediaKeys(on))); } catch { } };
        }

        // The keyboard's media keys reach the page through the system only while a page plays sound itself. With the
        // bit-perfect player the sound comes from here, so the window takes the keys for as long as it has a track.
        const int MediaKeyId = 0x4E4A;
        static readonly int[] MediaKeyCodes = { 0xB3, 0xB0, 0xB1, 0xB2 }; // play/pause, next, previous, stop
        static readonly string[] MediaActions = { "playpause", "next", "previous", "stop" };
        bool mediaKeys;

        void MediaKeys(bool on)
        {
            if (on == mediaKeys || !IsHandleCreated) return;
            mediaKeys = on;
            for (int i = 0; i < MediaKeyCodes.Length; i++)
            {
                if (!on) Native.UnregisterHotKey(Handle, MediaKeyId + i);
                else if (!Native.RegisterHotKey(Handle, MediaKeyId + i, 0x4000 /* MOD_NOREPEAT */, MediaKeyCodes[i]))
                    Log.Write("Bit-perfect: another program has media key " + MediaKeyCodes[i].ToString("X2"));
            }
        }

        public async Task Prepare()
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    var env = await CoreWebView2Environment.CreateAsync(null, Paths.WebView);
                    await web.EnsureCoreWebView2Async(env);
                    break;
                }
                catch (WebView2RuntimeNotFoundException)
                {
                    MessageBox.Show(Problem.NoWebView().Text, "nightjar", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    QuitRequested?.Invoke();
                    return;
                }
                catch (Exception e) when (attempt < 4)
                {
                    // WebView2 gives up (E_ABORT) if its window changes while it starts; a moment later it works.
                    Log.Write("Window not ready (" + e.Message + "), trying again");
                    await Task.Delay(800 * attempt);
                }
                catch (Exception e)
                {
                    Log.Write("Window failed: " + e);
                    MessageBox.Show("nightjar couldn't open its window: " + e.Message + "\n\nDownloads and sharing keep running next to the clock. Quit nightjar from its icon there and open it again.", "nightjar", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
            }
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached || File.Exists(Path.Combine(Paths.Data, "devtools"));
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            // The page does its own swipe back / forward (with the page following the finger); the browser's would fight it.
            core.Settings.IsSwipeNavigationEnabled = false;
            core.WebMessageReceived += OnMessage;
            // Links that open a new window go to the default browser.
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http")) Process.Start(u.ToString());
            };
            // Once the app is open, the window stays on it: the mouse's back button, Alt+Left or a stray link
            // must not take it back to the opening screen or anywhere else.
            core.NavigationStarting += (s, e) =>
            {
                if (pageOpen && !e.Uri.StartsWith(Paths.EngineUrl, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
            };
            core.NavigationCompleted += (s, e) =>
            {
                PostState();
                if (pendingScript != null) { _ = core.ExecuteScriptAsync(pendingScript); pendingScript = null; }
            };
            core.ProcessFailed += (s, e) =>
            {
                Log.Write("Window process failed: " + e.ProcessFailedKind);
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
                try { if (pageOpen) core.Reload(); } catch { }
            };
            if (pageOpen) core.Navigate(Paths.EngineUrl + "/");
            else
                { splashShownAt = DateTime.Now; core.NavigateToString(SplashHtml()); }
        }

        /// <summary>After a background start: out of sight, and ready to appear in the middle of the screen.</summary>
        public void HideAfterBackgroundStart()
        {
            Hide();
            Opacity = 1;
            Place(Screen.PrimaryScreen.WorkingArea);
        }

        /// <summary>Brings a window that was started off screen to where it belongs.</summary>
        public void ComeOnScreen()
        {
            if (Location.X <= -30000) Place(Screen.FromPoint(Cursor.Position).WorkingArea);
            Opacity = 1;
        }

        void Run(string script)
        {
            if (web.CoreWebView2 == null) { pendingScript = script; return; }
            _ = web.CoreWebView2.ExecuteScriptAsync(script);
        }

        static string Js(object o) => new JavaScriptSerializer().Serialize(o);

        public void SetStatus(string text)
        {
            if (pageOpen) return;
            Run("typeof setStatus==='function'&&setStatus(" + Js(text) + ")");
        }

        public void ShowProblem(Problem p)
        {
            if (pageOpen)
            {
                pageOpen = false;
                web.CoreWebView2?.NavigateToString(SplashHtml());
                splashShownAt = DateTime.MinValue; // a problem: no flight to wait for
            }
            var actions = Array.ConvertAll(p.Actions, a => new { id = a.id, label = a.label });
            var script = "showProblem(" + Js(new { title = p.Title, text = p.Text, details = p.Details, actions }) + ")";
            pendingScript = script;
            Run("typeof showProblem==='function'&&" + script);
        }

        /// <summary>When the opening screen (with the bird's flight) was last shown.</summary>
        DateTime splashShownAt = DateTime.MinValue;
        /// <summary>How long the bird's flight on the opening screen lasts, plus half a second on the finished logo.</summary>
        static readonly TimeSpan Intro = TimeSpan.FromSeconds(3.7);

        public async void OpenPage()
        {
            // Let the bird land first: the app appears once the opening flight has finished. Not when the window is
            // out of sight (a background start) or Windows has animations turned off (the opening screen is then still).
            var onScreen = Visible && Opacity > 0 && Location.X > -30000 && SystemInformation.UIEffectsEnabled;
            var wait = splashShownAt + Intro - DateTime.Now;
            if (wait > TimeSpan.Zero && onScreen) await Task.Delay(wait);
            if (pageOpen) return;
            // The opening screen fades out softly; the app then fades in (see .intro-done in the page's styles).
            if (onScreen && splashShownAt != DateTime.MinValue)
            {
                Run("document.body.classList.add('leaving')");
                await Task.Delay(320);
                if (pageOpen) return;
            }
            pageOpen = true;
            pendingScript = null;
            web.CoreWebView2?.Navigate(Paths.EngineUrl + "/");
        }

        static readonly string[] Themes = { "light", "dark", "oled", "glass" };

        /// <summary>The theme chosen in the page ("light", "dark", "oled", "glass"), or null for Auto (follows Windows).
        /// The page reports it whenever it changes; kept in data\nightjar.json so the opening screen matches next time.</summary>
        static string ChosenTheme => AppSettings.Get("theme") is string t && Array.IndexOf(Themes, t) >= 0 ? t : null;

        static bool WindowsIsLight()
        {
            try
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    return k?.GetValue("AppsUseLightTheme") is int v && v == 1;
            }
            catch { return false; }
        }

        /// <summary>The window's own colour, seen for a moment before the page paints: the theme's background.</summary>
        static Color ThemeBack(string theme)
        {
            switch (theme ?? (WindowsIsLight() ? "light" : "dark"))
            {
                case "light": return Color.FromArgb(0xe4, 0xe1, 0xda);
                case "oled": return Color.Black;
                case "glass": return Color.FromArgb(0x0c, 0x0e, 0x12);
                default: return Color.FromArgb(0x0f, 0x11, 0x1a);
            }
        }

        static string SplashHtml()
        {
            string html;
            using (var s = typeof(MainForm).Assembly.GetManifestResourceStream("splash.html"))
            using (var r = new StreamReader(s)) html = r.ReadToEnd();
            var t = ChosenTheme;
            return html.Replace("data-theme-slot", t != null ? "data-theme=\"" + t + "\"" : "");
        }

        void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            System.Collections.Generic.Dictionary<string, object> m;
            try { m = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(e.WebMessageAsJson); }
            catch { return; }
            m.TryGetValue("type", out var type);
            if ((type as string) == "theme")
            {
                m.TryGetValue("theme", out var chosen);
                var t = chosen as string;
                if (t != "system" && Array.IndexOf(Themes, t) < 0) return;
                var keep = t == "system" ? null : t;
                if (keep != ChosenTheme) AppSettings.Set("theme", keep);
                BackColor = ThemeBack(keep);
                web.DefaultBackgroundColor = BackColor;
                return;
            }
            if ((type as string) == "action" && m.TryGetValue("id", out var id)) { ActionRequested?.Invoke(id as string); return; }
            if ((type as string) != "window" || !m.TryGetValue("action", out var action)) return;
            switch (action as string)
            {
                case "drag":
                    if (maximized) return;
                    Native.ReleaseCapture();
                    Native.SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero);
                    break;
                case "resize":
                    // The page's invisible edges hand over a drag on a border or corner; Windows does the resizing.
                    if (maximized || !m.TryGetValue("edge", out var edge)) return;
                    int ht;
                    switch (edge as string)
                    {
                        case "left": ht = 10; break;
                        case "right": ht = 11; break;
                        case "top": ht = 12; break;
                        case "topleft": ht = 13; break;
                        case "topright": ht = 14; break;
                        case "bottom": ht = 15; break;
                        case "bottomleft": ht = 16; break;
                        case "bottomright": ht = 17; break;
                        default: return;
                    }
                    Native.ReleaseCapture();
                    Native.SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)ht, IntPtr.Zero);
                    break;
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "maximize": ToggleMaximize(); break;
                case "close": Close(); break;
                case "quit": QuitRequested?.Invoke(); break;
            }
        }

        void ToggleMaximize()
        {
            if (!maximized)
            {
                normalBounds = Bounds;
                Bounds = Screen.FromControl(this).WorkingArea;
                maximized = true;
            }
            else
            {
                Bounds = normalBounds;
                maximized = false;
            }
            SaveState();
            PostState();
        }

        void PostState()
        {
            try { web.CoreWebView2?.PostWebMessageAsJson("{\"type\":\"window\",\"resizable\":true,\"maximized\":" + (maximized ? "true" : "false") + "}"); } catch { }
        }
    }

    static class Native
    {
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")] public static extern bool ReleaseCapture();
        [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, int key);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    }

    /// <summary>Moving from SSK-Lite: its settings, login, history and preferences come along, once.</summary>
    static class Migration
    {
        public static void FromSskLite()
        {
            if (File.Exists(Paths.Config)) return;
            var old = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "SSK-Lite", "data");
            if (!File.Exists(Path.Combine(old, "slskd.yml"))) return;
            Log.Write("Bringing settings over from SSK-Lite");
            Engine.EndStrayEngines(); // its engine holds the databases open
            Copy(old, Paths.Data);
        }

        static void Copy(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from))
                try { File.Copy(f, Path.Combine(to, Path.GetFileName(f)), false); } catch (Exception e) { Log.Write("Couldn't copy " + f + ": " + e.Message); }
            foreach (var d in Directory.GetDirectories(from))
            {
                var name = Path.GetFileName(d);
                // The old browser window's profile and unfinished downloads stay behind.
                if (name.Equals("window", StringComparison.OrdinalIgnoreCase) || name.Equals("incomplete", StringComparison.OrdinalIgnoreCase) || name.Equals("downloads", StringComparison.OrdinalIgnoreCase)) continue;
                Copy(d, Path.Combine(to, name));
            }
        }
    }
}
