import { BadRequestException } from '@nestjs/common';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sku = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
const units = ['each', 'pack', 'kg', 'l'] as const;
type Unit = (typeof units)[number];
export type DocumentEventType =
  | 'purchase_receipt.received'
  | 'purchase_return.returned'
  | 'stocktake.counted';
type Line = {
  lineId: string;
  receiptLineId?: string;
  productId: string;
  productName: string;
  sku: string;
  unit: Unit;
  quantityMinor: number;
  unitCostMinor: number;
  lineTotalMinor: number;
};
type Base = {
  eventId: string;
  storeId: string;
  eventType: DocumentEventType;
  schemaVersion: 1;
  documentId: string;
  actorId: string;
  actorName: string;
  reason: string;
  occurredAt: string;
};
export type DocumentEnvelope = {
  eventId: string;
  storeId: string;
  eventType: DocumentEventType;
  aggregateId: string;
  schemaVersion: 1;
  occurredAt: string;
  payload: Base & {
    supplierId?: string;
    supplierName?: string;
    receiptId?: string;
    totalMinor?: number;
    lines?: Line[];
    productId?: string;
    productName?: string;
    sku?: string;
    unit?: Unit;
    previousQuantityMinor?: number;
    countedQuantityMinor?: number;
    deltaMinor?: number;
  };
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid operation document event');
  return value as Record<string, unknown>;
}
function text(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.length <= max
  );
}
function id(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
function unsigned(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function unit(value: unknown): value is Unit {
  return units.some((candidate) => candidate === value);
}

export function parseDocumentEnvelope(value: unknown): DocumentEnvelope {
  const outer = record(value);
  const payload = record(outer.payload);
  const eventType = outer.eventType;
  if (
    eventType !== 'purchase_receipt.received' &&
    eventType !== 'purchase_return.returned' &&
    eventType !== 'stocktake.counted'
  )
    throw new BadRequestException('Invalid operation document type');
  if (
    !id(outer.eventId) ||
    !id(outer.storeId) ||
    !id(outer.aggregateId) ||
    outer.schemaVersion !== 1 ||
    !text(outer.occurredAt, 1, 40) ||
    !Number.isFinite(Date.parse(outer.occurredAt)) ||
    payload.eventId !== outer.eventId ||
    payload.storeId !== outer.storeId ||
    payload.eventType !== eventType ||
    payload.schemaVersion !== 1 ||
    payload.documentId !== outer.aggregateId ||
    payload.occurredAt !== outer.occurredAt ||
    !text(payload.actorId, 1, 255) ||
    !text(payload.actorName, 1, 160) ||
    !text(payload.reason, 3, 200)
  )
    throw new BadRequestException('Invalid operation document event');

  const base: Base = {
    eventId: outer.eventId,
    storeId: outer.storeId,
    eventType,
    schemaVersion: 1,
    documentId: outer.aggregateId,
    actorId: payload.actorId,
    actorName: payload.actorName.trim(),
    reason: payload.reason.trim(),
    occurredAt: outer.occurredAt,
  };
  if (eventType === 'stocktake.counted') {
    if (
      !id(payload.productId) ||
      !text(payload.productName, 1, 160) ||
      typeof payload.sku !== 'string' ||
      !sku.test(payload.sku) ||
      !unit(payload.unit) ||
      !unsigned(payload.previousQuantityMinor) ||
      !unsigned(payload.countedQuantityMinor) ||
      typeof payload.deltaMinor !== 'number' ||
      !Number.isSafeInteger(payload.deltaMinor) ||
      payload.countedQuantityMinor - payload.previousQuantityMinor !==
        payload.deltaMinor
    )
      throw new BadRequestException('Invalid stocktake document');
    return {
      eventId: outer.eventId,
      storeId: outer.storeId,
      eventType,
      aggregateId: outer.aggregateId,
      schemaVersion: 1,
      occurredAt: outer.occurredAt,
      payload: {
        ...base,
        productId: payload.productId,
        productName: payload.productName.trim(),
        sku: payload.sku,
        unit: payload.unit,
        previousQuantityMinor: payload.previousQuantityMinor,
        countedQuantityMinor: payload.countedQuantityMinor,
        deltaMinor: payload.deltaMinor,
      },
    };
  }
  if (
    !id(payload.supplierId) ||
    !text(payload.supplierName, 2, 200) ||
    !unsigned(payload.totalMinor) ||
    (eventType === 'purchase_return.returned' && !id(payload.receiptId)) ||
    !Array.isArray(payload.lines) ||
    payload.lines.length === 0 ||
    payload.lines.length > 200
  )
    throw new BadRequestException('Invalid purchase document');
  const lines: Line[] = [];
  const seen = new Set<string>();
  for (const raw of payload.lines) {
    const line = record(raw);
    if (
      !id(line.lineId) ||
      seen.has(line.lineId) ||
      (eventType === 'purchase_return.returned' && !id(line.receiptLineId)) ||
      !id(line.productId) ||
      !text(line.productName, 1, 160) ||
      typeof line.sku !== 'string' ||
      !sku.test(line.sku) ||
      !unit(line.unit) ||
      !unsigned(line.quantityMinor) ||
      line.quantityMinor === 0 ||
      !unsigned(line.unitCostMinor) ||
      !unsigned(line.lineTotalMinor)
    )
      throw new BadRequestException('Invalid purchase document line');
    seen.add(line.lineId);
    lines.push({
      lineId: line.lineId,
      ...(eventType === 'purchase_return.returned'
        ? { receiptLineId: line.receiptLineId as string }
        : {}),
      productId: line.productId,
      productName: line.productName.trim(),
      sku: line.sku,
      unit: line.unit,
      quantityMinor: line.quantityMinor,
      unitCostMinor: line.unitCostMinor,
      lineTotalMinor: line.lineTotalMinor,
    });
  }
  if (
    lines.reduce((sum, line) => sum + BigInt(line.lineTotalMinor), 0n) !==
    BigInt(payload.totalMinor)
  )
    throw new BadRequestException(
      'Purchase document total does not match lines',
    );
  return {
    eventId: outer.eventId,
    storeId: outer.storeId,
    eventType,
    aggregateId: outer.aggregateId,
    schemaVersion: 1,
    occurredAt: outer.occurredAt,
    payload: {
      ...base,
      supplierId: payload.supplierId,
      supplierName: payload.supplierName.trim(),
      ...(eventType === 'purchase_return.returned'
        ? { receiptId: payload.receiptId as string }
        : {}),
      totalMinor: payload.totalMinor,
      lines,
    },
  };
}
