import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

const setup = process.env.AION_TEST_SETUP_EXE;
test('Master spec §1/§2: isolated installer verifies bundled runtime and preserves data on uninstall', { skip: process.platform !== 'win32' || !setup, timeout: 150000 }, async () => {
  const root = path.join(os.tmpdir(), `aion-isolated-${crypto.randomUUID()}`);
  const env = { ...process.env, AION_ISOLATED_INSTALL_TEST: root };
  const run = async executable => {
    const child = spawn(executable, ['/quiet'], { windowsHide: true, env, stdio: 'ignore' });
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null); assert.equal(code, 0);
  };
  await run(setup);
  const node = path.join(root, 'runtime', 'node.exe');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(node)).digest('hex');
  assert.equal(hash, '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de');
  execFileSync(node, ['--input-type=module', '-e', "await import('node:sqlite'); await import('reflect-metadata'); await import('@peculiar/x509')"], { cwd: root, windowsHide: true, stdio: 'ignore' });
  const data = path.join(root, 'data', 'preservation-test.txt');
  fs.writeFileSync(data, 'preserve isolated identity data');
  await run(path.join(root, 'Uninstall.exe'));
  assert.equal(fs.readFileSync(data, 'utf8'), 'preserve isolated identity data');
  assert.equal(fs.existsSync(path.join(root, 'AION.exe')), false);
  assert.equal(fs.existsSync(path.join(root, 'runtime')), false);
});
