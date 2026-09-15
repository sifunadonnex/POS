import { BadRequestException } from '@nestjs/common';

export type SaleUnit = 'each' | 'pack' | 'kg' | 'l';
export type ProductInput = {
  sku: string;
  name: string;
  categoryId: string | null;
  unit: SaleUnit;
  priceMinor: string;
  taxCode: string | null;
  barcodes: string[];
  active: boolean;
};

export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Provide an object');
  return Object.fromEntries(Object.entries(value));
}
export function textInput(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string')
    throw new BadRequestException(`Provide ${field}`);
  const text = value.trim();
  if (
    !text ||
    text.length > max ||
    [...text].some((char) => char.charCodeAt(0) < 32)
  )
    throw new BadRequestException(`Invalid ${field}`);
  return text;
}
export function uuidInput(value: unknown, field = 'ID'): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException(`Invalid ${field}`);
  return value.toLowerCase();
}
export function revisionInput(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= 2147483647
  )
    throw new BadRequestException('Provide a valid revision');
  return value;
}
export function priceInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)
  )
    throw new BadRequestException(
      'Price must be from 0 to 9,999,999.99 KES, with at most two decimal places',
    );
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
export function unitInput(value: unknown): SaleUnit {
  if (value !== 'each' && value !== 'pack' && value !== 'kg' && value !== 'l')
    throw new BadRequestException('Unit must be each, pack, kg or l');
  return value;
}
export function productInput(value: unknown): ProductInput {
  const body = objectInput(value);
  const sku = textInput(body.sku, 'SKU', 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(sku))
    throw new BadRequestException(
      'SKU may contain letters, digits, dots, hyphens and underscores',
    );
  if (!Array.isArray(body.barcodes) || body.barcodes.length > 5)
    throw new BadRequestException('Provide up to five barcodes');
  const barcodes = body.barcodes.map((value: unknown) => {
    const code = textInput(value, 'barcode', 64);
    if (!/^[A-Za-z0-9._-]+$/.test(code))
      throw new BadRequestException('Invalid barcode');
    return code;
  });
  if (new Set(barcodes).size !== barcodes.length)
    throw new BadRequestException('Duplicate barcode');
  if (typeof body.active !== 'boolean')
    throw new BadRequestException('Provide product status');
  return {
    sku,
    name: textInput(body.name, 'product name', 160),
    categoryId:
      body.categoryId === null ? null : uuidInput(body.categoryId, 'category'),
    unit: unitInput(body.unit),
    priceMinor: priceInput(body.price),
    taxCode:
      body.taxCode === null || body.taxCode === ''
        ? null
        : textInput(body.taxCode, 'tax code', 40),
    barcodes: barcodes.sort(),
    active: body.active,
  };
}
export function commandInput(value: unknown) {
  const body = objectInput(value);
  const reason = textInput(body.reason, 'reason', 200);
  if (reason.length < 3)
    throw new BadRequestException(
      'Reason must contain at least three characters',
    );
  return { requestId: uuidInput(body.requestId, 'request ID'), reason };
}
export function pageInput(value: unknown): number {
  if (value === undefined) return 0;
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,3})$/.test(value) ||
    Number(value) > 2000
  )
    throw new BadRequestException('Invalid page');
  return Number(value);
}
