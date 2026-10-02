import {
  canonicalJson,
  createSyncSignature,
  signaturesMatch,
} from './sync-auth.js';

it('canonicalizes object keys and rejects a modified signed event', () => {
  expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
    '{"a":{"c":3,"d":4},"b":2}',
  );
  const signature = createSyncSignature(
    's'.repeat(32),
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '1790956800',
    { totalMinor: 100 },
  );
  expect(signaturesMatch(signature, signature)).toBe(true);
  expect(
    signaturesMatch(
      createSyncSignature(
        's'.repeat(32),
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '1790956800',
        { totalMinor: 101 },
      ),
      signature,
    ),
  ).toBe(false);
});
