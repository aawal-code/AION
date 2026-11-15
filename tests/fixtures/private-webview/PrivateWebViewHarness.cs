using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

// Standalone acceptance harness, never included in the production build.
internal sealed class PrivateWebViewHarness : Form
{
    private const string Page = "https://aion-private.invalid/index.html";
    private readonly string root, backendFile, node, profile, db;
    private readonly int probePort;
    private readonly bool simulateDisconnect;
    private readonly bool simulateCrash;
    private readonly WebView2 view = new WebView2();
    private Process backend;
    private readonly SemaphoreSlim ipc = new SemaphoreSlim(1, 1);
    private bool authenticatedOperation, disconnected;

    private PrivateWebViewHarness(string[] args)
    {
        root = Path.GetFullPath(args[0]); backendFile = Path.GetFullPath(args[1]); node = args[2]; profile = args[3]; db = args[4]; probePort = Int32.Parse(args[5]); simulateDisconnect = args[6] == "disconnect"; simulateCrash = args[6] == "crash";
        ShowInTaskbar = false; Opacity = 0; SetBounds(-20000, -20000, 800, 600);
        view.Dock = DockStyle.Fill; Controls.Add(view);
        var timeout = new System.Windows.Forms.Timer(); timeout.Interval = 20000;
        timeout.Tick += (s, e) => { Console.Error.WriteLine("TIMEOUT"); Environment.Exit(4); }; timeout.Start();
        Shown += async (s, e) => await Run();
        FormClosed += (s, e) => { try { if (backend != null && !backend.HasExited) backend.Kill(); } catch { } };
    }

