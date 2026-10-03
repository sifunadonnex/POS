import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  throw new Error('Invalid JSON value');
}

export function syncPayloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function createSyncSignature(
  secret: string,
  storeId: string,
  eventId: string,
  timestamp: string,
  value: unknown,
  generation?: number,
): string {
  return createHmac('sha256', secret)
    .update(
      `${storeId}\n${eventId}\n${timestamp}\n${generation === undefined ? '' : `${generation}\n`}${syncPayloadHash(value)}`,
    )
    .digest('hex');
}

export function signaturesMatch(expected: string, received: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received, 'hex'),
  );
}
