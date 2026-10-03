import { createHmac, createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { canonicalJson, signaturesMatch } from '../sync/sync-auth.js';

export type CutoverTicket = {
  schemaVersion: 1;
  kind: 'cutover' | 'fence';
  storeId: string;
  requestId: string;
  fromGeneration: number;
  toGeneration: number;
  configurationVersion: number;
  configurationDigest: string;
  syncSecretDigest: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;

export function syncSecretDigest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function signCutoverTicket(
  value: Omit<CutoverTicket, 'signature'>,
  secret: string,
): CutoverTicket {
  return {
    ...value,
    signature: createHmac('sha256', secret)
      .update(canonicalJson(value))
      .digest('hex'),
  };
}

export function verifyCutoverTicket(
  value: unknown,
  secret: string,
): CutoverTicket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid cutover ticket');
  }
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    (row.kind !== 'cutover' && row.kind !== 'fence') ||
    typeof row.storeId !== 'string' ||
    !uuid.test(row.storeId) ||
    typeof row.requestId !== 'string' ||
    !uuid.test(row.requestId) ||
    typeof row.fromGeneration !== 'number' ||
    !Number.isSafeInteger(row.fromGeneration) ||
    row.fromGeneration < 1 ||
    typeof row.toGeneration !== 'number' ||
    !Number.isSafeInteger(row.toGeneration) ||
    row.toGeneration < 1 ||
    typeof row.configurationVersion !== 'number' ||
    !Number.isSafeInteger(row.configurationVersion) ||
    row.configurationVersion < 1 ||
    typeof row.configurationDigest !== 'string' ||
    !digest.test(row.configurationDigest) ||
    typeof row.syncSecretDigest !== 'string' ||
    !digest.test(row.syncSecretDigest) ||
    typeof row.issuedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.issuedAt)) ||
    typeof row.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(row.expiresAt)) ||
    typeof row.signature !== 'string' ||
    !digest.test(row.signature) ||
    (row.kind === 'cutover' && row.toGeneration !== row.fromGeneration) ||
    (row.kind === 'fence' && row.toGeneration !== row.fromGeneration + 1)
  ) {
    throw new BadRequestException('Invalid cutover ticket');
  }
  const issuedAt = Date.parse(row.issuedAt);
  const expiresAt = Date.parse(row.expiresAt);
  if (
    issuedAt > Date.now() + 300_000 ||
    expiresAt <= Date.now() ||
    expiresAt - issuedAt > 900_000
  )
    throw new ConflictException('Cutover ticket expired');
  const unsigned: Omit<CutoverTicket, 'signature'> = {
    schemaVersion: 1 as const,
    kind: row.kind,
    storeId: row.storeId,
    requestId: row.requestId,
    fromGeneration: row.fromGeneration,
    toGeneration: row.toGeneration,
    configurationVersion: row.configurationVersion,
    configurationDigest: row.configurationDigest,
    syncSecretDigest: row.syncSecretDigest,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
  };
  const signed = signCutoverTicket(unsigned, secret);
  if (!signaturesMatch(signed.signature, row.signature)) {
    throw new ConflictException('Cutover ticket signature is invalid');
  }
  return signed;
}
