import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { SecureConnection } from '../src/services/host-transport.js';

// Master spec §0/§1/§2: bounded, ordered traffic on the authenticated transport.
class Socket extends Duplex {
  constructor() { super(); this.writes = []; this.blockWrite = false; }
  _read() {}
  _write(chunk, _encoding, callback) { this.writes.push(Buffer.from(chunk)); if (this.blockWrite) this.writeCallback = callback; else callback(); }
  setTimeout() { return this; }
}
function encode(value) { const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]); }
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup() { const socket = new Socket(); const connection = new SecureConnection(socket, { localDeviceId: 'test' }); return { socket, connection }; }

test('Master spec §0/§1: fragmented headers and bodies are reconstructed', async () => {
  const { socket, connection } = setup(); const received = []; connection.handle = async (m) => received.push(m);
  const data = encode({ type: 'test', value: 'hello' });
  for (const byte of data) { socket.push(Buffer.from([byte])); await tick(); }
  assert.deepEqual(received, [{ type: 'test', value: 'hello' }]); socket.destroy();
});

test('Master spec §0/§1: coalesced frames larger than one frame are processed in order', async () => {
  const { socket, connection } = setup(); const received = []; let release;
  connection.handle = async (m) => { received.push(m.id); if (m.id === 1) await new Promise((resolve) => { release = resolve; }); };
  socket.push(Buffer.concat([encode({ id: 1, value: 'x'.repeat(40000) }), encode({ id: 2, value: 'y'.repeat(40000) })]));
  await tick(); assert.deepEqual(received, [1]); release(); await tick(); assert.deepEqual(received, [1, 2]); socket.destroy();
});

test('Master spec §0/§2: oversized and empty frame headers fail before body allocation', async () => {
  for (const size of [0, 65537, 0xffffffff]) {
    const { socket, connection } = setup(); const header = Buffer.alloc(4); header.writeUInt32BE(size);
    const closed = new Promise((resolve) => socket.once('close', resolve)); socket.push(header); await closed;
    assert.equal(connection.body, null); assert.equal(socket.destroyed, true);
  }
});

test('Master spec §0/§1: writes wait for drain and queued writes do not bypass it', async () => {
  const { socket, connection } = setup(); socket.blockWrite = true;
  const first = connection.send({ type: 'one', value: 'x'.repeat(20000) });
  let completed = false; first.then(() => { completed = true; });
  const second = connection.send({ type: 'two' }); await tick();
  assert.equal(socket.writes.length, 1); assert.equal(completed, false);
  socket.blockWrite = false; socket.writeCallback(); await Promise.all([first, second]);
  assert.equal(socket.writes.length, 2); socket.destroy();
});

test('Master spec §0/§1: a closed socket rejects writes waiting for drain', async () => {
  const { socket, connection } = setup(); socket.blockWrite = true;
  const pending = connection.send({ value: 'x'.repeat(20000) }); await tick(); socket.destroy();
  await assert.rejects(pending, /closed/i);
});
