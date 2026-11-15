// Process-bound IPC framing. This module is not wired to the desktop shell yet.
// The caller must supply already-connected, trusted pipes and an authorized
// dispatch function; this transport grants no capabilities by itself.
export const NATIVE_IPC_FRAME_LIMIT = 64 * 1024;
export const NATIVE_IPC_QUEUE_LIMIT = 16;

export function serveNativeIpc(input, output, dispatch, { timeoutMs = 30000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new TypeError('Invalid IPC timeout');
  if (typeof dispatch !== 'function') throw new TypeError('IPC dispatch is required');
  let header = Buffer.alloc(4), headerUsed = 0, body = null, bodyUsed = 0;
  let stopped = false, running = false, activeTimer = null;
  const requests = new Map(), queue = [];

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(activeTimer); activeTimer = null;
    for (const entry of requests.values()) entry.abort.abort();
    requests.clear(); queue.length = 0;
    input.destroy(); output.destroy();
  }

  // Serialize replies and wait for both write completion and drain. Only the
  // single dispatcher can call this, so queued output is bounded to one frame.
  async function reply(message) {
    if (stopped) throw new Error('IPC closed');
    const bytes = Buffer.from(JSON.stringify(message), 'utf8');
    if (!bytes.length || bytes.length > NATIVE_IPC_FRAME_LIMIT) throw new Error('IPC response too large');
    const frame = Buffer.allocUnsafe(4 + bytes.length);
    frame.writeUInt32BE(bytes.length); bytes.copy(frame, 4);
    await new Promise((resolve, reject) => {
      let wrote = false, drained = false, finished = false;
      const cleanup = () => { output.off('error', fail); output.off('close', closed); output.off('drain', drain); };
      const done = () => { if (!finished && wrote && drained) { finished = true; cleanup(); resolve(); } };
      const fail = (error) => { if (!finished) { finished = true; cleanup(); reject(error); } };
      const closed = () => fail(new Error('IPC output closed'));
      const drain = () => { drained = true; done(); };
      output.once('error', fail); output.once('close', closed);
      try {
        const writable = output.write(frame, (error) => { if (error) return fail(error); wrote = true; done(); });
        drained = writable;
        if (!writable) output.once('drain', drain);
        done();
      } catch (error) { fail(error); }
    });
  }

  async function pump() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped && queue.length) {
        const entry = queue.shift();
        // A timeout closes the entire channel. This avoids starting another
        // action while the timed-out handler might still be changing state;
        // it also bounds the wait for a peer that stops reading responses.
        activeTimer = setTimeout(stop, timeoutMs);
        try {
          let result, error = false;
          if (!entry.abort.signal.aborted) {
            try { result = await dispatch(entry.method, entry.payload, entry.abort.signal); }
            catch { error = true; }
          }
          if (stopped) break;
          if (entry.abort.signal.aborted) await reply({ type: 'response', id: entry.id, ok: false, error: 'cancelled' });
          else if (error) await reply({ type: 'response', id: entry.id, ok: false, error: 'operation_failed' });
          else await reply({ type: 'response', id: entry.id, ok: true, result });
        } finally { clearTimeout(activeTimer); activeTimer = null; }
        requests.delete(entry.id);
      }
    } catch { stop(); }
    finally { running = false; }
  }

  function accept(bytes) {
    let msg;
    try { msg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return stop(); }
    if (!msg || Array.isArray(msg) || typeof msg !== 'object' || typeof msg.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(msg.id)) return stop();
    if (msg.type === 'cancel') {
      if (Object.keys(msg).some(key => !['type', 'id'].includes(key))) return stop();
      requests.get(msg.id)?.abort.abort();
      return;
    }
    if (msg.type !== 'request' || Object.keys(msg).some(key => !['type', 'id', 'method', 'payload'].includes(key)) || typeof msg.method !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(msg.method) || requests.has(msg.id) || requests.size >= NATIVE_IPC_QUEUE_LIMIT) return stop();
    const entry = { id: msg.id, method: msg.method, payload: msg.payload, abort: new AbortController() };
    requests.set(entry.id, entry); queue.push(entry); void pump();
  }

  function data(chunk) {
    if (!Buffer.isBuffer(chunk) || stopped) return stop();
    let offset = 0;
    while (offset < chunk.length && !stopped) {
      if (!body) {
        const count = Math.min(4 - headerUsed, chunk.length - offset);
        chunk.copy(header, headerUsed, offset, offset + count); headerUsed += count; offset += count;
        if (headerUsed < 4) continue;
        const length = header.readUInt32BE(0); headerUsed = 0;
        if (!length || length > NATIVE_IPC_FRAME_LIMIT) return stop();
        body = Buffer.allocUnsafe(length); bodyUsed = 0;
      }
      const count = Math.min(body.length - bodyUsed, chunk.length - offset);
      chunk.copy(body, bodyUsed, offset, offset + count); bodyUsed += count; offset += count;
      if (bodyUsed === body.length) { const frame = body; body = null; bodyUsed = 0; accept(frame); }
    }
  }
  input.on('data', data); input.once('end', stop); input.once('close', stop); input.once('error', stop);
  output.once('close', stop); output.once('error', stop);
  return { close: stop };
}
