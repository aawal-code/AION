using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace AION.Desktop
{
    // Framing only. The caller owns the launched child and enforces all
    // authentication, authorization, origin and process lifetime policies.
    internal sealed class NativeIpcClient : IDisposable
    {
        private const int FrameLimit = 64 * 1024;
        private readonly Stream input, output;
        private readonly SemaphoreSlim callGate = new SemaphoreSlim(1, 1), writeGate = new SemaphoreSlim(1, 1);
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = FrameLimit, RecursionLimit = 32 };
        private readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
        private volatile bool closed;

        public NativeIpcClient(Stream input, Stream output) { this.input = input; this.output = output; }

        private async Task WriteFrame(object value)
        {
            string encoded; lock (json) { encoded = json.Serialize(value); }
            byte[] bytes = utf8.GetBytes(encoded);
            if (bytes.Length == 0 || bytes.Length > FrameLimit) throw new InvalidDataException("IPC frame size invalid");
            byte[] frame = new byte[bytes.Length + 4];
            frame[0] = (byte)(bytes.Length >> 24); frame[1] = (byte)(bytes.Length >> 16); frame[2] = (byte)(bytes.Length >> 8); frame[3] = (byte)bytes.Length;
            Buffer.BlockCopy(bytes, 0, frame, 4, bytes.Length);
            await writeGate.WaitAsync();
            try { if (closed) throw new IOException("IPC closed"); await output.WriteAsync(frame, 0, frame.Length); await output.FlushAsync(); }
            finally { writeGate.Release(); }
        }

        private async Task ReadExactly(byte[] buffer)
        {
            int used = 0;
            while (used < buffer.Length) { int n = await input.ReadAsync(buffer, used, buffer.Length - used); if (n == 0) throw new EndOfStreamException(); used += n; }
        }

        private async Task<Dictionary<string, object>> ReadResponse(string id)
        {
            byte[] header = new byte[4]; await ReadExactly(header);
            uint length = ((uint)header[0] << 24) | ((uint)header[1] << 16) | ((uint)header[2] << 8) | header[3];
            if (length == 0 || length > FrameLimit) throw new InvalidDataException("IPC response size invalid");
            byte[] bytes = new byte[length]; await ReadExactly(bytes);
            Dictionary<string, object> value; lock (json) { value = json.DeserializeObject(utf8.GetString(bytes)) as Dictionary<string, object>; }
            if (value == null || !value.ContainsKey("type") || !value.ContainsKey("id") || !value.ContainsKey("ok") || !Equals(value["type"], "response") || !Equals(value["id"], id) || !(value["ok"] is bool)) throw new InvalidDataException("IPC response invalid");
            return value;
        }

        public async Task<Dictionary<string, object>> CallAsync(string method, object payload, int timeoutMs, CancellationToken cancellation)
        {
            if (timeoutMs < 1 || timeoutMs > 300000) throw new ArgumentOutOfRangeException("timeoutMs");
            await callGate.WaitAsync(cancellation);
            try
            {
                if (closed) throw new IOException("IPC closed");
                cancellation.ThrowIfCancellationRequested();
                string id = Guid.NewGuid().ToString("N");
                using (var deadline = new CancellationTokenSource())
                {
                    Task<Dictionary<string, object>> operation = CallCore(id, method, payload, cancellation);
                    if (await Task.WhenAny(operation, Task.Delay(timeoutMs, deadline.Token)) != operation) { Dispose(); throw new TimeoutException("IPC deadline exceeded"); }
                    deadline.Cancel();
                    try { return await operation; } catch { Dispose(); throw; }
                }
            }
            finally { callGate.Release(); }
        }

        private async Task<Dictionary<string, object>> CallCore(string id, string method, object payload, CancellationToken cancellation)
        {
            await WriteFrame(new { type = "request", id = id, method = method, payload = payload });
            using (cancellation.Register(() => { Task.Run(async () => { try { await WriteFrame(new { type = "cancel", id = id }); } catch { Dispose(); } }); }))
                return await ReadResponse(id);
        }

        public void Dispose()
        {
            if (closed) return; closed = true;
            try { input.Dispose(); } catch { }
            try { output.Dispose(); } catch { }
        }
    }
}
