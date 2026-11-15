import assert from 'node:assert/strict';
import test from 'node:test';

test('resource policy changes the bounded background hardware probe without weakening security work', async () => {
  process.env.AION_TEST_MODE = '1';
  const telemetry = await import(`../src/services/telemetry.js?resource-policy-test=${Date.now()}`);
  assert.deepEqual(telemetry.setResourcePolicy('eco'), { mode: 'eco', laptopModePollIntervalMs: 60000, backgroundPolicy: 'event-driven identity and on-demand telemetry' });
  assert.equal(telemetry.setResourcePolicy('balanced').laptopModePollIntervalMs, 30000);
  assert.equal(telemetry.setResourcePolicy('performance').laptopModePollIntervalMs, 15000);
  assert.throws(() => telemetry.setResourcePolicy('unsafe'), /Resource policy/);
  telemetry.stopLaptopModePolling();
});
