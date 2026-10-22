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
                    tray.ShowBalloonTip(5000, "Nightjar is still running", "Downloads and sharing continue. Open Nightjar from this icon, or choose Quit to stop everything.", ToolTipIcon.Info);
                }
            };
            form.QuitRequested += () => Quit();
            form.ActionRequested += OnAction;

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Nightjar", null, (s, e) => ShowWindow());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Nightjar", null, (s, e) => Quit());
            tray = new NotifyIcon { Icon = Nightjar.MainForm.AppIcon(), Text = "Nightjar", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (s, e) => ShowWindow();

            helper = new Helper(fn => form.Invoke(fn), () => form.BeginInvoke((Action)(() => Quit())), () => form.BeginInvoke((Action)ShowWindow), () => Task.Run(() => engine.Restart()));
            Updater.Start(() => form.BeginInvoke((Action)(() => Quit())));
            helper.Start();

            engine.Status += text => form.BeginInvoke((Action)(() => form.SetStatus(text)));
            engine.Failed += p => form.BeginInvoke((Action)(() => { form.ShowProblem(p); ShowWindow(); }));
            engine.Ready += () => form.BeginInvoke((Action)(() =>
            {
                form.OpenPage();
                foreach (var note in engine.Notes) tray.ShowBalloonTip(8000, "Nightjar", note, ToolTipIcon.Warning);
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
            tray.Text = "Nightjar is closing…";
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
            Text = "Nightjar";
            Icon = AppIcon();
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0xe6, 0xe3, 0xdd);
            AutoScaleMode = AutoScaleMode.None;
            // One compact size, the same every time (the maximise button fills the screen when you want more).
            var scale = DeviceDpi / 96f;
            ClientSize = new Size((int)(1280 * scale), (int)(800 * scale));
            var area = Screen.FromPoint(Cursor.Position).WorkingArea;
            if (ClientSize.Width > area.Width || ClientSize.Height > area.Height) ClientSize = new Size(Math.Min(ClientSize.Width, area.Width), Math.Min(ClientSize.Height, area.Height));
            Controls.Add(web);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_MINIMIZEBOX = 0x20000, CS_DROPSHADOW = 0x20000;
                var cp = base.CreateParams;
                cp.Style |= WS_MINIMIZEBOX; // so the taskbar button can minimise it
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // Rounded corners on Windows 11.
            int round = 2;
            try { Native.DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)); } catch { }
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
                    MessageBox.Show(Problem.NoWebView().Text, "Nightjar", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
                    MessageBox.Show("Nightjar couldn't open its window: " + e.Message + "\n\nDownloads and sharing keep running next to the clock. Quit Nightjar from its icon there and open it again.", "Nightjar", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
            }
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached || File.Exists(Path.Combine(Paths.Data, "devtools"));
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
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
                using (var s = typeof(MainForm).Assembly.GetManifestResourceStream("splash.html"))
                using (var r = new StreamReader(s)) core.NavigateToString(r.ReadToEnd());
        }

        /// <summary>After a background start: out of sight, and ready to appear in the middle of the screen.</summary>
        public void HideAfterBackgroundStart()
        {
            Hide();
            Opacity = 1;
            CenterOn(Screen.PrimaryScreen.WorkingArea);
        }

        /// <summary>Brings a window that was started off screen to the middle of the screen.</summary>
        public void ComeOnScreen()
        {
            if (Location.X <= -30000) CenterOn(Screen.FromPoint(Cursor.Position).WorkingArea);
            Opacity = 1;
        }

        void CenterOn(Rectangle area)
        {
            Location = new Point(area.Left + Math.Max(0, (area.Width - Width) / 2), area.Top + Math.Max(0, (area.Height - Height) / 2));
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
                using (var s = typeof(MainForm).Assembly.GetManifestResourceStream("splash.html"))
                using (var r = new StreamReader(s)) web.CoreWebView2?.NavigateToString(r.ReadToEnd());
            }
            var actions = Array.ConvertAll(p.Actions, a => new { id = a.id, label = a.label });
            var script = "showProblem(" + Js(new { title = p.Title, text = p.Text, details = p.Details, actions }) + ")";
            pendingScript = script;
            Run("typeof showProblem==='function'&&" + script);
        }

        public void OpenPage()
        {
            pageOpen = true;
            pendingScript = null;
            web.CoreWebView2?.Navigate(Paths.EngineUrl + "/");
        }

        void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            System.Collections.Generic.Dictionary<string, object> m;
            try { m = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(e.WebMessageAsJson); }
            catch { return; }
            m.TryGetValue("type", out var type);
            if ((type as string) == "action" && m.TryGetValue("id", out var id)) { ActionRequested?.Invoke(id as string); return; }
            if ((type as string) != "window" || !m.TryGetValue("action", out var action)) return;
            switch (action as string)
            {
                case "drag":
                    if (maximized) return;
                    Native.ReleaseCapture();
                    Native.SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero);
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
            PostState();
        }

        void PostState()
        {
            try { web.CoreWebView2?.PostWebMessageAsJson("{\"type\":\"window\",\"maximized\":" + (maximized ? "true" : "false") + "}"); } catch { }
        }
    }

    static class Native
    {
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")] public static extern bool ReleaseCapture();
        [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
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
