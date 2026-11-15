import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serveNativeIpc, NATIVE_IPC_FRAME_LIMIT, NATIVE_IPC_QUEUE_LIMIT } from '../src/services/native-ipc-channel.js';

const frame = value => { const body = Buffer.from(JSON.stringify(value)); const out = Buffer.alloc(4 + body.length); out.writeUInt32BE(body.length); body.copy(out, 4); return out; };
const req = id => ({ type: 'request', id, method: 'read', payload: id });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function reader(stream) {
  let buffer = Buffer.alloc(0); const messages = []; const waiters = [];
  stream.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
      const len = buffer.readUInt32BE(0); messages.push(JSON.parse(buffer.subarray(4, 4 + len))); buffer = buffer.subarray(4 + len);
    }
    while (messages.length && waiters.length) waiters.shift()(messages.shift());
  });
  return () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve));
}

test('Master spec §1/§2: IPC reconstructs fragmented and coalesced requests in order', async () => {
  const input = new PassThrough(), output = new PassThrough(), next = reader(output), order = [];
  const channel = serveNativeIpc(input, output, async (_method, payload) => { order.push(payload); return payload; });
  const bytes = Buffer.concat([frame(req('a')), frame(req('b'))]);
  input.write(bytes.subarray(0, 3)); input.write(bytes.subarray(3, 11)); input.write(bytes.subarray(11));
  assert.deepEqual(await next(), { type: 'response', id: 'a', ok: true, result: 'a' });
  assert.deepEqual(await next(), { type: 'response', id: 'b', ok: true, result: 'b' });
  assert.deepEqual(order, ['a', 'b']); channel.close();
});

test('Master spec §1/§2: invalid, oversized, duplicate and excess requests close the channel', async () => {
  for (const data of [Buffer.alloc(4), Buffer.from([0, 1, 0, 1]), frame({ type: 'request', id: 'bad id', method: 'read' }), Buffer.concat([frame(req('a')), frame(req('a'))]), Buffer.concat(Array.from({ length: NATIVE_IPC_QUEUE_LIMIT + 1 }, (_, i) => frame(req(String(i)))))]) {
    const input = new PassThrough(), output = new PassThrough();
    serveNativeIpc(input, output, () => new Promise(() => {})); const closed = once(input, 'close'); input.write(data); await closed; assert.equal(output.destroyed, true);
  }
  assert.equal(NATIVE_IPC_FRAME_LIMIT, 65536);
});

test('Master spec §1/§2: cancellation aborts an active request and skips queued work', async () => {
  const input = new PassThrough(), output = new PassThrough(), next = reader(output), calls = [];
  const channel = serveNativeIpc(input, output, async (_method, payload, signal) => { calls.push(payload); if (payload === 'active') await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return payload; });
  input.write(Buffer.concat([frame(req('active')), frame(req('queued')), frame({ type: 'cancel', id: 'queued' }), frame({ type: 'cancel', id: 'active' })]));
  assert.deepEqual(await next(), { type: 'response', id: 'active', ok: false, error: 'cancelled' });
  assert.deepEqual(await next(), { type: 'response', id: 'queued', ok: false, error: 'cancelled' });
  assert.deepEqual(calls, ['active']); channel.close();
});

test('Master spec §1/§2: output backpressure preserves serialization and timeout fails closed', async () => {
  const input = new PassThrough(), output = new PassThrough({ highWaterMark: 16 }), calls = [];
  const channel = serveNativeIpc(input, output, async (_method, payload) => { calls.push(payload); return 'x'.repeat(300); });
  input.write(Buffer.concat([frame(req('a')), frame(req('b'))]));
  await delay(30); assert.deepEqual(calls, ['a'], 'second request waits while output is blocked');
  const next = reader(output); assert.equal((await next()).id, 'a'); assert.equal((await next()).id, 'b'); channel.close();
  const stalledInput = new PassThrough(), stalledOutput = new PassThrough();
  let signal; serveNativeIpc(stalledInput, stalledOutput, (_method, _payload, s) => { signal = s; return new Promise(() => {}); }, { timeoutMs: 20 });
  const closed = once(stalledInput, 'close'); stalledInput.write(frame(req('slow'))); await closed; assert.equal(signal.aborted, true); assert.equal(stalledOutput.destroyed, true);
  const unreadInput = new PassThrough(), unreadOutput = new PassThrough({ highWaterMark: 16 });
  serveNativeIpc(unreadInput, unreadOutput, async () => 'x'.repeat(300), { timeoutMs: 20 });
  const unreadClosed = once(unreadInput, 'close'); unreadInput.write(frame(req('unread'))); await unreadClosed; assert.equal(unreadOutput.destroyed, true, 'an unread response times out');
});

test('Master spec §1/§2: framed requests and cancellation work over inherited child pipes', { timeout: 10000 }, async (t) => {
  const child = spawn(process.execPath, ['tests/fixtures/native-ipc-child.mjs'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const next = reader(child.stdout);
  const first = frame({ type: 'request', id: 'child1', method: 'echo', payload: 'value' });
  child.stdin.write(first.subarray(0, 2)); child.stdin.write(first.subarray(2));
  assert.deepEqual(await next(), { type: 'response', id: 'child1', ok: true, result: 'value' });
  child.stdin.write(Buffer.concat([frame({ type: 'request', id: 'child2', method: 'wait' }), frame({ type: 'cancel', id: 'child2' })]));
  assert.deepEqual(await next(), { type: 'response', id: 'child2', ok: false, error: 'cancelled' });
  const exited = once(child, 'exit'); child.stdin.end(); const [code] = await exited; assert.equal(code, 0);
});

test('Master spec §1/§2: Windows native client talks to Node over inherited pipes', { skip: process.platform !== 'win32', timeout: 10000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ipc-client-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'client.exe'), csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const build = spawnSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, '/r:System.Web.Extensions.dll', path.resolve('scripts/win/NativeIpcClient.cs'), path.resolve('tests/fixtures/native-ipc-client-harness.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const run = spawnSync(exe, [process.execPath, path.resolve('tests/fixtures/native-ipc-child.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 7000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`); assert.match(run.stdout, /CLIENT_OK/);
});