    private async Task Run()
    {
        try
        {
            var psi = new ProcessStartInfo(node, "\"" + backendFile + "\"") {
                WorkingDirectory = Path.GetDirectoryName(root), UseShellExecute = false, CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardInput = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            psi.EnvironmentVariables["AION_SECURITY_DB_PATH"] = db;
            if (simulateDisconnect) psi.EnvironmentVariables["AION_SLICE_KEEP_ON_DISCONNECT"] = "1";
            backend = Process.Start(psi);
            Console.WriteLine("BACKEND_PID " + backend.Id);
            Task<string> ready = backend.StandardOutput.ReadLineAsync();
            if (await Task.WhenAny(ready, Task.Delay(10000)) != ready || await ready != "READY") throw new Exception("Backend unavailable");
            var env = await CoreWebView2Environment.CreateAsync(null, profile);
            await view.EnsureCoreWebView2Async(env);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            view.CoreWebView2.WebResourceRequested += Resource;
            view.CoreWebView2.NavigationStarting += (s, e) => { if (e.Uri != Page) e.Cancel = true; };
            view.CoreWebView2.NewWindowRequested += (s, e) => e.Handled = true;
            view.CoreWebView2.WebMessageReceived += OnMessage;
            view.CoreWebView2.NavigationCompleted += async (s, e) => {
                if (!e.IsSuccess) { Console.Error.WriteLine("NAVIGATION_FAILED " + e.WebErrorStatus); Close(); return; }
                string script = @"(() => {
                    if (!document.getElementById('homeTitle')) return;
                    window.chrome.webview.addEventListener('message', e => {
                        if (e.data === 'RETRY') fetch('/api/auth/devices').then(r => {
                            if (r.status === 503) window.chrome.webview.postMessage('RESULT_CLOSED');
                        });
                    });
                    fetch('http://127.0.0.1:PORT/probe').catch(() => {});
                    const worker = new Worker(URL.createObjectURL(new Blob([`fetch('http://127.0.0.1:PORT/worker').finally(() => postMessage('done'))`], {type:'text/javascript'})));
                    setTimeout(() => fetch('http://127.0.0.1:PORT/after-close').catch(() => {}), 1500);
                    Promise.all([new Promise(resolve => { worker.onmessage = resolve; }), fetch('/api/auth/devices').then(r => r.json()),
                        fetch('/api/auth/recovery/rotate', {method:'POST', body:'{}'}).then(r => r.status)]).then(([_worker, value, status]) => {
                        if (status === 403 && value.status === 'ok' && value.devices.some(d => d.role === 'owner')) window.chrome.webview.postMessage('RESULT_OK');
                    });
                })();".Replace("PORT", probePort.ToString());
                await view.CoreWebView2.ExecuteScriptAsync(script);
            };
            view.CoreWebView2.Navigate(Page);
        }
        catch (Exception ex) { Console.Error.WriteLine("HARNESS_ERROR " + ex.GetType().Name + " " + ex.Message); Close(); }
    }

    private async void Resource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (e.Request.Uri == "https://aion-private.invalid/api/auth/devices" && e.Request.Method == "GET")
        {
            var deferral = e.GetDeferral();
            try
            {
                await ipc.WaitAsync();
                try
                {
                    if (backend == null || backend.HasExited) throw new Exception("Backend unavailable");
                    await backend.StandardInput.WriteLineAsync("LIST"); await backend.StandardInput.FlushAsync();
                    Task<string> result = backend.StandardOutput.ReadLineAsync();
                    if (await Task.WhenAny(result, Task.Delay(5000)) != result) throw new Exception("IPC timeout");
                    string json = await result;
                    if (backend.HasExited || json == null || json.Length > 65536 || !json.StartsWith("{\"status\":\"ok\"")) throw new Exception("IPC failure");
                    authenticatedOperation = true;
                    e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(json)), 200, "OK", "Content-Type: application/json\r\nCache-Control: no-store\r\n");
                }
                finally { ipc.Release(); }
            }
            catch { e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 503, "Unavailable", "Cache-Control: no-store\r\n"); }
            finally { deferral.Complete(); }
            return;
        }
        try
        {
            Uri uri = new Uri(e.Request.Uri);
            string relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(root, relative));
            if (uri.Scheme == "https" && uri.Host == "aion-private.invalid" && uri.Port == 443 && e.Request.Method == "GET" && full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
            {
                string ext = Path.GetExtension(full).ToLowerInvariant();
                string type = ext == ".html" ? "text/html" : ext == ".js" ? "text/javascript" : ext == ".css" ? "text/css" : ext == ".svg" ? "image/svg+xml" : "application/octet-stream";
                e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(full)), 200, "OK", "Content-Type: " + type + "\r\nCache-Control: no-store\r\n"); return;
            }
        }
        catch { }
        if (e.Request.Uri.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase)) Console.WriteLine("NETWORK_BLOCKED");
        e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 403, "Blocked", "Cache-Control: no-store\r\n");
    }

    private async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != Page) return;
        string message; try { message = e.TryGetWebMessageAsString(); } catch { return; }
        if (message == "RESULT_OK" && authenticatedOperation)
        {
            Console.WriteLine("WEBVIEW_OWNER_OK"); Console.WriteLine("WEBVIEW_MUTATION_BLOCKED");
            if (simulateCrash) { await Task.Delay(700); Process.GetCurrentProcess().Kill(); return; }
            if (simulateDisconnect) {
                backend.StandardInput.Close(); await Task.Delay(700);
                if (backend.HasExited) { Console.Error.WriteLine("BACKEND_DID_NOT_REMAIN_ALIVE"); Close(); return; }
                Console.WriteLine("BACKEND_ALIVE");
            } else { backend.Kill(); backend.WaitForExit(3000); await Task.Delay(700); }
            view.CoreWebView2.PostWebMessageAsString("RETRY");
        }
        else if (message == "RESULT_CLOSED" && authenticatedOperation)
        {
            disconnected = true; Console.WriteLine("WEBVIEW_DISCONNECTED"); Close();
        }
    }

    [STAThread] private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        using (var app = new PrivateWebViewHarness(args)) { Application.Run(app); return app.authenticatedOperation && app.disconnected ? 0 : 1; }
    }
}
