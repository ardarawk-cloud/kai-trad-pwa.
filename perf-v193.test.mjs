import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brokerUi = readFileSync(new URL('./broker-v183.js', import.meta.url), 'utf8');

test('mobile performance mode removes expensive mobile paint effects', () => {
  assert.match(brokerUi, /installMobilePerformanceMode/);
  assert.match(brokerUi, /backdrop-filter:\s*none/);
  assert.match(brokerUi, /\.bg-grid\s*\{\s*display:\s*none/);
  assert.match(brokerUi, /content-visibility:\s*auto/);
  assert.match(brokerUi, /contain-intrinsic-size:\s*auto\s+320px/);
});

test('broker polling is reduced and pauses when page is hidden', () => {
  assert.match(brokerUi, /setInterval\(refreshBroker,\s*60000\)/);
  assert.match(brokerUi, /document\.visibilityState\s*===\s*"hidden"/);
  assert.match(brokerUi, /visibilitychange/);
});
