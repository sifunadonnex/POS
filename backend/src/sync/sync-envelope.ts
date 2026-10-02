import { BadRequestException } from '@nestjs/common';
import { roundedLineTotalMinor } from '../common/minor-unit-rounding.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SyncEnvelope = {
  eventId: string;
  storeId: string;
  eventType: 'cash_sale.completed';
  aggregateId: string;
  schemaVersion: 1 | 2;
  occurredAt: string;
  payload: CompletedCashSalePayload;
};

export type CompletedCashSalePayload = {
  eventId: string;
  storeId: string;
  eventType: 'cash_sale.completed';
  schemaVersion: 1 | 2;
  requestId: string;
  saleId: string;
  cashierId: string;
  cashierName: string;
  shiftId: string;
  occurredAt: string;
  totalMinor: number;
  lines: Array<{
    productId: string;
    name: string;
    sku: string;
    unit: 'each' | 'pack' | 'kg' | 'l';
    quantity: number;
    quantityMinor: number;
    priceMinor: number;
    lineTotalMinor: number;
  }>;
  payment: {
    paymentId: string;
    amountMinor: number;
    tenderedMinor: number;
    changeMinor: number;
  };
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
    (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2) ||
    typeof envelope.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(envelope.occurredAt))
  ) {
    throw new BadRequestException('Invalid synchronization event');
  }
  if (
    payload.eventId !== envelope.eventId ||
    payload.storeId !== envelope.storeId ||
    payload.eventType !== envelope.eventType ||
    payload.schemaVersion !== envelope.schemaVersion ||
    payload.saleId !== envelope.aggregateId ||
    typeof payload.requestId !== 'string' ||
    !UUID.test(payload.requestId) ||
    typeof payload.cashierId !== 'string' ||
    payload.cashierId.length < 1 ||
    payload.cashierId.length > 255 ||
    (envelope.schemaVersion === 2 &&
      (typeof payload.cashierName !== 'string' ||
        payload.cashierName.trim().length < 1 ||
        payload.cashierName.length > 160)) ||
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
  const lines: CompletedCashSalePayload['lines'] = [];
  for (const [index, item] of payload.lines.entries()) {
    const line = record(item, 'Invalid completed cash sale line');
    if (
      typeof line.productId !== 'string' ||
      !UUID.test(line.productId) ||
      (envelope.schemaVersion === 2 &&
        (typeof line.name !== 'string' ||
          line.name.trim().length < 1 ||
          line.name.length > 160 ||
          typeof line.sku !== 'string' ||
          !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(line.sku))) ||
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
    lines.push({
      productId: line.productId,
      name:
        envelope.schemaVersion === 2
          ? String(line.name).trim()
          : 'Legacy product',
      sku:
        envelope.schemaVersion === 2 ? String(line.sku) : `LEGACY-${index + 1}`,
      unit: line.unit,
      quantity: line.quantity,
      quantityMinor,
      priceMinor: Number(line.priceMinor),
      lineTotalMinor: Number(line.lineTotalMinor),
    });
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
    schemaVersion: envelope.schemaVersion,
    occurredAt: envelope.occurredAt,
    payload: {
      eventId: envelope.eventId,
      storeId: envelope.storeId,
      eventType: 'cash_sale.completed',
      schemaVersion: envelope.schemaVersion,
      requestId: payload.requestId,
      saleId: envelope.aggregateId,
      cashierId: payload.cashierId,
      cashierName:
        envelope.schemaVersion === 2
          ? String(payload.cashierName).trim()
          : 'Legacy cashier',
      shiftId: payload.shiftId,
      occurredAt: envelope.occurredAt,
      totalMinor: Number(payload.totalMinor),
      lines,
      payment: {
        paymentId: payment.paymentId,
        amountMinor: Number(payment.amountMinor),
        tenderedMinor: Number(payment.tenderedMinor),
        changeMinor: Number(payment.changeMinor),
      },
    },
  };
}
