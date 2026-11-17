using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace AION.Desktop
{
    public partial class MainWindow
    {
        private const string PrivateOrigin = "https://aion-private.invalid";
        private NativeIpcClient nativeIpc;
        private bool privateClosing;
        private readonly Dictionary<string, CancellationTokenSource> privateRequests = new Dictionary<string, CancellationTokenSource>();
        private readonly Dictionary<string, DateTime> earlyCancels = new Dictionary<string, DateTime>();
        private bool cancellationOverflow;
        internal static void TracePrivate(string id, string stage)
        {
            NativeIpcTrace.Write(id, stage);
        }

        private async Task InitializePrivateIpcAsync()
        {
            string host = Path.Combine(rootDir, "src", "native-host.js");
            if (!Path.IsPathRooted(nodePath) || !File.Exists(nodePath) || !File.Exists(host) || jobObjectHandle == IntPtr.Zero) throw new IOException("Secure host runtime unavailable");
            var psi = new ProcessStartInfo(nodePath, "\"" + host + "\"") {
                WorkingDirectory = rootDir, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            psi.EnvironmentVariables.Remove("AION_LOCAL_AUTH_SECRET");
            nodeProcess = Process.Start(psi);
            if (nodeProcess == null || !AssignProcessToJobObject(jobObjectHandle, nodeProcess.Handle)) { if (nodeProcess != null && !nodeProcess.HasExited) nodeProcess.Kill(); throw new IOException("Secure host process ownership unavailable"); }
            nodeProcess.EnableRaisingEvents = true;
            nodeProcess.Exited += (s,e) => { if (!privateClosing && !isExiting) { try { BeginInvoke(new Action(ShowPrivateDisconnected)); } catch { } } };
            nodeProcess.ErrorDataReceived += (s,e) => { if (Environment.GetEnvironmentVariable("AION_PRIVATE_IPC_DEV") == "1" && e.Data != null && e.Data.StartsWith("AION_TRACE ")) try { Console.Error.WriteLine(e.Data); } catch { } }; nodeProcess.BeginErrorReadLine();
            nativeIpc = new NativeIpcClient(nodeProcess.StandardOutput.BaseStream, nodeProcess.StandardInput.BaseStream);
            var bootstrap = await nativeIpc.CallAsync("desktop.bootstrap", null, 15000, CancellationToken.None);
            if (!(bootstrap["ok"] is bool) || !(bool)bootstrap["ok"]) throw new IOException("Secure host initialization failed");
            var state = bootstrap["result"] as Dictionary<string, object>;
            if (state == null || !(state["initialized"] is bool)) throw new IOException("Secure host initialization failed");
            if (!(bool)state["initialized"])
            {
                PutPrivateCookie("aion_bootstrap", (string)state["bootstrap"], true, 300);
                PutPrivateCookie("aion_csrf", (string)state["csrf"], false, 300);
            }
            webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("if (location.origin === 'https://aion-private.invalid') Object.defineProperty(window, '__aionNativeChat', {value:true, writable:false});");
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"(() => {
              if (window.top !== window || location.origin !== 'https://aion-private.invalid' || location.pathname !== '/') return;
              const original = window.fetch;
              window.fetch = function(input, init) {
                let request;
                try { request = new Request(input, init); } catch (error) { return Promise.reject(error); }
                const url = new URL(request.url);
                if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original.call(this, request);
                const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
                request.headers.set('X-AION-Request-ID', id);
                const signal = request.signal;
                const cancel = () => chrome.webview.postMessage({ channel: 'aion.http.cancel.v1', id });
                if (signal.aborted) return original.call(this, request);
                signal.addEventListener('abort', cancel, { once: true });
                return original.call(this, request).finally(() => signal.removeEventListener('abort', cancel));
              };
            })();");
            webView.CoreWebView2.WebMessageReceived += PrivateWebMessage;
            webView.CoreWebView2.WebResourceRequested += PrivateResourceRequested;
            webView.CoreWebView2.WebResourceResponseReceived += (s,e) => { try { if (e.Request.Headers.Contains("X-AION-Trace")) TracePrivate(e.Request.Headers.GetHeader("X-AION-Trace"), "webview_response_received"); } catch { } };
            webView.CoreWebView2.NavigationStarting += (s,e) => {
                StopChatBridge();
                CancelPrivateRequests();
                Uri uri; if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || uri.Scheme != "https" || uri.Host != "aion-private.invalid" || uri.Port != 443 || uri.AbsolutePath != "/" || !String.IsNullOrEmpty(uri.UserInfo)) e.Cancel = true;
            };
            webView.CoreWebView2.NewWindowRequested += (s,e) => e.Handled = true;
            webView.CoreWebView2.Navigate(PrivateOrigin + "/");
        }

        private void CancelPrivateRequests()
        {
            foreach (var request in privateRequests.Values) request.Cancel();
            earlyCancels.Clear();
            cancellationOverflow = false;
        }

        private void CancelPrivateRequest(string id)
        {
            CancellationTokenSource request;
            if (privateRequests.TryGetValue(id, out request)) { request.Cancel(); return; }
            var expired = new List<string>();
            foreach (var entry in earlyCancels) if (entry.Value < DateTime.UtcNow) expired.Add(entry.Key);
            foreach (var key in expired) earlyCancels.Remove(key);
            if (earlyCancels.Count < 256) earlyCancels[id] = DateTime.UtcNow.AddSeconds(20);
            else { foreach (var active in privateRequests.Values) active.Cancel(); cancellationOverflow = true; }
        }

        private void PutPrivateCookie(string name, string value, bool httpOnly, int maxAge)
        {
            if (name != "aion_session" && name != "aion_bootstrap" && name != "aion_csrf") throw new IOException("Invalid session cookie");
            if (value == null || value.Length > 256 || !Regex.IsMatch(value, "^[A-Za-z0-9_-]*$")) throw new IOException("Invalid session cookie");
            var manager = webView.CoreWebView2.CookieManager;
            if (maxAge <= 0) { manager.DeleteCookiesWithDomainAndPath(name, "aion-private.invalid", "/"); return; }
            var cookie = manager.CreateCookie(name, value, "aion-private.invalid", "/");
            cookie.IsHttpOnly = httpOnly; cookie.IsSecure = true; cookie.SameSite = CoreWebView2CookieSameSiteKind.Strict; cookie.Expires = DateTime.UtcNow.AddSeconds(Math.Min(maxAge, 1200));
            manager.AddOrUpdateCookie(cookie);
        }

        private async Task ApplyPrivateCookiesAsync(object value, string traceId)
        {
            var array = value as object[]; if (array == null) array = new object[] { value };
            var expected = new Dictionary<string, string>();
            foreach (object raw in array)
            {
                string text = raw as string; if (text == null || text.Length > 2048) throw new IOException("Invalid session cookie");
                string[] parts = text.Split(';'); int equal = parts[0].IndexOf('='); if (equal < 1) throw new IOException("Invalid session cookie");
                string name = parts[0].Substring(0, equal).Trim(), val = Uri.UnescapeDataString(parts[0].Substring(equal + 1)); int maxAge = 0; bool foundAge = false;
                foreach (string item in parts) { string part = item.Trim(); if (part.StartsWith("Max-Age=", StringComparison.OrdinalIgnoreCase)) foundAge = Int32.TryParse(part.Substring(8), out maxAge); }
                if (!foundAge) throw new IOException("Invalid session cookie");
                PutPrivateCookie(name, val, name != "aion_csrf", maxAge);
                TracePrivate(traceId, "cookie_set_" + name + (maxAge <= 0 ? "_remove" : "_add"));
                expected[name] = maxAge <= 0 ? null : val;
            }
            // Do not release the authentication response until WebView2's
            // cookie manager confirms the exact update. Never expose values.
            var clock = Stopwatch.StartNew();
            while (clock.ElapsedMilliseconds < 3000)
            {
                int remaining = Math.Max(1, 3000 - (int)clock.ElapsedMilliseconds);
                Task<List<CoreWebView2Cookie>> lookup = webView.CoreWebView2.CookieManager.GetCookiesAsync(PrivateOrigin + "/api/auth/status");
                if (await Task.WhenAny(lookup, Task.Delay(remaining)) != lookup) break;
                var observed = await lookup; bool matches = true;
                foreach (var pair in expected)
                {
                    CoreWebView2Cookie found = null;
                    foreach (var cookie in observed) if (cookie.Name == pair.Key) { if (found != null) throw new IOException("Ambiguous session cookie"); found = cookie; }
                    if (pair.Value == null ? found != null : found == null || found.Value != pair.Value || !found.IsSecure || found.IsHttpOnly != (pair.Key != "aion_csrf") || found.SameSite != CoreWebView2CookieSameSiteKind.Strict) matches = false;
                }
                if (matches) { TracePrivate(traceId, "cookie_updates_confirmed"); return; }
                await Task.Delay(25);
            }
            throw new IOException("Cookie update unavailable");
        }

        private CoreWebView2WebResourceResponse PrivateResponse(int status, Stream body, string headers)
        {
            return webView.CoreWebView2.Environment.CreateWebResourceResponse(body, status, status == 200 ? "OK" : "Unavailable", headers);
        }

        private async void PrivateResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var deferral = e.GetDeferral();
            string traceId = Guid.NewGuid().ToString("N");
            string browserId = null;
            CancellationTokenSource requestStop = null;
            try
            {
                Uri uri;
                if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri) || uri.Scheme != "https" || uri.Host != "aion-private.invalid" || uri.Port != 443 || !String.IsNullOrEmpty(uri.UserInfo)) { e.Response = PrivateResponse(403, new MemoryStream(), "Cache-Control: no-store\r\n"); return; }
                if (uri.AbsolutePath == "/api/logs" || uri.AbsolutePath == "/api/assistant/chat/stream") { e.Response = PrivateResponse(503, new MemoryStream(Encoding.UTF8.GetBytes("{\"status\":\"error\",\"error\":\"This stream requires the native bridge.\"}")), "Content-Type: application/json\r\nCache-Control: no-store\r\n"); return; }
                if (Environment.GetEnvironmentVariable("AION_PRIVATE_IPC_DEV") == "1" && Environment.GetEnvironmentVariable("AION_IPC_RESPONSE_PROBE") == "1" && uri.AbsolutePath == "/_dev/local-response" && e.Request.Method == "GET") { e.Request.Headers.SetHeader("X-AION-Trace", traceId); TracePrivate(traceId, "probe_local"); byte[] fixedBody = Encoding.UTF8.GetBytes("{\"probe\":\"fixed\"}"); e.Response = PrivateResponse(200, new TraceMemoryStream(fixedBody, traceId), "Content-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: " + fixedBody.Length + "\r\n"); return; }
                if (uri.AbsolutePath.StartsWith("/api/", StringComparison.Ordinal)) {
                    requestStop = new CancellationTokenSource();
                    if (e.Request.Headers.Contains("X-AION-Request-ID")) {
                        browserId = e.Request.Headers.GetHeader("X-AION-Request-ID");
                        if (cancellationOverflow || !Regex.IsMatch(browserId, "^[a-f0-9]{32}$") || privateRequests.ContainsKey(browserId) || privateRequests.Count >= 256) throw new IOException("Invalid request identifier");
                        privateRequests.Add(browserId, requestStop);
                        DateTime until; if (earlyCancels.TryGetValue(browserId, out until)) { earlyCancels.Remove(browserId); if (until >= DateTime.UtcNow) requestStop.Cancel(); }
                    }
                    if (Environment.GetEnvironmentVariable("AION_PRIVATE_IPC_DEV") == "1") e.Request.Headers.SetHeader("X-AION-Trace", traceId); string category = uri.AbsolutePath == "/api/auth/status" ? "intercept_auth_status" : uri.AbsolutePath == "/api/logs" ? "intercept_logs" : uri.AbsolutePath.StartsWith("/api/system/") ? "intercept_system" : uri.AbsolutePath.StartsWith("/api/network/") ? "intercept_network" : "intercept_api"; TracePrivate(traceId, category); TracePrivate(traceId, "intercept_thread_" + Thread.CurrentThread.ManagedThreadId); e.Response = await PrivateApiResponse(e, uri, traceId, requestStop.Token); return; }
                if (e.Request.Method != "GET") { e.Response = PrivateResponse(403, new MemoryStream(), "Cache-Control: no-store\r\n"); return; }
                e.Response = LoadPrivateAsset(uri);
            }
            catch { TracePrivate(traceId, "request_error"); e.Response = PrivateResponse(503, new MemoryStream(), "Cache-Control: no-store\r\n"); }
            finally { if (browserId != null && requestStop != null) { CancellationTokenSource current; if (privateRequests.TryGetValue(browserId, out current) && current == requestStop) privateRequests.Remove(browserId); } if (requestStop != null) requestStop.Dispose(); TracePrivate(traceId, "deferral_complete"); deferral.Complete(); }
        }

        private async Task<CoreWebView2WebResourceResponse> PrivateApiResponse(CoreWebView2WebResourceRequestedEventArgs e, Uri uri, string traceId, CancellationToken requestCancellation)
        {
            if (nativeIpc == null || nodeProcess == null || nodeProcess.HasExited) throw new IOException("Secure host unavailable");
            byte[] body = new byte[0];
            if (e.Request.Content != null)
            {
                using (var memory = new MemoryStream())
                {
                    byte[] buffer = new byte[4096]; int n;
                    while ((n = await e.Request.Content.ReadAsync(buffer, 0, buffer.Length)) != 0) { if (memory.Length + n > 32 * 1024) return PrivateResponse(413, new MemoryStream(), "Cache-Control: no-store\r\n"); memory.Write(buffer, 0, n); }
                    body = memory.ToArray();
                }
            }
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string name in new[] { "Accept", "Content-Type", "Origin", "X-AION-CSRF" }) if (e.Request.Headers.Contains(name)) headers[name.ToLowerInvariant()] = e.Request.Headers.GetHeader(name);
            if (e.Request.Headers.Contains("Cookie"))
            {
                string browserCookie = e.Request.Headers.GetHeader("Cookie");
                var cookieParts = new List<string> { browserCookie };
                TracePrivate(traceId, "cookie_lookup_start");
                var cookies = await webView.CoreWebView2.CookieManager.GetCookiesAsync(uri.AbsoluteUri);
                TracePrivate(traceId, "cookie_lookup_complete");
                foreach (var cookie in cookies)
                {
                    if (cookie.Name == "aion_session" || cookie.Name == "aion_bootstrap" || cookie.Name == "aion_csrf") TracePrivate(traceId, "cookie_lookup_" + cookie.Name);
                    if ((cookie.Name == "aion_session" || cookie.Name == "aion_bootstrap") && !Regex.IsMatch(browserCookie, @"(?:^|;\s*)" + Regex.Escape(cookie.Name) + "=")) cookieParts.Add(cookie.Name + "=" + cookie.Value);
                }
                headers["cookie"] = String.Join("; ", cookieParts.ToArray());
            }
            else TracePrivate(traceId, "cookie_lookup_skipped");
            TracePrivate(traceId, "ipc_dispatch_start");
            var responseClock = Stopwatch.StartNew();
            var reply = await nativeIpc.CallAsync("http.open", new { method = e.Request.Method, path = uri.PathAndQuery, headers = headers, body = Convert.ToBase64String(body) }, 20000, requestCancellation, traceId);
            TracePrivate(traceId, "ipc_headers_received");
            if (!(bool)reply["ok"]) throw new IOException("Secure request unavailable");
            var result = reply["result"] as Dictionary<string, object>; var responseHeaders = result["headers"] as Dictionary<string, object>;
            if (result == null || responseHeaders == null || !(result["status"] is int) || !(result["id"] is string)) throw new IOException("Invalid secure response");
            object setCookies; if (responseHeaders.TryGetValue("set-cookie", out setCookies)) { TracePrivate(traceId, "cookie_commit_start"); await ApplyPrivateCookiesAsync(setCookies, traceId); TracePrivate(traceId, "cookie_commit_confirmed"); }
            var output = new StringBuilder("Cache-Control: no-store\r\n");
            if (Environment.GetEnvironmentVariable("AION_PRIVATE_IPC_DEV") == "1")
            {
                string forwarded; bool hasCookie = headers.TryGetValue("cookie", out forwarded);
                string names = hasCookie ? String.Join(",", Array.FindAll(new[] { "aion_bootstrap", "aion_csrf", "aion_session" }, name => Regex.IsMatch(forwarded, @"(?:^|;\s*)" + Regex.Escape(name) + "="))) : "none";
                output.Append("X-AION-Debug-Request: ").Append(traceId).Append("; browser-cookie=").Append(e.Request.Headers.Contains("Cookie") ? "present" : "absent").Append("; forwarded-names=").Append(names).Append("; status=").Append(result["status"]).Append("\r\n");
            }
            foreach (string name in new[] { "content-type", "x-accel-buffering" }) { object value; if (responseHeaders.TryGetValue(name, out value) && value is string && !((string)value).Contains("\r") && !((string)value).Contains("\n")) output.Append(name).Append(": ").Append(value).Append("\r\n"); }
            // WebView2 can block consumption of an intercepted live response.
            // Complete ordinary API bodies over IPC before returning them to it.
            const int responseLimit = 1024 * 1024;
            object done;
            bool complete = result.TryGetValue("done", out done) && done is bool && (bool)done;
            string responseId = (string)result["id"];
            byte[] bytes;
            using (var memory = new MemoryStream())
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(requestCancellation))
            {
                deadline.CancelAfter(Math.Max(1, 20000 - (int)Math.Min(20000, responseClock.ElapsedMilliseconds)));
                Exception failure = null;
                try
                {
                    while (true)
                    {
                        deadline.Token.ThrowIfCancellationRequested();
                        if (complete)
                        {
                            if (!(result["data"] is string)) throw new IOException("Invalid secure response");
                            byte[] initial = Convert.FromBase64String((string)result["data"]);
                            if (memory.Length + initial.Length > responseLimit) throw new IOException("Secure response exceeds limit");
                            memory.Write(initial, 0, initial.Length);
                            break;
                        }
                        var read = await nativeIpc.CallAsync("http.read", new { id = responseId }, 3000, deadline.Token);
                        var partResult = read.ContainsKey("result") ? read["result"] as Dictionary<string, object> : null;
                        if (!(bool)read["ok"] || partResult == null || !(partResult["done"] is bool) || !(partResult["data"] is string)) throw new IOException("Invalid secure response");
                        byte[] part = Convert.FromBase64String((string)partResult["data"]);
                        if (memory.Length + part.Length > responseLimit) throw new IOException("Secure response exceeds limit");
                        memory.Write(part, 0, part.Length);
                        if ((bool)partResult["done"]) { complete = true; break; }
                    }
                }
                catch (Exception error) { failure = error; }
                if (!complete && nativeIpc != null) { try { await nativeIpc.CallAsync("http.cancel", new { id = responseId }, 3000, CancellationToken.None); } catch { } }
                if (failure != null) throw new IOException("Secure response unavailable", failure);
                bytes = memory.ToArray();
            }
            TracePrivate(traceId, "buffered_response");
            return PrivateResponse((int)result["status"], new TraceMemoryStream(bytes, traceId), output.ToString());
        }

        private CoreWebView2WebResourceResponse LoadPrivateAsset(Uri uri)
        {
            if (Environment.GetEnvironmentVariable("AION_PRIVATE_IPC_DEV") == "1" && Environment.GetEnvironmentVariable("AION_IPC_RESPONSE_PROBE") == "1" && uri.AbsolutePath == "/") return PrivateResponse(200, new MemoryStream(Encoding.UTF8.GetBytes("<!doctype html><link rel=icon href='data:,'><title>IPC response probe</title>")), "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n");
            string entryName = uri.AbsolutePath == "/" ? "index.html" : Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
            if (entryName.Length > 512 || entryName.Contains("..") || entryName.Contains("\\") || entryName.Contains(":")) return PrivateResponse(403, new MemoryStream(), "Cache-Control: no-store\r\n");
            if (entryName == "sw.js") return PrivateResponse(403, new MemoryStream(), "Cache-Control: no-store\r\n");
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("AION.PrivateAssets"))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                var entry = archive.GetEntry(entryName) ?? archive.GetEntry(entryName.Replace('/', '\\')); if (entry == null || entry.Length > 4 * 1024 * 1024) return PrivateResponse(404, new MemoryStream(), "Cache-Control: no-store\r\n");
                using (var file = entry.Open()) using (var memory = new MemoryStream())
                {
                    file.CopyTo(memory); byte[] bytes = memory.ToArray(); string ext = Path.GetExtension(entryName).ToLowerInvariant();
                    string type = ext == ".html" ? "text/html; charset=utf-8" : ext == ".js" ? "text/javascript; charset=utf-8" : ext == ".css" ? "text/css; charset=utf-8" : ext == ".svg" ? "image/svg+xml" : ext == ".png" ? "image/png" : "application/octet-stream";
                    string policy = "";
                    if (entryName == "index.html")
                    {
                        string html = Encoding.UTF8.GetString(bytes);
                        html = Regex.Replace(html, "<link\\s+rel=\"(?:shortcut )?icon\"[^>]*>", "", RegexOptions.IgnoreCase);
                        html = Regex.Replace(html, "<link\\s+rel=\"preconnect\"[^>]*>", "", RegexOptions.IgnoreCase);
                        html = Regex.Replace(html, "<link\\s+href=\"https://fonts\\.googleapis\\.com/[^>]*>", "", RegexOptions.IgnoreCase);
                        html = html.Replace("</head>", "<link rel=\"icon\" href=\"data:,\"></head>"); bytes = Encoding.UTF8.GetBytes(html);
                        policy = "Content-Security-Policy: default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'\r\n";
                    }
                    return PrivateResponse(200, new MemoryStream(bytes), "Content-Type: " + type + "\r\nCache-Control: no-store\r\n" + policy);
                }
            }
        }

        private void ShowPrivateDisconnected()
        {
            CancelPrivateRequests();
            if (chatBridge != null) SendChatEvent(chatBridge, "error", "The secure host disconnected.");
            StopChatBridge();
            if (webView != null && webView.CoreWebView2 != null) webView.CoreWebView2.ExecuteScriptAsync("document.body.replaceChildren(); const p=document.createElement('p'); p.textContent='AION secure host disconnected. Restart AION to reconnect.'; p.style.cssText='padding:3rem;font:18px sans-serif;color:white;background:#101216'; document.body.append(p);");
        }
        private void StopPrivateIpc()
        {
            CancelPrivateRequests();
            StopChatBridge();
            privateClosing = true; if (nativeIpc != null) { nativeIpc.Dispose(); nativeIpc = null; }
            TerminateManagedNode();
        }
    }
}
