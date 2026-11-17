using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;

namespace AION.Desktop
{
    public partial class MainWindow
    {
        private sealed class ChatBridgeState { public string id, backendId; public int sequence; public CancellationTokenSource stop = new CancellationTokenSource(); public TaskCompletionSource<bool> ack; }
        private ChatBridgeState chatBridge;
        private readonly JavaScriptSerializer bridgeJson = new JavaScriptSerializer { MaxJsonLength = 48 * 1024, RecursionLimit = 12 };

        private void SendChatEvent(ChatBridgeState stream, string type, object data = null)
        {
            if (chatBridge != stream || privateClosing || webView == null || webView.CoreWebView2 == null) return;
            webView.CoreWebView2.PostWebMessageAsJson(bridgeJson.Serialize(new { channel = "aion.chat.v1", id = stream.id, type, sequence = stream.sequence, data }));
        }
        private void StopChatBridge()
        {
            var current = chatBridge; if (current == null) return;
            chatBridge = null; current.stop.Cancel(); if (current.ack != null) current.ack.TrySetCanceled();
            if (current.backendId != null && nativeIpc != null) { var client = nativeIpc; string id = current.backendId; Task.Run(async () => { try { await client.CallAsync("http.cancel", new { id }, 3000, CancellationToken.None); } catch { } }); }
        }
        private async void PrivateWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (e.Source != PrivateOrigin + "/" || webView.Source == null || webView.Source.AbsoluteUri != PrivateOrigin + "/") return;
            Dictionary<string, object> message;
            try { if (e.WebMessageAsJson.Length > 48 * 1024) return; message = bridgeJson.DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>; } catch { return; }
            if (message != null && message.Count == 2 && message.ContainsKey("channel") && Equals(message["channel"], "aion.http.cancel.v1") && message.ContainsKey("id")) {
                string cancelId = message["id"] as string;
                if (cancelId != null && Regex.IsMatch(cancelId, "^[a-f0-9]{32}$")) CancelPrivateRequest(cancelId);
                return;
            }
            if (message == null || !message.ContainsKey("channel") || !Equals(message["channel"], "aion.chat.v1") || !message.ContainsKey("type") || !message.ContainsKey("id")) return;
            string id = message["id"] as string, type = message["type"] as string;
            if (id == null || !Regex.IsMatch(id, "^[a-f0-9]{32}$")) return;
            if (type == "cancel") { if (message.Count == 3 && chatBridge != null && chatBridge.id == id) StopChatBridge(); return; }
            if (type == "ack") { if (message.Count == 4 && chatBridge != null && chatBridge.id == id && message.ContainsKey("sequence") && message["sequence"] is int && (int)message["sequence"] == chatBridge.sequence && chatBridge.ack != null) chatBridge.ack.TrySetResult(true); return; }
            if (type != "start" || message.Count != 5 || !message.ContainsKey("body") || !message.ContainsKey("csrf") || chatBridge != null) return;
            string body = message["body"] as string, csrf = message["csrf"] as string;
            if (body == null || Encoding.UTF8.GetByteCount(body) > 32 * 1024 || csrf == null || !Regex.IsMatch(csrf, "^[A-Za-z0-9_-]{32,128}$")) return;
            var current = new ChatBridgeState { id = id }; chatBridge = current;
            try
            {
                if (nativeIpc == null || nodeProcess == null || nodeProcess.HasExited) throw new Exception();
                var cookies = await webView.CoreWebView2.CookieManager.GetCookiesAsync(PrivateOrigin + "/api/assistant/chat/stream");
                string session = null, csrfCookie = null;
                foreach (var cookie in cookies) {
                    if (cookie.Name == "aion_session" && cookie.IsHttpOnly && cookie.IsSecure && cookie.SameSite == CoreWebView2CookieSameSiteKind.Strict) { if (session != null) throw new Exception(); session = cookie.Value; }
                    if (cookie.Name == "aion_csrf" && !cookie.IsHttpOnly && cookie.IsSecure && cookie.SameSite == CoreWebView2CookieSameSiteKind.Strict) { if (csrfCookie != null) throw new Exception(); csrfCookie = cookie.Value; }
                }
                if (current.stop.IsCancellationRequested || session == null || csrfCookie == null || csrfCookie != csrf || !Regex.IsMatch(session, "^[A-Za-z0-9_-]{32,128}$")) throw new Exception();
                var headers = new Dictionary<string, string> { { "cookie", "aion_session=" + session + "; aion_csrf=" + csrfCookie }, { "origin", PrivateOrigin }, { "x-aion-csrf", csrf }, { "content-type", "application/json" } };
                current.backendId = current.id;
                var opened = await nativeIpc.CallAsync("http.open", new { method = "POST", path = "/api/assistant/chat/stream", headers, body = Convert.ToBase64String(Encoding.UTF8.GetBytes(body)) }, 30000, current.stop.Token, current.id);
                if (current.stop.IsCancellationRequested || !(bool)opened["ok"]) throw new Exception();
                var result = opened["result"] as Dictionary<string, object>; if (result == null || !(result["status"] is int) || !(result["id"] is string)) throw new Exception();
                current.backendId = (string)result["id"];
                if ((int)result["status"] != 200) {
                    string publicError = "The selected AI provider is unavailable or not configured.";
                    try { if (result.ContainsKey("done") && (bool)result["done"]) { var failure = bridgeJson.DeserializeObject(Encoding.UTF8.GetString(Convert.FromBase64String((string)result["data"]))) as Dictionary<string, object>; if (failure != null && failure.ContainsKey("error") && failure["error"] is string && ((string)failure["error"]).Length <= 256) publicError = (string)failure["error"]; } } catch { }
                    SendChatEvent(current, "error", publicError); return;
                }
                SendChatEvent(current, "start");
                if (result.ContainsKey("done") && (bool)result["done"]) { string data = (string)result["data"]; if (!String.IsNullOrEmpty(data)) { current.sequence++; SendChatEvent(current, "chunk", data); } SendChatEvent(current, "end"); return; }
                while (!current.stop.IsCancellationRequested)
                {
                    var read = await nativeIpc.CallAsync("http.read", new { id = current.backendId }, 5000, current.stop.Token);
                    if (!(bool)read["ok"]) throw new Exception(); var part = read["result"] as Dictionary<string, object>;
                    if (part == null || !(part["done"] is bool) || !(part["data"] is string)) throw new Exception();
                    if ((bool)part["done"]) { SendChatEvent(current, "end"); return; }
                    string data = (string)part["data"]; if (data.Length == 0) continue;
                    if (data.Length > 32768) throw new Exception(); current.sequence++; current.ack = new TaskCompletionSource<bool>(); SendChatEvent(current, "chunk", data);
                    if (await Task.WhenAny(current.ack.Task, Task.Delay(30000, current.stop.Token)) != current.ack.Task) throw new Exception();
                    await current.ack.Task; current.ack = null;
                }
            }
            catch { if (!current.stop.IsCancellationRequested) SendChatEvent(current, "error", "The secure stream was interrupted or not authorized."); }
            finally { if (chatBridge == current) StopChatBridge(); }
        }
    }
}
