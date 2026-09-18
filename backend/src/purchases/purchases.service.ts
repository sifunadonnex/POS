import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type PurchaseActor, PurchasesWrites } from './purchases-writes.js';

export type PurchaseLineInput = {
  productId: string;
  quantity: number;
  unitCostMinor: number;
};

@Injectable()
export class PurchasesService {
  constructor(
    @Inject(PurchasesWrites) private readonly writes: PurchasesWrites,
  ) {}

  private toMinor(quantity: number, unit: 'each' | 'pack' | 'kg' | 'l'): number {
    if (unit === 'each' || unit === 'pack') {
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException(`Quantity must be a whole number for ${unit}`);
      }
      return quantity;
    }
    return Math.round(quantity * 1000);
  }

  async receive(actor: PurchaseActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId : null;
    const supplierId = typeof body.supplierId === 'string' && body.supplierId.trim() ? body.supplierId : null;
    const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim() : null;
    const lines = Array.isArray(body.lines) ? body.lines : null;

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!supplierId) throw new BadRequestException('Provide a valid supplier ID');
    if (!reason) throw new BadRequestException('Reason must contain at least three characters');
    if (!lines || lines.length === 0) throw new BadRequestException('Provide at least one receipt line');

    return this.writes.execute(
      actor,
      requestId,
      { supplierId, reason, lines },
      async (client) => {
        const supplier = await client.query<{ id: string }>(
          'SELECT id, name FROM supplier WHERE id = $1 FOR UPDATE',
          [supplierId],
        );
        if (!supplier.rowCount) {
          throw new NotFoundException('Supplier not found');
        }

        let totalMinor = 0n;
        const receiptId = randomUUID();
        const receipt = await client.query<{ id: string }>(
          `INSERT INTO purchase_receipt (id, supplier_id, actor_id, reason, total_minor, status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'received', now()) RETURNING id`,
          [receiptId, supplierId, actor.userId, reason, 0],
        );

        for (const line of lines) {
          if (!line || typeof line !== 'object' || Array.isArray(line)) {
            throw new BadRequestException('Receipt line must be an object');
          }
          const candidate = line as Record<string, unknown>;
          const productId = typeof candidate.productId === 'string' && candidate.productId.trim() ? candidate.productId : null;
          const quantity = Number(candidate.quantity);
          const unitCostMinor = Number(candidate.unitCostMinor);

          if (!productId) throw new BadRequestException('Receipt line must include productId');
          if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Receipt quantity must be positive');
          if (!Number.isFinite(unitCostMinor) || unitCostMinor < 0 || !Number.isInteger(unitCostMinor)) {
            throw new BadRequestException('Receipt line unit cost must be a non-negative integer minor amount');
          }

          const product = await client.query<{
            id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            active: boolean;
            quantity_minor: number;
          }>(
            `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
            FROM catalogue_product p
            LEFT JOIN inventory_stock s ON s.product_id = p.id
            WHERE p.id = $1 FOR UPDATE`,
            [productId],
          );
          const row = product.rows[0];
          if (!row) throw new NotFoundException('Product not found');
          if (!row.active) throw new ConflictException('Only active products can be received');

          const quantityMinor = this.toMinor(quantity, row.unit);
          const current = Number(row.quantity_minor ?? 0);
          const after = current + quantityMinor;
          const lineTotal = BigInt(quantityMinor) * BigInt(unitCostMinor) / 1000n;
          totalMinor += lineTotal;

          await client.query(
            `INSERT INTO purchase_receipt_line (id, receipt_id, product_id, quantity_minor, unit_cost_minor, line_total_minor, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [randomUUID(), receipt.rows[0].id, productId, quantityMinor, unitCostMinor, Number(lineTotal)],
          );

          await client.query(
            `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (product_id) DO UPDATE SET
            unit = EXCLUDED.unit,
            quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
            updated_at = now()`,
            [productId, row.unit, quantityMinor],
          );

          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), productId, 'receive', quantityMinor, after, actor.userId, reason],
          );
        }

        await client.query(
          `UPDATE purchase_receipt SET total_minor = $1 WHERE id = $2`,
          [Number(totalMinor), receipt.rows[0].id],
        );

        return {
          receiptId: receipt.rows[0].id,
          supplierId,
          totalMinor: Number(totalMinor),
          status: 'received',
        };
      },
    );
  }

  async returnReceipt(actor: PurchaseActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId : null;
    const receiptId = typeof body.receiptId === 'string' && body.receiptId.trim() ? body.receiptId : null;
    const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim() : null;
    const lines = Array.isArray(body.lines) ? body.lines : null;

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!receiptId) throw new BadRequestException('Provide a valid receipt ID');
    if (!reason) throw new BadRequestException('Reason must contain at least three characters');
    if (!lines || lines.length === 0) throw new BadRequestException('Provide at least one return line');

    return this.writes.execute(
      actor,
      requestId,
      { receiptId, reason, lines },
      async (client) => {
        const receipt = await client.query<{
          id: string;
          supplier_id: string;
          total_minor: number;
          status: string;
        }>(
          'SELECT id, supplier_id, total_minor, status FROM purchase_receipt WHERE id = $1 FOR UPDATE',
          [receiptId],
        );
        if (!receipt.rowCount) {
          throw new NotFoundException('Purchase receipt not found');
        }
        if (receipt.rows[0].status !== 'received') {
          throw new ConflictException('Only received purchase receipts can be returned');
        }

        let totalMinor = 0n;
        const returnResult = await client.query<{ id: string }>(
          `INSERT INTO purchase_return (id, receipt_id, actor_id, reason, total_minor, status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'returned', now()) RETURNING id`,
          [randomUUID(), receiptId, actor.userId, reason, 0],
        );

        for (const line of lines) {
          if (!line || typeof line !== 'object' || Array.isArray(line)) {
            throw new BadRequestException('Receipt return line must be an object');
          }
          const candidate = line as Record<string, unknown>;
          const productId = typeof candidate.productId === 'string' && candidate.productId.trim() ? candidate.productId : null;
          const quantityMinor = Number(candidate.quantityMinor);

          if (!productId) throw new BadRequestException('Return line must include productId');
          if (!Number.isFinite(quantityMinor) || quantityMinor <= 0 || !Number.isInteger(quantityMinor)) {
            throw new BadRequestException('Return line quantityMinor must be a positive integer');
          }

          const receiptLine = await client.query<{
            id: string;
            receipt_id: string;
            product_id: string;
            quantity_minor: number;
            unit_cost_minor: number;
          }>(
            `SELECT id, receipt_id, product_id, quantity_minor, unit_cost_minor
            FROM purchase_receipt_line
            WHERE receipt_id = $1 AND product_id = $2 FOR UPDATE`,
            [receiptId, productId],
          );
          if (!receiptLine.rowCount) {
            throw new NotFoundException('Receipt line not found for this product');
          }

          const source = receiptLine.rows[0];
          if (quantityMinor > Number(source.quantity_minor ?? 0)) {
            throw new ConflictException('Return quantity exceeds the purchased quantity');
          }

          const product = await client.query<{
            id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            active: boolean;
            quantity_minor: number;
          }>(
            `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
            FROM catalogue_product p
            LEFT JOIN inventory_stock s ON s.product_id = p.id
            WHERE p.id = $1 FOR UPDATE`,
            [productId],
          );
          const row = product.rows[0];
          if (!row) throw new NotFoundException('Product not found');
          if (!row.active) throw new ConflictException('Only active products can be returned to the supplier');

          const current = Number(row.quantity_minor ?? 0);
          const after = current - quantityMinor;
          if (after < 0) {
            throw new ConflictException('Insufficient stock to return to supplier');
          }

          const lineTotal = BigInt(quantityMinor) * BigInt(Number(source.unit_cost_minor ?? 0)) / 1000n;
          totalMinor += lineTotal;

          await client.query(
            `INSERT INTO purchase_return_line (id, return_id, receipt_line_id, product_id, quantity_minor, unit_cost_minor, line_total_minor, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
            [randomUUID(), returnResult.rows[0].id, source.id, productId, quantityMinor, Number(source.unit_cost_minor ?? 0), Number(lineTotal)],
          );

          await client.query(
            `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (product_id) DO UPDATE SET
            unit = EXCLUDED.unit,
            quantity_minor = inventory_stock.quantity_minor - EXCLUDED.quantity_minor,
            updated_at = now()`,
            [productId, row.unit, quantityMinor],
          );

          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), productId, 'return', -quantityMinor, after, actor.userId, reason],
          );
        }

        await client.query(
          `UPDATE purchase_return SET total_minor = $1 WHERE id = $2`,
          [Number(totalMinor), returnResult.rows[0].id],
        );

        return {
          returnId: returnResult.rows[0].id,
          receiptId,
          totalMinor: Number(totalMinor),
          status: 'returned',
        };
      },
    );
  }
}
