using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace AION.Desktop
{
    internal sealed class TraceMemoryStream : MemoryStream
    {
        private readonly string traceId; private bool first;
        public TraceMemoryStream(byte[] bytes, string id) : base(bytes) { traceId = id; }
        public override int Read(byte[] buffer, int offset, int count) { MainWindow.TracePrivate(traceId, "memory_read_enter"); int n = base.Read(buffer, offset, count); MainWindow.TracePrivate(traceId, "memory_read_exit_" + n); if (n > 0 && !first) { first = true; MainWindow.TracePrivate(traceId, "stream_first_byte"); } if (n == 0) MainWindow.TracePrivate(traceId, "stream_eof"); return n; }
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) { MainWindow.TracePrivate(traceId, "memory_read_async_enter"); int n = await base.ReadAsync(buffer, offset, count, cancellationToken); MainWindow.TracePrivate(traceId, "memory_read_async_exit_" + n); if (n > 0 && !first) { first = true; MainWindow.TracePrivate(traceId, "stream_first_byte"); } if (n == 0) MainWindow.TracePrivate(traceId, "stream_eof"); return n; }
        protected override void Dispose(bool disposing) { MainWindow.TracePrivate(traceId, "stream_dispose"); base.Dispose(disposing); }
    }
    // Reads one bounded IPC chunk at a time. Disposing the WebView response
    // cancels its backend request; no response is retried after disconnection.
    internal sealed class NativeIpcResponseStream : Stream
    {
        private readonly NativeIpcClient client;
        private readonly string id;
        private readonly string traceId;
        private byte[] pending = new byte[0];
        private int offset;
        private bool ended;
        public NativeIpcResponseStream(NativeIpcClient client, string id, string traceId) { this.client = client; this.id = id; this.traceId = traceId; }
        public override bool CanRead { get { return !ended; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int start, int count)
        {
            MainWindow.TracePrivate(traceId, "stream_read_thread_" + Thread.CurrentThread.ManagedThreadId);
            try {
            if (buffer == null) throw new ArgumentNullException("buffer");
            if (start < 0 || count < 0 || start > buffer.Length - count) throw new ArgumentOutOfRangeException();
            if (count == 0 || ended) return 0;
            while (offset == pending.Length)
            {
                Dictionary<string, object> reply = Task.Run(() => client.CallAsync("http.read", new { id = id }, 5000, CancellationToken.None, null, traceId)).GetAwaiter().GetResult();
                if (!(bool)reply["ok"]) throw new IOException("Native response unavailable");
                var result = reply["result"] as Dictionary<string, object>;
                if (result == null || !(result["done"] is bool) || !(result["data"] is string)) throw new IOException("Invalid native response");
                if ((bool)result["done"]) { MainWindow.TracePrivate(traceId, "stream_eof"); ended = true; return 0; }
                pending = Convert.FromBase64String((string)result["data"]); offset = 0;
                if (pending.Length > 0) MainWindow.TracePrivate(traceId, "stream_data");
                if (pending.Length > 24 * 1024) throw new IOException("Native response too large");
            }
            int length = Math.Min(count, pending.Length - offset); Buffer.BlockCopy(pending, offset, buffer, start, length); offset += length; return length;
            } finally { MainWindow.TracePrivate(traceId, "stream_read_exit"); }
        }
        protected override void Dispose(bool disposing)
        {
            MainWindow.TracePrivate(traceId, "stream_dispose");
            if (!ended) { ended = true; Task.Run(async () => { try { await client.CallAsync("http.cancel", new { id = id }, 3000, CancellationToken.None, null, traceId); } catch { } }); }
            base.Dispose(disposing);
        }
    }
}
