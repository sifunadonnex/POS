import { createHash, createHmac } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { canonicalJson, signaturesMatch } from '../sync/sync-auth.js';

export type BootstrapStaff = {
  id: string;
  name: string;
  email: string;
  role: 'manager' | 'cashier';
  disabled: boolean;
  emailVerified: boolean;
};
export type BootstrapCategory = { id: string; name: string; revision: number };
export type BootstrapProduct = {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unit: 'each' | 'pack' | 'kg' | 'l';
  priceMinor: string;
  taxCode: string | null;
  active: boolean;
  revision: number;
  lowStockThresholdMinor: string | null;
};
export type BootstrapBarcode = { code: string; productId: string };
export type BootstrapStock = { productId: string; quantityMinor: string };
export type BootstrapPayload = {
  staff: BootstrapStaff[];
  categories: BootstrapCategory[];
  products: BootstrapProduct[];
  barcodes: BootstrapBarcode[];
  proposedStock: BootstrapStock[];
};
export type BootstrapBundle = {
  schemaVersion: 1;
  publicationId: string;
  storeId: string;
  generation: number;
  configurationVersion: number;
  publisherId: string;
  createdAt: string;
  expiresAt: string;
  digest: string;
  payload: BootstrapPayload;
  signature: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const integerPattern = /^(0|[1-9][0-9]*)$/;

export function bootstrapDigest(payload: BootstrapPayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export function signBootstrapBundle(
  unsigned: Omit<BootstrapBundle, 'signature'>,
  secret: string,
): BootstrapBundle {
  const signature = createHmac('sha256', secret)
    .update(canonicalJson(unsigned))
    .digest('hex');
  return { ...unsigned, signature };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid bootstrap bundle');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, max = 254): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new BadRequestException('Invalid bootstrap bundle');
  }
  return value;
}

function id(value: unknown): string {
  const result = string(value, 36);
  if (!uuidPattern.test(result))
    throw new BadRequestException('Invalid bootstrap ID');
  return result.toLowerCase();
}

function number(value: unknown, min: number, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== 'number' ||
    value < min ||
    value > max
  ) {
    throw new BadRequestException('Invalid bootstrap number');
  }
  return value;
}

function minor(value: unknown, max: number): string {
  const result = string(value, 13);
  if (!integerPattern.test(result) || Number(result) > max) {
    throw new BadRequestException('Invalid bootstrap quantity');
  }
  return result;
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new BadRequestException('Bootstrap snapshot exceeds its limit');
  }
  return value;
}

function unique(values: string[]): void {
  if (new Set(values).size !== values.length) {
    throw new BadRequestException('Duplicate bootstrap record');
  }
}

