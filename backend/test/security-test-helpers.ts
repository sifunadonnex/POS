import { createHmac } from 'node:crypto';

// Test-only RFC 6238 code generation. Production verification belongs to Better Auth.
export function totpCode(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase().replaceAll('=', '')]
    .map((character) => {
      const index = alphabet.indexOf(character);
      if (index < 0) throw new Error('Invalid test TOTP secret');
      return index.toString(2).padStart(5, '0');
    })
    .join('');
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, '0');
}

export function cookieHeader(cookies: unknown, previous = ''): string {
  if (
    !Array.isArray(cookies) ||
    !cookies.every((cookie): cookie is string => typeof cookie === 'string')
  )
    throw new Error('Expected session cookies');
  const values = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), part.slice(index + 1)];
      }),
  );
  for (const cookie of cookies) {
    const part = cookie.split(';')[0];
    const index = part.indexOf('=');
    values.set(part.slice(0, index), part.slice(index + 1));
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join('; ');
}
