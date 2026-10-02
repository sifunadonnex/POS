import { BadRequestException } from '@nestjs/common';
import { roundedLineTotalMinor } from '../common/minor-unit-rounding.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SyncEnvelope = {
  eventId: string;
  storeId: string;
  eventType: 'cash_sale.completed';
  aggregateId: string;
  schemaVersion: 1;
  occurredAt: string;
  payload: Record<string, unknown>;
};

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function safeMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseSyncEnvelope(value: unknown): SyncEnvelope {
  const envelope = record(value, 'Invalid synchronization event');
  const payload = record(envelope.payload, 'Invalid synchronization payload');
  if (
    typeof envelope.eventId !== 'string' ||
    !UUID.test(envelope.eventId) ||
    typeof envelope.storeId !== 'string' ||
    !UUID.test(envelope.storeId) ||
    envelope.eventType !== 'cash_sale.completed' ||
    typeof envelope.aggregateId !== 'string' ||
    !UUID.test(envelope.aggregateId) ||
    envelope.schemaVersion !== 1 ||
    typeof envelope.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(envelope.occurredAt))
  ) {
    throw new BadRequestException('Invalid synchronization event');
  }
  if (
    payload.eventId !== envelope.eventId ||
    payload.storeId !== envelope.storeId ||
    payload.eventType !== envelope.eventType ||
    payload.schemaVersion !== 1 ||
    payload.saleId !== envelope.aggregateId ||
    typeof payload.requestId !== 'string' ||
    !UUID.test(payload.requestId) ||
    typeof payload.cashierId !== 'string' ||
    payload.cashierId.length < 1 ||
    payload.cashierId.length > 255 ||
    typeof payload.shiftId !== 'string' ||
    !UUID.test(payload.shiftId) ||
    payload.occurredAt !== envelope.occurredAt ||
    !safeMoney(payload.totalMinor) ||
    Number(payload.totalMinor) < 1 ||
    !Array.isArray(payload.lines) ||
    payload.lines.length < 1 ||
    payload.lines.length > 100
  ) {
    throw new BadRequestException('Invalid completed cash sale event');
  }
  let lineTotal = 0;
  for (const item of payload.lines) {
    const line = record(item, 'Invalid completed cash sale line');
    if (
      typeof line.productId !== 'string' ||
      !UUID.test(line.productId) ||
      (line.unit !== 'each' &&
        line.unit !== 'pack' &&
        line.unit !== 'kg' &&
        line.unit !== 'l') ||
      typeof line.quantity !== 'number' ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !safeMoney(line.priceMinor) ||
      !safeMoney(line.lineTotalMinor)
    ) {
      throw new BadRequestException('Invalid completed cash sale line');
    }
    const quantityMinor =
      line.unit === 'each' || line.unit === 'pack'
        ? line.quantity
        : Math.round(line.quantity * 1000);
    if (
      !Number.isSafeInteger(quantityMinor) ||
      quantityMinor <= 0 ||
      (line.unit !== 'each' &&
        line.unit !== 'pack' &&
        Math.abs(quantityMinor / 1000 - line.quantity) > 1e-9) ||
      roundedLineTotalMinor(
        quantityMinor,
        Number(line.priceMinor),
        line.unit,
      ) !== BigInt(Number(line.lineTotalMinor))
    ) {
      throw new BadRequestException('Invalid completed cash sale line');
    }
    lineTotal += Number(line.lineTotalMinor);
    if (!Number.isSafeInteger(lineTotal)) {
      throw new BadRequestException('Invalid completed cash sale total');
    }
  }
  const payment = record(
    payload.payment,
    'Invalid completed cash sale payment',
  );
  if (
    typeof payment.paymentId !== 'string' ||
    !UUID.test(payment.paymentId) ||
    !safeMoney(payment.amountMinor) ||
    Number(payment.amountMinor) < 1 ||
    !safeMoney(payment.tenderedMinor) ||
    !safeMoney(payment.changeMinor) ||
    payment.amountMinor !== payload.totalMinor ||
    lineTotal !== payload.totalMinor ||
    Number(payment.tenderedMinor) - Number(payment.amountMinor) !==
      payment.changeMinor
  ) {
    throw new BadRequestException('Invalid completed cash sale payment');
  }
  return {
    eventId: envelope.eventId,
    storeId: envelope.storeId,
    eventType: envelope.eventType,
    aggregateId: envelope.aggregateId,
    schemaVersion: 1,
    occurredAt: envelope.occurredAt,
    payload,
  };
}
