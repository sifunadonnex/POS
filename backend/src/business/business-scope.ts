import { AsyncLocalStorage } from 'node:async_hooks';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type BusinessScope = {
  userId: string;
  manager: boolean;
  departmentId: string | null;
  tillId: string | null;
};
export const businessScope = new AsyncLocalStorage<BusinessScope>();

// All interpolated identifiers are developer constants; values are validated UUIDs
// loaded from the database by the interceptor, never raw request strings.
export function departmentPredicate(alias: string): string {
  const scope = businessScope.getStore();
  if (!scope) return 'TRUE'; // Internal CLI/test operations have their own authorization.
  if (scope.departmentId)
    return `${alias}.department_id = '${scope.departmentId}'::uuid`;
  return scope.manager ? 'TRUE' : 'FALSE';
}
export function selectedDepartment(): string | null {
  return businessScope.getStore()?.departmentId ?? null;
}
export function departmentValue(): string {
  const id = selectedDepartment();
  return id ? `'${id}'::uuid` : 'NULL';
}
export function tillValue(): string {
  const id = businessScope.getStore()?.tillId;
  return id ? `'${id}'::uuid` : 'NULL';
}
export function requireDepartment(): void {
  if (businessScope.getStore() && !selectedDepartment())
    throw new ConflictException(
      'Select a department and till before starting this operation.',
    );
}

// Recheck grants inside the business transaction, before idempotent replay.
// Administration takes an exclusive lock on the staff row before changing grants.
export async function verifyBusinessScope(client: PoolClient, userId: string) {
  const scope = businessScope.getStore();
  if (!scope) return;
  const staff = await client.query<{ role: string }>(
    'SELECT role FROM "user" WHERE id = $1 FOR SHARE',
    [userId],
  );
  if (!staff.rows[0] || scope.userId !== userId)
    throw new ForbiddenException('Verify staff access again');
  if (scope.departmentId) {
    const result = await client.query(
      `SELECT d.id FROM business_department d JOIN business_branch b ON b.id = d.branch_id
       WHERE d.id = $1 AND d.active AND b.active AND ($2::boolean OR EXISTS (
         SELECT 1 FROM staff_department_access a WHERE a.user_id = $3 AND a.department_id = d.id
         AND (a.home OR a.expires_at > now()))) FOR SHARE OF d, b`,
      [scope.departmentId, staff.rows[0].role === 'manager', userId],
    );
    if (!result.rowCount)
      throw new ForbiddenException('Department access expired or was revoked');
  } else if (staff.rows[0].role !== 'manager') {
    throw new ForbiddenException(
      'Ask a manager to assign your home department',
    );
  }
  if (scope.tillId) {
    const result = await client.query(
      'SELECT id FROM business_till WHERE id = $1 AND department_id = $2 AND active FOR SHARE',
      [scope.tillId, scope.departmentId],
    );
    if (!result.rowCount)
      throw new ForbiddenException('This till is unavailable');
  }
}

export async function verifyResourceScope(
  client: PoolClient,
  payload: unknown,
) {
  if (!businessScope.getStore()) return;
  const resources: Record<string, Set<string>> = {};
  const tables: Record<string, string> = {
    productId: 'catalogue_product',
    saleId: 'sale',
    receiptId: 'purchase_receipt',
    shiftId: 'cash_shift',
    orderId: 'suspended_order',
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const table = Object.hasOwn(tables, key) ? tables[key] : undefined;
      if (table && typeof item === 'string')
        (resources[table] ??= new Set()).add(item);
      else visit(item);
    }
    if ('action' in value && 'id' in value && typeof value.id === 'string') {
      if (value.action === 'product.update' || value.action === 'product.photo')
        (resources.catalogue_product ??= new Set()).add(value.id);
      if (value.action === 'resumed' || value.action === 'cancelled')
        (resources.suspended_order ??= new Set()).add(value.id);
    }
  };
  visit(payload);
  for (const [table, ids] of Object.entries(resources)) {
    const result = await client.query(
      `SELECT id FROM ${table} scoped WHERE id = ANY($1::uuid[]) AND ${departmentPredicate('scoped')} FOR SHARE`,
      [[...ids]],
    );
    if (result.rowCount !== ids.size)
      throw new ForbiddenException(
        'An item or document belongs to another department or is unavailable',
      );
  }
}
