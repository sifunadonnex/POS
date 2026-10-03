import { createHmac } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { canonicalJson, signaturesMatch } from '../sync/sync-auth.js';

export type ConfigurationEvent = {
  version: number;
  transactionId: string;
  previousDigest: string;
  digest: string;
  entity: 'staff' | 'category' | 'product' | 'barcode';
  operation: 'upsert' | 'delete';
  entityId: string;
  payload: Record<string, unknown>;
  actorId: string | null;
  reason: string | null;
};
export type ConfigurationBatch = {
  schemaVersion: 1;
  storeId: string;
  generation: number;
  fromVersion: number;
  fromDigest: string;
  toVersion: number;
  toDigest: string;
  issuedAt: string;
  expiresAt: string;
  events: ConfigurationEvent[];
  signature: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid configuration batch');
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new BadRequestException('Invalid configuration batch');
  }
  return value;
}
function integer(value: unknown, min: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min
  ) {
    throw new BadRequestException('Invalid configuration version');
  }
  return value;
}
function digest(value: unknown): string {
  const result = text(value, 64);
  if (!digestPattern.test(result))
    throw new BadRequestException('Invalid configuration digest');
  return result;
}

export function signConfigurationBatch(
  unsigned: Omit<ConfigurationBatch, 'signature'>,
  secret: string,
): ConfigurationBatch {
  const signature = createHmac('sha256', secret)
    .update(canonicalJson(unsigned))
    .digest('hex');
  return { ...unsigned, signature };
}

export function verifyConfigurationBatch(
  value: unknown,
  secret: string,
  now = Date.now(),
): ConfigurationBatch {
  if (Buffer.byteLength(JSON.stringify(value)) > 4_000_000) {
    throw new BadRequestException('Configuration batch exceeds its size limit');
  }
  const raw = object(value);
  if (raw.schemaVersion !== 1)
    throw new BadRequestException('Unknown configuration schema');
  const issuedAt = text(raw.issuedAt, 40);
  const expiresAt = text(raw.expiresAt, 40);
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > 15 * 60_000 ||
    issued > now + 60_000 ||
    expires <= now
  ) {
    throw new ConflictException(
      'Configuration batch has expired or has invalid dates',
    );
  }
  const storeId = text(raw.storeId, 36);
  if (!uuidPattern.test(storeId))
    throw new BadRequestException('Invalid store ID');
  const eventsValue = raw.events;
  if (!Array.isArray(eventsValue) || eventsValue.length > 2000) {
    throw new BadRequestException(
      'Configuration batch exceeds its event limit',
    );
  }
  const events: ConfigurationEvent[] = eventsValue.map((value) => {
    const row = object(value);
    const entity = row.entity;
    const operation = row.operation;
    if (
      entity !== 'staff' &&
      entity !== 'category' &&
      entity !== 'product' &&
      entity !== 'barcode'
    ) {
      throw new BadRequestException('Unknown configuration entity');
    }
    if (operation !== 'upsert' && operation !== 'delete') {
      throw new BadRequestException('Unknown configuration operation');
    }
    const transactionId = text(row.transactionId, 20);
    if (!/^[1-9][0-9]*$/.test(transactionId))
      throw new BadRequestException('Invalid transaction ID');
    if (row.actorId !== null && typeof row.actorId !== 'string')
      throw new BadRequestException('Invalid actor');
    if (row.reason !== null && typeof row.reason !== 'string')
      throw new BadRequestException('Invalid reason');
    const payload = object(row.payload);
    if (Buffer.byteLength(JSON.stringify(payload)) > 5000)
      throw new BadRequestException('Configuration event is too large');
    return {
      version: integer(row.version, 2),
      transactionId,
      previousDigest: digest(row.previousDigest),
      digest: digest(row.digest),
      entity,
      operation,
      entityId: text(row.entityId, 200),
      payload,
      actorId: row.actorId,
      reason: row.reason,
    };
  });
  const unsigned: Omit<ConfigurationBatch, 'signature'> = {
    schemaVersion: 1,
    storeId: storeId.toLowerCase(),
    generation: integer(raw.generation, 1),
    fromVersion: integer(raw.fromVersion, 1),
    fromDigest: digest(raw.fromDigest),
    toVersion: integer(raw.toVersion, 1),
    toDigest: digest(raw.toDigest),
    issuedAt,
    expiresAt,
    events,
  };
  const signature = text(raw.signature, 64);
  if (
    !signaturesMatch(
      signConfigurationBatch(unsigned, secret).signature,
      signature,
    )
  ) {
    throw new ConflictException('Configuration signature is invalid');
  }
  let version = unsigned.fromVersion;
  let previousDigest = unsigned.fromDigest;
  let lastTransaction: string | null = null;
  const seenTransactions = new Set<string>();
  for (const event of events) {
    if (
      event.version !== version + 1 ||
      event.previousDigest !== previousDigest ||
      (event.transactionId !== lastTransaction &&
        seenTransactions.has(event.transactionId))
    ) {
      throw new ConflictException(
        'Configuration batch has a gap or changed digest',
      );
    }
    seenTransactions.add(event.transactionId);
    lastTransaction = event.transactionId;
    version = event.version;
    previousDigest = event.digest;
  }
  if (unsigned.toVersion !== version || unsigned.toDigest !== previousDigest) {
    throw new ConflictException(
      'Configuration batch checkpoint does not match its events',
    );
  }
  return { ...unsigned, signature };
}
