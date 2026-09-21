import { BadRequestException } from '@nestjs/common';

export type InventoryUnit = 'each' | 'pack' | 'kg' | 'l';

export type InventoryAdjustmentInput = {
  productId: string;
  quantity: number;
  reason: string;
  requestId: string;
};

export function uuidInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`Provide a valid ${field}`);
  }
  const trimmed = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    )
  ) {
    throw new BadRequestException(`Provide a valid ${field}`);
  }
  return trimmed;
}

export function textInput(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`Provide a ${field}`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BadRequestException(
      `${field} must be ${max} characters or fewer`,
    );
  }
  return trimmed;
}

export function quantityInput(
  value: unknown,
  unit: InventoryUnit,
  field = 'quantity',
): number {
  if (typeof value === 'string' && value.trim() === '') {
    throw new BadRequestException(`Provide a ${field}`);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new BadRequestException(`Provide a valid ${field}`);
  }

  if (unit === 'each' || unit === 'pack') {
    if (!Number.isSafeInteger(numeric)) {
      throw new BadRequestException(
        `${field} must be a whole number for ${unit}`,
      );
    }
    return numeric;
  }

  if (Math.abs(numeric) > 1000000) {
    throw new BadRequestException(`${field} must be a valid value for ${unit}`);
  }
  const minor = Number((numeric * 1000).toFixed(3));
  if (!Number.isFinite(minor) || Math.abs(minor - numeric * 1000) > 1e-8) {
    throw new BadRequestException(
      `${field} must have a precision of 0.001 for ${unit}`,
    );
  }
  return numeric;
}

export function requestInput(value: unknown): {
  requestId: string;
  reason: string;
} {
  const body =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    requestId: uuidInput(body.requestId, 'requestId'),
    reason: textInput(body.reason, 'reason', 200),
  };
}
