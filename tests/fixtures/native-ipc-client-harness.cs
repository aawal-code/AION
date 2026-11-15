using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AION.Desktop;

internal static class NativeIpcClientHarness
{
    private static async Task Run(string node, string script)
    {
        foreach (byte[] invalid in new[] { new byte[] { 0, 1, 0, 1 }, WrongId() })
        {
            bool rejectedInvalid = false;
            using (var client = new NativeIpcClient(new MemoryStream(invalid), new MemoryStream()))
            {
                try { await client.CallAsync("echo", null, 1000, CancellationToken.None); }
                catch (InvalidDataException) { rejectedInvalid = true; }
            }
            if (!rejectedInvalid) throw new Exception("invalid response accepted");
        }
        var info = new ProcessStartInfo(node, "\"" + script + "\"") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using (var child = Process.Start(info))
        using (var client = new NativeIpcClient(child.StandardOutput.BaseStream, child.StandardInput.BaseStream))
        {
            try
            {
                var first = await client.CallAsync("echo", "hello", 3000, CancellationToken.None);
                if (!(bool)first["ok"] || (string)first["result"] != "hello") throw new Exception("echo failed");
                using (var cancel = new CancellationTokenSource())
                {
                    cancel.CancelAfter(50);
                    var result = await client.CallAsync("wait", null, 3000, cancel.Token);
                    if ((bool)result["ok"] || (string)result["error"] != "cancelled") throw new Exception("cancellation failed");
                }
                bool timedOut = false;
                try { await client.CallAsync("wait", null, 80, CancellationToken.None); }
                catch (TimeoutException) { timedOut = true; }
                if (!timedOut) throw new Exception("deadline failed");
                bool rejected = false;
                try { await client.CallAsync("echo", "later", 1000, CancellationToken.None); }
                catch (System.IO.IOException) { rejected = true; }
                if (!rejected) throw new Exception("closed channel accepted request");
                Console.WriteLine("CLIENT_OK");
            }
            finally { if (!child.HasExited) { child.Kill(); child.WaitForExit(3000); } }
        }
    }
    private static byte[] WrongId()
    {
        byte[] body = Encoding.UTF8.GetBytes("{\"type\":\"response\",\"id\":\"other\",\"ok\":true}");
        byte[] frame = new byte[body.Length + 4]; frame[3] = (byte)body.Length; Buffer.BlockCopy(body, 0, frame, 4, body.Length); return frame;
    }
    private static int Main(string[] args) { try { Run(args[0], args[1]).GetAwaiter().GetResult(); return 0; } catch (Exception ex) { Console.Error.WriteLine(ex); return 1; } }
}
