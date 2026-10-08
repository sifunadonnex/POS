import { BadRequestException } from '@nestjs/common';
import { parseSyncEnvelope, type SyncEnvelope } from './sync-envelope.js';
import {
  parseDocumentEnvelope,
  type DocumentEnvelope,
} from './sync-document-envelope.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sku = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

type Common<T extends string, P> = {
  eventId: string;
  storeId: string;
  eventType: T;
  aggregateId: string;
  schemaVersion: 1;
  occurredAt: string;
  payload: P;
};

export type RefundEnvelope = Common<
  'sale_refund.paid',
  {
    eventId: string;
    storeId: string;
    eventType: 'sale_refund.paid';
    schemaVersion: 1;
    refundId: string;
    saleId: string;
    returnId: string;
    cashierId: string;
    cashierName: string;
    amountMinor: number;
    occurredAt: string;
  }
>;

export type StockMovementEnvelope = Common<
  'stock_movement.recorded',
  {
    eventId: string;
    storeId: string;
    eventType: 'stock_movement.recorded';
    schemaVersion: 1;
    movementId: string;
    productId: string;
    productName: string;
    sku: string;
    unit: 'each' | 'pack' | 'kg' | 'l';
    kind:
      'opening' | 'receive' | 'adjustment' | 'sale' | 'return' | 'stocktake';
    deltaMinor: number;
    quantityAfterMinor: number;
    actorId: string;
    reason: string;
    occurredAt: string;
  }
>;

export type ActivityEnvelope =
  SyncEnvelope | RefundEnvelope | StockMovementEnvelope | DocumentEnvelope;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid synchronization event');
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.length <= max
  );
}

function unsigned(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseActivityEnvelope(value: unknown): ActivityEnvelope {
  const outer = record(value);
  if (outer.eventType === 'cash_sale.completed')
    return parseSyncEnvelope(value);
  if (
    outer.eventType === 'purchase_receipt.received' ||
    outer.eventType === 'purchase_return.returned' ||
    outer.eventType === 'stocktake.counted'
  )
    return parseDocumentEnvelope(value);
  const payload = record(outer.payload);
  if (
    !(
      outer.eventType === 'sale_refund.paid' ||
      outer.eventType === 'stock_movement.recorded'
    ) ||
    typeof outer.eventId !== 'string' ||
    !uuid.test(outer.eventId) ||
    typeof outer.storeId !== 'string' ||
    !uuid.test(outer.storeId) ||
    typeof outer.aggregateId !== 'string' ||
    !uuid.test(outer.aggregateId) ||
    outer.schemaVersion !== 1 ||
    typeof outer.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(outer.occurredAt)) ||
    payload.eventId !== outer.eventId ||
    payload.storeId !== outer.storeId ||
    payload.eventType !== outer.eventType ||
    payload.schemaVersion !== 1 ||
    payload.occurredAt !== outer.occurredAt
  ) {
    throw new BadRequestException('Invalid synchronization event');
  }
  if (outer.eventType === 'sale_refund.paid') {
    if (
      payload.refundId !== outer.aggregateId ||
      typeof payload.saleId !== 'string' ||
      !uuid.test(payload.saleId) ||
      typeof payload.returnId !== 'string' ||
      !uuid.test(payload.returnId) ||
      !boundedText(payload.cashierId, 1, 255) ||
      !boundedText(payload.cashierName, 1, 160) ||
      !unsigned(payload.amountMinor)
    ) {
      throw new BadRequestException('Invalid paid refund event');
    }
    return {
      eventId: outer.eventId,
      storeId: outer.storeId,
      eventType: outer.eventType,
      aggregateId: outer.aggregateId,
      schemaVersion: 1,
      occurredAt: outer.occurredAt,
      payload: {
        eventId: outer.eventId,
        storeId: outer.storeId,
        eventType: outer.eventType,
        schemaVersion: 1,
        refundId: outer.aggregateId,
        saleId: payload.saleId,
        returnId: payload.returnId,
        cashierId: payload.cashierId,
        cashierName: payload.cashierName.trim(),
        amountMinor: payload.amountMinor,
        occurredAt: outer.occurredAt,
      },
    };
  }
  if (
    payload.movementId !== outer.aggregateId ||
    typeof payload.productId !== 'string' ||
    !uuid.test(payload.productId) ||
    !boundedText(payload.productName, 1, 160) ||
    typeof payload.sku !== 'string' ||
    !sku.test(payload.sku) ||
    !['each', 'pack', 'kg', 'l'].includes(String(payload.unit)) ||
    ![
      'opening',
      'receive',
      'adjustment',
      'sale',
      'return',
      'stocktake',
    ].includes(String(payload.kind)) ||
    !Number.isSafeInteger(payload.deltaMinor) ||
    (payload.deltaMinor === 0 && payload.kind !== 'stocktake') ||
    !unsigned(payload.quantityAfterMinor) ||
    !boundedText(payload.actorId, 1, 255) ||
    !boundedText(payload.reason, 3, 200)
  ) {
    throw new BadRequestException('Invalid stock movement event');
  }
  const unit = payload.unit as StockMovementEnvelope['payload']['unit'];
  const kind = payload.kind as StockMovementEnvelope['payload']['kind'];
  return {
    eventId: outer.eventId,
    storeId: outer.storeId,
    eventType: outer.eventType,
    aggregateId: outer.aggregateId,
    schemaVersion: 1,
    occurredAt: outer.occurredAt,
    payload: {
      eventId: outer.eventId,
      storeId: outer.storeId,
      eventType: outer.eventType,
      schemaVersion: 1,
      movementId: outer.aggregateId,
      productId: payload.productId,
      productName: payload.productName.trim(),
      sku: payload.sku,
      unit,
      kind,
      deltaMinor: Number(payload.deltaMinor),
      quantityAfterMinor: payload.quantityAfterMinor,
      actorId: payload.actorId,
      reason: payload.reason.trim(),
      occurredAt: outer.occurredAt,
    },
  };
}
