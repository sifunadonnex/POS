import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { selectedDepartment } from '../business/business-scope.js';

export type RegisterLine = {
  productId: string;
  unit: string;
  quantity: number;
};
export function canonicalLines(lines: RegisterLine[]): string {
  return JSON.stringify(
    lines
      .map(({ productId, unit, quantity }) => ({ productId, unit, quantity }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
  );
}
export function isReduction(
  previous: RegisterLine[],
  next: RegisterLine[],
): boolean {
  return previous.some((line) => {
    const found = next.find((item) => item.productId === line.productId);
    return !found || found.unit !== line.unit || found.quantity < line.quantity;
  });
}
export async function lockBasket(client: PoolClient, userId: string) {
  const department = selectedDepartment();
  if (!department) return null;
  await client.query(
    'INSERT INTO register_basket(user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, department],
  );
  const result = await client.query<{
    lines: RegisterLine[];
    revision: number;
  }>(
    'SELECT lines, revision FROM register_basket WHERE user_id = $1 AND department_id = $2 FOR UPDATE',
    [userId, department],
  );
  return result.rows[0];
}
export async function setBasket(
  client: PoolClient,
  userId: string,
  lines: RegisterLine[],
) {
  await client.query(
    'UPDATE register_basket SET lines = $3, revision = revision + 1, updated_at = now() WHERE user_id = $1 AND department_id = $2',
    [userId, selectedDepartment(), JSON.stringify(lines)],
  );
}
export async function consumeBasket(
  client: PoolClient,
  userId: string,
  lines: RegisterLine[],
) {
  const basket = await lockBasket(client, userId);
  if (!basket) return;
  if (canonicalLines(basket.lines) !== canonicalLines(lines))
    throw new ConflictException(
      'The basket changed. Reload the register before completing the sale.',
    );
  await setBasket(client, userId, []);
}
