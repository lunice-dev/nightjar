using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Nightjar
{
    /// <summary>Where everything lives. The engine and its data sit next to Nightjar.exe.</summary>
    static class Paths
    {
        public static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        public static readonly string Engine = Path.Combine(Root, "slskd", "slskd.exe");
        public static readonly string Web = Path.Combine(Root, "slskd", "nightjar-web");
        public static readonly string Data = Path.Combine(Root, "data");
        public static readonly string Config = Path.Combine(Data, "slskd.yml");
        public static readonly string Prefs = Path.Combine(Data, "ssk-lite-prefs.json");
        public static readonly string Logs = Path.Combine(Data, "logs");
        public static readonly string WebView = Path.Combine(Data, "webview");
        public static readonly string Incomplete = Path.Combine(Data, "incomplete");
        public const string EngineUrl = "http://127.0.0.1:5030";
        public const int HelperPort = 5031;
        /// <summary>The helper's door for Tailscale: everything arriving here is from another device and needs its token.</summary>
        public const int RemoteHelperPort = 5032;
    }

    static class Log
    {
        static readonly object Gate = new object();
        public static string File => Path.Combine(Paths.Logs, "nightjar.log");
        public static void Write(string text)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(Paths.Logs);
                    var fi = new FileInfo(File);
                    if (fi.Exists && fi.Length > 2 * 1024 * 1024) fi.Delete();
                    System.IO.File.AppendAllText(File, DateTime.Now.ToString("s") + " " + text + Environment.NewLine, new UTF8Encoding(false));
                }
            }
            catch { }
        }
    }

    static class Program
    {
        public static bool Background;

        [STAThread]
        static void Main(string[] args)
        {
            Background = args.Any(a => a.Equals("--background", StringComparison.OrdinalIgnoreCase));

            // One Nightjar at a time. A second start asks the first one to show its window, then leaves.
            using (var mutex = new Mutex(true, @"Local\Nightjar-App", out bool first))
            {
                var show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Nightjar-Show");
                if (!first)
                {
                    if (!Background) show.Set();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => Crash(e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Crash(e.ExceptionObject as Exception);

                Log.Write("Starting Nightjar " + Application.ProductVersion + (Background ? " in the background" : ""));
                var app = new AppContext(show);
                Application.Run(app);
                Log.Write("Stopped");
            }
        }

        static void Crash(Exception e)
        {
            Log.Write("Unexpected error: " + e);
            try
            {
                MessageBox.Show(
                    "Nightjar ran into a problem it couldn't handle:\n\n" + (e?.Message ?? "unknown error") +
                    "\n\nThe details are in " + Log.File + ".\nOpen Nightjar again from the Start menu. If it keeps happening, send that file to lunice.",
                    "Nightjar", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
        }
    }
}
