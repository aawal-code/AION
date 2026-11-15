using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

// Test-only: verifies WebView origin-bound key continuity; does not migrate an Owner.
internal sealed class OriginKeyHarness : Form
{
    private readonly WebView2 view = new WebView2();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly string profile, legacy, current = "https://aion-private.invalid/index.html", mode;
    private bool succeeded;
    private const string Helpers = @"
        const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a)));
        const openDb = () => new Promise((resolve,reject) => {
          const request = indexedDB.open('aion-security-keys',1);
          request.onupgradeneeded = () => request.result.createObjectStore('keys');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const readKey = db => new Promise((resolve,reject) => { const r=db.transaction('keys','readonly').objectStore('keys').get('owner'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
        const writeKey = (db,key) => new Promise((resolve,reject) => { const t=db.transaction('keys','readwrite'); t.objectStore('keys').put(key,'owner'); t.oncomplete=resolve; t.onerror=()=>reject(t.error); });
        const publicKey = async pair => b64(await crypto.subtle.exportKey('spki',pair.publicKey));
        const sign = async (pair,statement) => b64(await crypto.subtle.sign({name:'Ed25519'},pair.privateKey,new TextEncoder().encode(statement)));
    ";

    private OriginKeyHarness(string[] args)
    {
        profile = args[0]; legacy = "http://localhost:" + args[1] + "/index.html"; mode = args[2];
        ShowInTaskbar = false; Opacity = 0; SetBounds(-20000, -20000, 800, 600); view.Dock = DockStyle.Fill; Controls.Add(view);
        var timeout = new Timer { Interval = 20000 }; timeout.Tick += (s,e) => { Console.Error.WriteLine("TIMEOUT"); Environment.Exit(4); }; timeout.Start();
        Shown += async (s,e) => await Run();
    }

    private async Task Navigate(string uri)
    {
        var completion = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = null;
        handler = (s,e) => { view.CoreWebView2.NavigationCompleted -= handler; completion.TrySetResult(e.IsSuccess); };
        view.CoreWebView2.NavigationCompleted += handler; view.CoreWebView2.Navigate(uri);
        if (!await completion.Task) throw new Exception("Navigation failed");
    }
    private async Task<System.Collections.Generic.Dictionary<string, object>> Evaluate(string body)
    {
        var completion = new TaskCompletionSource<string>();
        EventHandler<CoreWebView2WebMessageReceivedEventArgs> handler = null;
        handler = (s,e) => { if (e.Source == view.Source.ToString()) { try { completion.TrySetResult(e.TryGetWebMessageAsString()); } catch { } } };
        view.CoreWebView2.WebMessageReceived += handler;
        try
        {
            await view.CoreWebView2.ExecuteScriptAsync("(async()=>{try{const value=await (async()=>{" + Helpers + body + "})();chrome.webview.postMessage(JSON.stringify({ok:true,value}));}catch(e){chrome.webview.postMessage(JSON.stringify({ok:false,error:String(e)}));}})()");
            string result = await completion.Task;
            var envelope = json.DeserializeObject(result) as System.Collections.Generic.Dictionary<string, object>;
            if (envelope == null || !envelope.ContainsKey("ok") || !(bool)envelope["ok"]) throw new Exception("Script failed: " + result);
            var value = envelope["value"] as System.Collections.Generic.Dictionary<string, object>;
            if (value == null || !value.ContainsKey("publicKey")) throw new Exception("Invalid script result");
            return value;
        }
        finally { view.CoreWebView2.WebMessageReceived -= handler; }
    }
    private async Task Run()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, profile); await view.EnsureCoreWebView2Async(env);
            view.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            view.CoreWebView2.WebResourceRequested += (s,e) => {
                bool page = e.Request.Method == "GET" && (e.Request.Uri == legacy || e.Request.Uri == current);
                byte[] body = Encoding.UTF8.GetBytes(page ? "<!doctype html><link rel=icon href='data:,'><title>AION isolated key test</title>" : "");
                e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(body), page ? 200 : 403, page ? "OK" : "Blocked", "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; img-src data:\r\n");
            };
            view.CoreWebView2.NavigationStarting += (s,e) => { if (e.Uri != legacy && e.Uri != current) e.Cancel = true; };
            view.CoreWebView2.NewWindowRequested += (s,e) => e.Handled = true;
            await Navigate(legacy);
            string keyBody = mode == "seed"
                ? "document.cookie='aion_session=synthetic-isolated-test; SameSite=Strict; Path=/';const db=await openDb();let p=await readKey(db);if(!p){p=await crypto.subtle.generateKey({name:'Ed25519'},false,['sign','verify']);await writeKey(db,p);}return {publicKey:await publicKey(p),extractable:p.privateKey.extractable,cookiePresent:document.cookie.includes('aion_session=synthetic-isolated-test')};"
                : "const db=await openDb();const p=await readKey(db);if(!p)throw Error('Legacy key missing');return {publicKey:await publicKey(p),extractable:p.privateKey.extractable};";
            var old = await Evaluate(keyBody);
            if (mode == "seed") { Console.WriteLine(json.Serialize(old)); succeeded = true; Close(); return; }
            string oldPublic = (string)old["publicKey"];
            await Navigate(current);
            string oldLiteral = json.Serialize(oldPublic);
            var next = await Evaluate("const db=await openDb();const prior=await readKey(db);if(prior)throw Error('New origin unexpectedly has legacy key');const p=await crypto.subtle.generateKey({name:'Ed25519'},false,['sign','verify']);await writeKey(db,p);const pub=await publicKey(p);const statement='AION-TEST-MIGRATION:'+" + oldLiteral + "+':'+pub;return {publicKey:pub,proof:await sign(p,statement),extractable:p.privateKey.extractable};");
            string nextPublic = (string)next["publicKey"];
            await Navigate(legacy);
            var proof = await Evaluate("const db=await openDb();const p=await readKey(db);const statement='AION-TEST-MIGRATION:'+" + oldLiteral + "+':'+" + json.Serialize(nextPublic) + ";return {publicKey:await publicKey(p),proof:await sign(p,statement),extractable:p.privateKey.extractable};");
            Console.WriteLine(json.Serialize(new { old = old, next = next, proof = proof })); succeeded = true; Close();
        }
        catch (Exception ex) { Console.Error.WriteLine("KEY_TEST_ERROR " + ex.GetType().Name + " " + ex.Message); Close(); }
    }
    [STAThread] private static int Main(string[] args) { Application.EnableVisualStyles(); using (var app = new OriginKeyHarness(args)) { Application.Run(app); return app.succeeded ? 0 : 1; } }
}
