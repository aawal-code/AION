import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, getLocalVersion } from '../src/services/updater.js';

describe('Updater Service Logic', () => {
  test('getLocalVersion returns valid semver string from package.json', () => {
    const version = getLocalVersion();
    assert.match(version, /^\d+\.\d+\.\d+$/);
  });

  test('compareVersions accurately identifies newer, older, and identical versions', () => {
    assert.equal(compareVersions('1.0.1', '1.0.0'), 1, '1.0.1 should be greater than 1.0.0');
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1, '2.0.0 should be greater than 1.9.9');
    assert.equal(compareVersions('v1.1.0', '1.1.0'), 0, 'v1.1.0 and 1.1.0 should be equal');
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1, '1.0.0 should be less than 1.0.1');
    assert.equal(compareVersions('1.0.0', '2.0.0'), -1, '1.0.0 should be less than 2.0.0');
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0, 'identical versions should return 0');
  });
});