export function parseBootstrapPayload(value: unknown): BootstrapPayload {
  const raw = record(value);
  const staff = array(raw.staff, 500).map((entry): BootstrapStaff => {
    const row = record(entry);
    const role = row.role;
    if (role !== 'manager' && role !== 'cashier')
      throw new BadRequestException('Invalid staff role');
    if (
      typeof row.disabled !== 'boolean' ||
      typeof row.emailVerified !== 'boolean'
    ) {
      throw new BadRequestException('Invalid staff eligibility');
    }
    const email = string(row.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException('Invalid staff email');
    return {
      id: string(row.id, 200),
      name: string(row.name, 100),
      email,
      role,
      disabled: row.disabled,
      emailVerified: row.emailVerified,
    };
  });
  const categories = array(raw.categories, 2000).map(
    (entry): BootstrapCategory => {
      const row = record(entry);
      return {
        id: id(row.id),
        name: string(row.name, 80),
        revision: number(row.revision, 1, 2147483647),
      };
    },
  );
  const products = array(raw.products, 20000).map((entry): BootstrapProduct => {
    const row = record(entry);
    const unit = row.unit;
    if (unit !== 'each' && unit !== 'pack' && unit !== 'kg' && unit !== 'l') {
      throw new BadRequestException('Invalid product unit');
    }
    if (typeof row.active !== 'boolean')
      throw new BadRequestException('Invalid product state');
    const sku = string(row.sku, 40);
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku))
      throw new BadRequestException('Invalid SKU');
    return {
      id: id(row.id),
      sku,
      name: string(row.name, 160),
      categoryId: row.categoryId === null ? null : id(row.categoryId),
      unit,
      priceMinor: minor(row.priceMinor, 999999999),
      taxCode: row.taxCode === null ? null : string(row.taxCode, 40),
      active: row.active,
      revision: number(row.revision, 1, 2147483647),
      lowStockThresholdMinor:
        row.lowStockThresholdMinor === null
          ? null
          : minor(row.lowStockThresholdMinor, 999999999999),
    };
  });
  const barcodes = array(raw.barcodes, 30000).map((entry): BootstrapBarcode => {
    const row = record(entry);
    const code = string(row.code, 64);
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(code))
      throw new BadRequestException('Invalid barcode');
    return { code, productId: id(row.productId) };
  });
  const proposedStock = array(raw.proposedStock, 20000).map(
    (entry): BootstrapStock => {
      const row = record(entry);
      return {
        productId: id(row.productId),
        quantityMinor: minor(row.quantityMinor, 999999999999),
      };
    },
  );
  unique(staff.map((row) => row.id));
  unique(staff.map((row) => row.email));
  unique(categories.map((row) => row.id));
  unique(categories.map((row) => row.name.toLowerCase()));
  unique(products.map((row) => row.id));
  unique(products.map((row) => row.sku));
  unique(barcodes.map((row) => row.code));
  unique(proposedStock.map((row) => row.productId));
  const categoryIds = new Set(categories.map((row) => row.id));
  const productIds = new Set(products.map((row) => row.id));
  if (
    products.some(
      (row) => row.categoryId && !categoryIds.has(row.categoryId),
    ) ||
    barcodes.some((row) => !productIds.has(row.productId)) ||
    proposedStock.length !== products.length ||
    proposedStock.some((row) => !productIds.has(row.productId))
  ) {
    throw new BadRequestException('Bootstrap references are incomplete');
  }
  return { staff, categories, products, barcodes, proposedStock };
}

export function verifyBootstrapBundle(
  value: unknown,
  secret: string,
  now = Date.now(),
): BootstrapBundle {
  if (Buffer.byteLength(JSON.stringify(value)) > 8_000_000) {
    throw new BadRequestException('Bootstrap bundle exceeds its size limit');
  }
  const raw = record(value);
  const createdAt = string(raw.createdAt, 40);
  const expiresAt = string(raw.expiresAt, 40);
  const created = Date.parse(createdAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    expires <= created ||
    expires - created > 15 * 60_000 ||
    created > now + 60_000 ||
    expires <= now
  ) {
    throw new ConflictException(
      'Bootstrap publication has expired or has invalid dates',
    );
  }
  const unsigned: Omit<BootstrapBundle, 'signature'> = {
    schemaVersion: number(raw.schemaVersion, 1, 1) as 1,
    publicationId: id(raw.publicationId),
    storeId: id(raw.storeId),
    generation: number(raw.generation, 1, 2147483647),
    configurationVersion: number(
      raw.configurationVersion,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    publisherId: string(raw.publisherId, 200),
    createdAt,
    expiresAt,
    digest: string(raw.digest, 64),
    payload: parseBootstrapPayload(raw.payload),
  };
  const signature = string(raw.signature, 64);
  if (
    unsigned.digest !== bootstrapDigest(unsigned.payload) ||
    !signaturesMatch(signBootstrapBundle(unsigned, secret).signature, signature)
  ) {
    throw new ConflictException('Bootstrap signature or digest is invalid');
  }
  if (
    !unsigned.payload.staff.some(
      (staff) =>
        staff.id === unsigned.publisherId &&
        staff.role === 'manager' &&
        !staff.disabled &&
        staff.emailVerified,
    )
  ) {
    throw new ConflictException(
      'Bootstrap publisher is not an eligible manager',
    );
  }
  return { ...unsigned, signature };
}
