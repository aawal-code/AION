import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Architecture & Zero-Dependency Validation', () => {
  test('verifies zero runtime npm dependencies', () => {
    if (fs.existsSync('package.json')) {
      const raw = fs.readFileSync('package.json', 'utf8').replace(/^\uFEFF/, '');
      const pkg = JSON.parse(raw);
      assert.deepEqual(pkg.dependencies || {}, {}, 'Runtime dependencies must remain 0B');
    } else {
      assert.ok(true, 'No package.json present, pure Node standard library');
    }
  });

  test('verifies no hardcoded absolute user profiles exist in source code', () => {
    const files = fs.readdirSync('src', { recursive: true });
    files.forEach(f => {
      if (typeof f === 'string' && f.endsWith('.js')) {
        const content = fs.readFileSync(`src/${f}`, 'utf8');
        assert.ok(!content.includes('C:\\Users\\abdul'), `Found hardcoded user path in src/${f}`);
      }
    });
  });
});
