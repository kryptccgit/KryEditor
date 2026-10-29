import assert from 'node:assert';
import { expandPattern, sanitizeFilename } from './.naming.mjs';

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const date = new Date(2026, 5, 5, 9, 7, 3, 42);
const ctx = { date, seq: 4, mode: 'region', width: 1920, height: 1080, rand: 'abc123' };

t('expands date tokens with zero-padding', () => {
  assert.strictEqual(expandPattern('%y-%mo-%d_%h%mi%s', ctx), '2026-06-05_090703');
});

t('expands millis, seq, mode, dims, rand', () => {
  assert.strictEqual(expandPattern('%ms_%seq_%mode_%w-%ht_%rand', ctx), '042_004_region_1920-1080_abc123');
});

t('does not half-eat overlapping prefixes (%h/%ht, %mi/%mo, %mode/%mo)', () => {
  assert.strictEqual(expandPattern('a%hb%htc%mid%moe%modef', ctx), 'a09b1080c07d06eregionf');
});

t('keeps literal text verbatim', () => {
  assert.strictEqual(expandPattern('Krypt_%y', ctx), 'Krypt_2026');
});

t('falls back to a default when pattern is empty', () => {
  const out = expandPattern('', ctx);
  assert.ok(out.includes('2026'), `expected default to contain year, got ${out}`);
});

t('sanitizes forbidden path characters', () => {
  assert.strictEqual(sanitizeFilename('a/b:c'), 'a_b_c');
  assert.ok(!/[<>:"/\\|?*]/.test(sanitizeFilename('x<y>z:"/\\|?*')));
});

t('sanitize never returns empty', () => {
  const out = sanitizeFilename('   ');
  assert.ok(out.length > 0, 'expected a non-empty filename');
  assert.ok(!/\s/.test(out), 'expected no whitespace in filename');
});

console.log(`naming: ${passed} passed`);
