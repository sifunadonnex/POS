export type PricedUnit = 'each' | 'pack' | 'kg' | 'l';

const FRACTIONAL_QUANTITY_SCALE = 1000n;

export function roundedLineTotalMinor(
  quantityMinor: number,
  unitPriceMinor: number,
  unit: PricedUnit,
): bigint {
  const scale =
    unit === 'each' || unit === 'pack' ? 1n : FRACTIONAL_QUANTITY_SCALE;
  const raw = BigInt(quantityMinor) * BigInt(unitPriceMinor);

  return (raw + scale / 2n) / scale;
}
