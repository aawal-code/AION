// One acknowledged chunk at a time bounds the browser-side queue. This bridge
// is installed only by the private native shell; ordinary browser fetch is unchanged.
export function nativeChatAvailable() { return location.origin === 'https://aion-private.invalid' && window.__aionNativeChat === true && Boolean(window.chrome?.webview); }

export function nativeChatFetch(body, signal) {
  return new Promise((resolve, reject) => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const channel = 'aion.chat.v1', webview = window.chrome.webview;
    let sequence = 0, controller, pendingAck = null, started = false, settled = false;
    const send = value => webview.postMessage({ channel, id, ...value });
    const cleanup = () => { webview.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); };
    const abort = () => { if (settled) return; settled = true; send({ type: 'cancel' }); cleanup(); const error = new DOMException('Response cancelled', 'AbortError'); if (started) controller.error(error); else reject(error); };
    const stream = new ReadableStream({ start(c) { controller = c; }, pull() { if (pendingAck !== null) { send({ type: 'ack', sequence: pendingAck }); pendingAck = null; } }, cancel() { abort(); } }, { highWaterMark: 1 });
    function receive(event) {
      const msg = event.data;
      if (!msg || msg.channel !== channel || msg.id !== id || settled) return;
      if (msg.type === 'start' && !started && msg.sequence === 0) { started = true; resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })); return; }
      if (msg.type === 'chunk' && started && msg.sequence === sequence + 1 && typeof msg.data === 'string' && msg.data.length <= 32768 && pendingAck === null) {
        try { const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)); sequence = msg.sequence; pendingAck = sequence; controller.enqueue(bytes); } catch { abort(); } return;
      }
      if (msg.type === 'end' && started && msg.sequence === sequence) { settled = true; cleanup(); controller.close(); return; }
      if (msg.type === 'error' && typeof msg.data === 'string' && msg.data.length <= 256) { settled = true; cleanup(); if (started) controller.error(new Error(msg.data)); else reject(new Error(msg.data)); return; }
      abort();
    }
    if (signal?.aborted) { settled = true; reject(new DOMException('Response cancelled', 'AbortError')); return; }
    const csrf = decodeURIComponent((document.cookie.split('; ').find(item => item.startsWith('aion_csrf=')) || '').slice(10));
    if (!csrf) { settled = true; reject(new Error('Authenticated session is unavailable.')); return; }
    webview.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true });
    send({ type: 'start', csrf, body });
  });
}
