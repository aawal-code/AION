using System;
using System.IO;
using System.Net;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

namespace AION.Desktop
{
    static class Program
    {
        private const string MUTEX_NAME = @"Global\AION_Desktop_SingleInstance";
        private static Mutex singleInstanceMutex = null;

        [DllImport("shell32.dll", SetLastError = true)]
        private static extern void SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        public static uint WM_AION_RESTORE = 0;

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                SetCurrentProcessExplicitAppUserModelID("AION.Desktop.App");
            }
            catch { }

            WM_AION_RESTORE = RegisterWindowMessage("AION_RESTORE_WINDOW_SIGNAL");

            bool isNewInstance = false;
            string instanceId = Environment.GetEnvironmentVariable("AION_INSTANCE_ID") ?? "";
            try
            {
                // Test installations can opt into a distinct mutex without
                // weakening the normal single-window production instance.
                string mutexName = string.IsNullOrWhiteSpace(instanceId) ? MUTEX_NAME : MUTEX_NAME + "_" + instanceId;
                singleInstanceMutex = new Mutex(true, mutexName, out isNewInstance);
            }
            catch
            {
                isNewInstance = false;
            }

            if (!isNewInstance)
            {
                // Signal existing instance to restore & focus
                try
                {
                    if (String.IsNullOrWhiteSpace(instanceId) && WM_AION_RESTORE != 0)
                    {
                        PostMessage((IntPtr)0xffff /* HWND_BROADCAST */, WM_AION_RESTORE, IntPtr.Zero, IntPtr.Zero);
                    }

                    IntPtr existingHwnd = String.IsNullOrWhiteSpace(instanceId) ? FindWindow(null, "AION") : IntPtr.Zero;
                    if (existingHwnd != IntPtr.Zero)
                    {
                        ShowWindow(existingHwnd, 9 /* SW_RESTORE */);
                        SetForegroundWindow(existingHwnd);
                    }
                }
                catch { }

                // Exit duplicate process immediately
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                Application.Run(new MainWindow(args));
            }
            finally
            {
                if (singleInstanceMutex != null)
                {
                    try { singleInstanceMutex.ReleaseMutex(); } catch { }
                    singleInstanceMutex.Dispose();
                }
            }
        }
    }

    public class MainWindow : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        // Windows Kernel Job Object P/Invoke
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll")]
        private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public UInt64 ReadOperationCount;
            public UInt64 WriteOperationCount;
            public UInt64 OtherOperationCount;
            public UInt64 ReadTransferCount;
            public UInt64 WriteTransferCount;
            public UInt64 OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public Int64 PerProcessUserTimeLimit;
            public Int64 PerJobUserTimeLimit;
            public UInt32 LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public UInt32 ActiveProcessLimit;
            public UIntPtr Affinity;
            public UInt32 PriorityClass;
            public UInt32 SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryLimit;
            public UIntPtr PeakJobMemoryLimit;
        }

        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        private const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        private WebView2 webView;
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private Process nodeProcess = null;
        private IntPtr jobObjectHandle = IntPtr.Zero;
        private System.Windows.Forms.Timer watchdogTimer;
        private string appDir;
        private string rootDir;
        private string nodePath;
        private string serverJs;
        private readonly string hostPort;
        private bool isExiting = false;
        private bool isNodeRestarting = false;
        private readonly string localAuthSecret = CreateLocalAuthSecret();

        private static string CreateLocalAuthSecret()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }

        public MainWindow(string[] args)
        {
            this.appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            string requestedPort = Environment.GetEnvironmentVariable("AION_PORT");
            int validatedPort;
            this.hostPort = Int32.TryParse(requestedPort, out validatedPort) && validatedPort > 0 && validatedPort < 65536 ? validatedPort.ToString() : "5050";
            ResolvePaths();

            InitializeJobObject();
            InitializeForm();
            InitializeTray();
            InitializeWebView();

            StartOrSuperviseNode();
            InitializeWatchdog();

            this.FormClosing += MainWindow_FormClosing;
            Application.ApplicationExit += (s, e) => CleanupAll();
            AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanupAll();
        }

        protected override void WndProc(ref Message m)
        {
            if (Program.WM_AION_RESTORE != 0 && m.Msg == (int)Program.WM_AION_RESTORE)
            {
                RestoreWindow();
                return;
            }
            base.WndProc(ref m);
        }

        private void InitializeJobObject()
        {
            try
            {
                jobObjectHandle = CreateJobObject(IntPtr.Zero, null);
                if (jobObjectHandle != IntPtr.Zero)
                {
                    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                    IntPtr extendedInfoPtr = Marshal.AllocHGlobal(length);
                    Marshal.StructureToPtr(info, extendedInfoPtr, false);
                    SetInformationJobObject(jobObjectHandle, JobObjectExtendedLimitInformation, extendedInfoPtr, (uint)length);
                    Marshal.FreeHGlobal(extendedInfoPtr);
                }
            }
            catch { }
        }

        private void ResolvePaths()
        {
            // Explicitly determine the root directory where server.js lives
            rootDir = appDir;

            if (File.Exists(Path.Combine(appDir, "server.js")))
            {
                rootDir = appDir;
                serverJs = Path.Combine(appDir, "server.js");
            }
            else if (File.Exists(Path.Combine(appDir, "src", "server.js")))
            {
                rootDir = appDir;
                serverJs = Path.Combine(appDir, "src", "server.js");
            }
            else
            {
                string parentDir = Path.GetFullPath(Path.Combine(appDir, ".."));
                if (File.Exists(Path.Combine(parentDir, "server.js")))
                {
                    rootDir = parentDir;
                    serverJs = Path.Combine(rootDir, "server.js");
                }
                else if (File.Exists(Path.Combine(parentDir, "src", "server.js")))
                {
                    rootDir = parentDir;
                    serverJs = Path.Combine(rootDir, "src", "server.js");
                }
                else
                {
                    serverJs = Path.Combine(rootDir, "src", "server.js");
                }
            }

            // Sync appDir to rootDir to ensure all data and asset paths resolve cleanly
            appDir = rootDir;

            string[] nodeCandidates = new string[]
            {
                Path.Combine(rootDir, "runtime", "node.exe"),
                Path.Combine(rootDir, "node", "node.exe"),
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime", "node.exe"),
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node", "node.exe")
            };

            nodePath = "node.exe";
            foreach (string candidate in nodeCandidates)
            {
                if (File.Exists(candidate))
                {
                    nodePath = candidate;
                    break;
                }
            }
        }

        private void InitializeForm()
        {
            this.Text = "AION";
            this.Size = new Size(1220, 840);
            this.MinimumSize = new Size(900, 600);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 17, 32); // #0b1120 dark background
            this.ForeColor = Color.White;

            string iconPath = Path.Combine(appDir, "public", "brand", "aion.ico");
            if (File.Exists(iconPath))
            {
                try { this.Icon = new Icon(iconPath); } catch { }
            }
            if (this.Icon == null)
            {
                try { this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            }

            try
            {
                int darkMode = 1;
                DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
                DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref darkMode, sizeof(int));
            }
            catch { }
        }

        private void InitializeTray()
        {
            trayMenu = new ContextMenuStrip();
            trayMenu.Renderer = new DarkMenuRenderer();

            ToolStripMenuItem openItem = new ToolStripMenuItem("Open AION", null, (s, e) => RestoreWindow());
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);

            ToolStripMenuItem pairItem = new ToolStripMenuItem("Security & pairing", null, (s, e) => ShowPairingDialog());
            ToolStripMenuItem restartItem = new ToolStripMenuItem("Restart Core", null, (s, e) => RestartNodeCore());
            ToolStripSeparator sep = new ToolStripSeparator();
            ToolStripMenuItem exitItem = new ToolStripMenuItem("Exit", null, (s, e) => ExitApplication());

            trayMenu.Items.Add(openItem);
            trayMenu.Items.Add(pairItem);
            trayMenu.Items.Add(restartItem);
            trayMenu.Items.Add(sep);
            trayMenu.Items.Add(exitItem);

            trayIcon = new NotifyIcon();
            trayIcon.Text = "AION Workstation Orchestrator";
            trayIcon.ContextMenuStrip = trayMenu;
            if (this.Icon != null)
            {
                trayIcon.Icon = this.Icon;
            }
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => RestoreWindow();
        }

        private async void InitializeWebView()
        {
            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.FromArgb(11, 17, 32);
            this.Controls.Add(webView);

            string overrideData = Environment.GetEnvironmentVariable("AION_WEBVIEW2_DATA_PATH");
            string userDataFolder = String.IsNullOrWhiteSpace(overrideData)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AION", "webview2-data")
                : Path.GetFullPath(overrideData);
            Directory.CreateDirectory(userDataFolder);

            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);

                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = false;

                webView.CoreWebView2.NavigationCompleted += (s, e) =>
                {
                    if (!e.IsSuccess && !isExiting)
                    {
                        Task.Run(async () =>
                        {
                            await Task.Delay(1000);
                            if (await IsDaemonAvailable() && webView != null && webView.CoreWebView2 != null)
                            {
                                this.BeginInvoke(new Action(() =>
                                {
                                    BootstrapWebViewSession();
                                }));
                            }
                        });
                    }
                };

                BootstrapWebViewSession();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to initialize WebView2 control: " + ex.Message,
                    "AION Initialization Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private async void BootstrapWebViewSession()
        {
            for (int i = 0; i < 50; i++)
            {
                if (await IsDaemonAvailable())
                {
                    break;
                }
                await Task.Delay(200);
            }

            if (webView != null && webView.CoreWebView2 != null)
            {
                CoreWebView2WebResourceRequest request = webView.CoreWebView2.Environment.CreateWebResourceRequest(
                    "http://localhost:" + hostPort + "/api/auth/local-session",
                    "GET",
                    null,
                    "X-AION-Local-Secret: " + localAuthSecret
                );
                webView.CoreWebView2.NavigateWithWebResourceRequest(request);
            }
        }

        private Task<bool> IsDaemonAvailable()
        {
            return Task.Run(() =>
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + hostPort + "/");
                    req.Timeout = 800;
                    using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    {
                        return res.StatusCode == HttpStatusCode.OK;
                    }
                }
                catch
                {
                    return false;
                }
            });
        }

        private void StartOrSuperviseNode()
        {
            if (isExiting || isNodeRestarting) return;

            Task.Run(async () =>
            {
                bool isRunning = await IsDaemonAvailable();
                if (isRunning)
                {
                    return; // Already responsive
                }

                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(nodePath, "\"" + serverJs + "\"")
                    {
                        WorkingDirectory = rootDir,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = false,
                        RedirectStandardError = false
                    };
                    psi.EnvironmentVariables["PORT"] = hostPort;
                    psi.EnvironmentVariables["NODE_ENV"] = "production";
                    psi.EnvironmentVariables["TS_NOLAUNCH"] = "true";
                    psi.EnvironmentVariables["AION_LOCAL_AUTH_SECRET"] = localAuthSecret;

                    nodeProcess = Process.Start(psi);
                    if (nodeProcess != null && jobObjectHandle != IntPtr.Zero)
                    {
                        try
                        {
                            AssignProcessToJobObject(jobObjectHandle, nodeProcess.Handle);
                        }
                        catch { }
                    }
                }
                catch { }
            });
        }

        private void InitializeWatchdog()
        {
            watchdogTimer = new System.Windows.Forms.Timer();
            watchdogTimer.Interval = 15000; // 15 seconds
            watchdogTimer.Tick += (s, e) => RunWatchdogCycle();
            watchdogTimer.Start();
        }

        private void RunWatchdogCycle()
        {
            if (isExiting || isNodeRestarting) return;

            Task.Run(async () =>
            {
                // 1. Self-heal Node Core (:5050)
                bool daemonUp = await IsDaemonAvailable();
                if (!daemonUp && !isExiting && !isNodeRestarting)
                {
                    StartOrSuperviseNode();
                }

                // 2. Check Tailscale mesh readiness
                CheckTailscaleStatus();

                // 3. Check RustDesk screen view service readiness
                CheckRustDeskStatus();
            });
        }

        private void CheckTailscaleStatus()
        {
            try
            {
                string manifestPath = Path.Combine(appDir, "install-manifest.json");
                if (File.Exists(manifestPath))
                {
                    string content = File.ReadAllText(manifestPath);
                    if (content.IndexOf("\"installedTailscale\": true", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        content.IndexOf("\"installedTailscale\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        ProcessStartInfo psi = new ProcessStartInfo("tailscale", "status")
                        {
                            CreateNoWindow = true,
                            UseShellExecute = false,
                            WindowStyle = ProcessWindowStyle.Hidden
                        };
                        using (Process p = Process.Start(psi))
                        {
                            if (p != null)
                            {
                                p.WaitForExit(3000);
                                if (p.ExitCode != 0)
                                {
                                    // Service may have dropped; attempt non-intrusive service restart
                                    ProcessStartInfo svcPsi = new ProcessStartInfo("net", "start Tailscale")
                                    {
                                        CreateNoWindow = true,
                                        UseShellExecute = false
                                    };
                                    Process.Start(svcPsi);
                                }
                            }
                        }
                    }
                }
            }
            catch { }
        }

        private void CheckRustDeskStatus()
        {
            try
            {
                string manifestPath = Path.Combine(appDir, "install-manifest.json");
                if (File.Exists(manifestPath))
                {
                    string content = File.ReadAllText(manifestPath);
                    if (content.IndexOf("\"installedRustDesk\": true", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        content.IndexOf("\"installedRustDesk\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        Process[] existing = Process.GetProcessesByName("rustdesk");
                        if (existing == null || existing.Length == 0)
                        {
                            string rustdeskExe = Path.Combine(appDir, "rustdesk", "rustdesk.exe");
                            if (File.Exists(rustdeskExe))
                            {
                                ProcessStartInfo psi = new ProcessStartInfo(rustdeskExe, "--service")
                                {
                                    WorkingDirectory = Path.GetDirectoryName(rustdeskExe),
                                    CreateNoWindow = true,
                                    UseShellExecute = false
                                };
                                Process.Start(psi);
                            }
                        }
                    }
                }
            }
            catch { }
        }

        private async void RestartNodeCore()
        {
            isNodeRestarting = true;
            try
            {
                TerminateManagedNode();
                await Task.Delay(600);
                StartOrSuperviseNode();
                await Task.Delay(1200);
                if (webView != null && webView.CoreWebView2 != null)
                {
                    BootstrapWebViewSession();
                }
            }
            finally
            {
                isNodeRestarting = false;
            }
        }

        private void TerminateManagedNode()
        {
            try
            {
                if (nodeProcess != null && !nodeProcess.HasExited)
                {
                    nodeProcess.Kill();
                    nodeProcess.WaitForExit(2000);
                    nodeProcess = null;
                }
            }
            catch { }
        }

        private void ShowPairingDialog()
        {
            RestoreWindow();

            // Read live pairing PIN from backend or data/trusted-devices.json
            string pin = "----";
            try
            {
                string trustedFile = Path.Combine(appDir, "data", "trusted-devices.json");
                if (File.Exists(trustedFile))
                {
                    string json = File.ReadAllText(trustedFile);
                    int pinIdx = json.IndexOf("\"pin\":");
                    if (pinIdx >= 0)
                    {
                        int startQuote = json.IndexOf("\"", pinIdx + 6);
                        if (startQuote >= 0)
                        {
                            int endQuote = json.IndexOf("\"", startQuote + 1);
                            if (endQuote > startQuote)
                            {
                                pin = json.Substring(startQuote + 1, endQuote - startQuote - 1);
                            }
                        }
                    }
                }
            }
            catch { }

            // Open pairing modal in webview or show prompt
            if (webView != null && webView.CoreWebView2 != null)
            {
                webView.CoreWebView2.ExecuteScriptAsync("if (window.aionOpenSecurity) window.aionOpenSecurity();");
            }
        }

        private void RestoreWindow()
        {
            this.Show();
            if (this.WindowState == FormWindowState.Minimized)
            {
                this.WindowState = FormWindowState.Normal;
            }
            this.BringToFront();
            SetForegroundWindow(this.Handle);
        }

        private void MainWindow_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (!isExiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
                if (trayIcon != null)
                {
                    trayIcon.ShowBalloonTip(1500, "AION", "AION is running in the background. Access it from the system tray.", ToolTipIcon.Info);
                }
            }
        }

        private void CleanupAll()
        {
            if (watchdogTimer != null)
            {
                watchdogTimer.Stop();
                watchdogTimer.Dispose();
            }
            TerminateManagedNode();
            if (jobObjectHandle != IntPtr.Zero)
            {
                try { CloseHandle(jobObjectHandle); } catch { }
                jobObjectHandle = IntPtr.Zero;
            }
        }

        private void ExitApplication()
        {
            isExiting = true;
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            CleanupAll();
            Application.Exit();
        }
    }

    /// <summary>
    /// Clean macOS/Windows dark-themed context menu renderer for System Tray
    /// </summary>
    internal class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColorTable()) { }
    }

    internal class DarkColorTable : ProfessionalColorTable
    {
        public override Color MenuBorder { get { return Color.FromArgb(40, 48, 65); } }
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(16, 22, 34); } }
        public override Color ImageMarginGradientBegin { get { return Color.FromArgb(16, 22, 34); } }
        public override Color ImageMarginGradientMiddle { get { return Color.FromArgb(16, 22, 34); } }
        public override Color ImageMarginGradientEnd { get { return Color.FromArgb(16, 22, 34); } }
        public override Color MenuItemSelected { get { return Color.FromArgb(32, 42, 60); } }
        public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(32, 42, 60); } }
        public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(32, 42, 60); } }
        public override Color MenuItemBorder { get { return Color.Transparent; } }
        public override Color SeparatorDark { get { return Color.FromArgb(35, 42, 55); } }
        public override Color SeparatorLight { get { return Color.Transparent; } }
    }
}
