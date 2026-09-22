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

  private toMinor(
    quantity: number,
    unit: 'each' | 'pack' | 'kg' | 'l',
  ): number {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }
    if (unit === 'each' || unit === 'pack') {
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException(
          `Quantity must be a whole number for ${unit}`,
        );
      }
      return quantity;
    }
    const minor = Math.round(quantity * 1000);
    if (Math.abs(minor - quantity * 1000) > 1e-8) {
      throw new BadRequestException(
        `Quantity for ${unit} must use increments of 0.001`,
      );
    }
    return minor;
  }

  private lineTotalMinor(
    quantityMinor: number,
    unitCostMinor: number,
    unit: 'each' | 'pack' | 'kg' | 'l',
  ): number {
    const raw = BigInt(quantityMinor) * BigInt(unitCostMinor);
    const total = unit === 'each' || unit === 'pack' ? raw : raw / 1000n;
    if (unit !== 'each' && unit !== 'pack' && raw % 1000n !== 0n) {
      throw new BadRequestException(
        'Line total is fractional in minor units; rounding policy is required',
      );
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BadRequestException('Line total is too large');
    return Number(total);
  }

  async receive(actor: PurchaseActor, value: unknown) {
    const body =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const supplierId =
      typeof body.supplierId === 'string' && body.supplierId.trim()
        ? body.supplierId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const lines = Array.isArray(body.lines) ? body.lines : null;

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!supplierId)
      throw new BadRequestException('Provide a valid supplier ID');
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    if (!lines || lines.length === 0)
      throw new BadRequestException('Provide at least one receipt line');

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
        const resolvedLines: Array<{
          productId: string;
          quantityMinor: number;
          unitCostMinor: number;
          unit: 'each' | 'pack' | 'kg' | 'l';
          after: number;
          lineTotalMinor: number;
        }> = [];
        const seenProducts = new Set<string>();
        for (const line of lines) {
          if (!line || typeof line !== 'object' || Array.isArray(line)) {
            throw new BadRequestException('Receipt line must be an object');
          }
          const candidate = line as Record<string, unknown>;
          const productId =
            typeof candidate.productId === 'string' &&
            candidate.productId.trim()
              ? candidate.productId
              : null;
          const quantity = Number(candidate.quantity);
          const unitCostMinor = Number(candidate.unitCostMinor);

          if (!productId)
            throw new BadRequestException(
              'Receipt line must include productId',
            );
          if (seenProducts.has(productId))
            throw new BadRequestException(
              'Receipt lines must contain each product only once',
            );
          seenProducts.add(productId);
          if (!Number.isFinite(quantity) || quantity <= 0)
            throw new BadRequestException('Receipt quantity must be positive');
          if (!Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) {
            throw new BadRequestException(
              'Receipt line unit cost must be a non-negative integer minor amount',
            );
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
            WHERE p.id = $1 FOR UPDATE OF p`,
            [productId],
          );
          const row = product.rows[0];
          if (!row) throw new NotFoundException('Product not found');
          if (!row.active)
            throw new ConflictException('Only active products can be received');

          const quantityMinor = this.toMinor(quantity, row.unit);
          const current = Number(row.quantity_minor ?? 0);
          const after = current + quantityMinor;
          const lineTotal = this.lineTotalMinor(
            quantityMinor,
            unitCostMinor,
            row.unit,
          );
          totalMinor += BigInt(lineTotal);
          resolvedLines.push({
            productId,
            quantityMinor,
            unitCostMinor,
            unit: row.unit,
            after,
            lineTotalMinor: lineTotal,
          });
        }

        const receipt = await client.query<{ id: string }>(
          `INSERT INTO purchase_receipt (id, supplier_id, actor_id, reason, total_minor, status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'received', now()) RETURNING id`,
          [receiptId, supplierId, actor.userId, reason, Number(totalMinor)],
        );

        for (const line of resolvedLines) {
          await client.query(
            `INSERT INTO purchase_receipt_line (id, receipt_id, product_id, quantity_minor, unit_cost_minor, line_total_minor, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [
              randomUUID(),
              receipt.rows[0].id,
              line.productId,
              line.quantityMinor,
              line.unitCostMinor,
              line.lineTotalMinor,
            ],
          );
          await client.query(
            `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (product_id) DO UPDATE SET
            unit = EXCLUDED.unit,
            quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
            updated_at = now()`,
            [line.productId, line.unit, line.quantityMinor],
          );
          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              line.productId,
              'receive',
              line.quantityMinor,
              line.after,
              actor.userId,
              reason,
            ],
          );
        }

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
    const body =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const receiptId =
      typeof body.receiptId === 'string' && body.receiptId.trim()
        ? body.receiptId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const lines = Array.isArray(body.lines) ? body.lines : null;

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!receiptId) throw new BadRequestException('Provide a valid receipt ID');
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    if (!lines || lines.length === 0)
      throw new BadRequestException('Provide at least one return line');

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
          throw new ConflictException(
            'Only received purchase receipts can be returned',
          );
        }

        let totalMinor = 0n;
        const resolvedLines: Array<{
          productId: string;
          quantityMinor: number;
          unitCostMinor: number;
          receiptLineId: string;
          unit: 'each' | 'pack' | 'kg' | 'l';
          after: number;
          lineTotalMinor: number;
        }> = [];
        const pendingReturns = new Map<string, number>();
        const seenProducts = new Set<string>();
        for (const line of lines) {
          if (!line || typeof line !== 'object' || Array.isArray(line)) {
            throw new BadRequestException(
              'Receipt return line must be an object',
            );
          }
          const candidate = line as Record<string, unknown>;
          const productId =
            typeof candidate.productId === 'string' &&
            candidate.productId.trim()
              ? candidate.productId
              : null;
          const quantityMinor = Number(candidate.quantityMinor);

          if (!productId)
            throw new BadRequestException('Return line must include productId');
          if (seenProducts.has(productId))
            throw new BadRequestException(
              'Return lines must contain each product only once',
            );
          seenProducts.add(productId);
          if (
            !Number.isFinite(quantityMinor) ||
            quantityMinor <= 0 ||
            !Number.isInteger(quantityMinor)
          ) {
            throw new BadRequestException(
              'Return line quantityMinor must be a positive integer',
            );
          }

          const receiptLine = await client.query<{
            id: string;
            receipt_id: string;
            product_id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            quantity_minor: number;
            unit_cost_minor: number;
          }>(
            `SELECT rl.id, rl.receipt_id, rl.product_id, p.unit, rl.quantity_minor, rl.unit_cost_minor
            FROM purchase_receipt_line rl
            JOIN catalogue_product p ON p.id = rl.product_id
            WHERE rl.receipt_id = $1 AND rl.product_id = $2 FOR UPDATE`,
            [receiptId, productId],
          );
          if (!receiptLine.rowCount) {
            throw new NotFoundException(
              'Receipt line not found for this product',
            );
          }
          if (receiptLine.rowCount > 1)
            throw new ConflictException(
              'Return must identify a unique receipt line',
            );

          const source = receiptLine.rows[0];
          const alreadyReturned = await client.query<{
            quantity_minor: string;
          }>(
            `SELECT COALESCE(SUM(quantity_minor), 0)::text AS quantity_minor
            FROM purchase_return_line prl JOIN purchase_return pr ON pr.id = prl.return_id
            WHERE prl.receipt_line_id = $1 AND pr.status = 'returned'`,
            [source.id],
          );
          const returnedQuantity =
            Number(alreadyReturned.rows[0]?.quantity_minor ?? 0) +
            (pendingReturns.get(source.id) ?? 0);
          if (
            returnedQuantity + quantityMinor >
            Number(source.quantity_minor ?? 0)
          ) {
            throw new ConflictException(
              'Return quantity exceeds the purchased quantity',
            );
          }
          pendingReturns.set(
            source.id,
            (pendingReturns.get(source.id) ?? 0) + quantityMinor,
          );

          const product = await client.query<{
            id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            active: boolean;
            quantity_minor: number;
          }>(
            `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
            FROM catalogue_product p
            LEFT JOIN inventory_stock s ON s.product_id = p.id
            WHERE p.id = $1 FOR UPDATE OF p`,
            [productId],
          );
          const row = product.rows[0];
          if (!row) throw new NotFoundException('Product not found');
          if (!row.active)
            throw new ConflictException(
              'Only active products can be returned to the supplier',
            );

          const current = Number(row.quantity_minor ?? 0);
          const after = current - quantityMinor;
          if (after < 0) {
            throw new ConflictException(
              'Insufficient stock to return to supplier',
            );
          }

          const lineTotal = this.lineTotalMinor(
            quantityMinor,
            Number(source.unit_cost_minor ?? 0),
            source.unit,
          );
          totalMinor += BigInt(lineTotal);
          resolvedLines.push({
            productId,
            quantityMinor,
            unitCostMinor: Number(source.unit_cost_minor ?? 0),
            receiptLineId: source.id,
            unit: row.unit,
            after,
            lineTotalMinor: lineTotal,
          });
        }

        const returnResult = await client.query<{ id: string }>(
          `INSERT INTO purchase_return (id, receipt_id, actor_id, reason, total_minor, status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'returned', now()) RETURNING id`,
          [randomUUID(), receiptId, actor.userId, reason, Number(totalMinor)],
        );

        for (const line of resolvedLines) {
          await client.query(
            `INSERT INTO purchase_return_line (id, return_id, receipt_line_id, product_id, quantity_minor, unit_cost_minor, line_total_minor, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
            [
              randomUUID(),
              returnResult.rows[0].id,
              line.receiptLineId,
              line.productId,
              line.quantityMinor,
              line.unitCostMinor,
              line.lineTotalMinor,
            ],
          );
          await client.query(
            `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (product_id) DO UPDATE SET
            unit = EXCLUDED.unit,
            quantity_minor = inventory_stock.quantity_minor - EXCLUDED.quantity_minor,
            updated_at = now()`,
            [line.productId, line.unit, line.quantityMinor],
          );
          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              line.productId,
              'return',
              -line.quantityMinor,
              line.after,
              actor.userId,
              reason,
            ],
          );
        }

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
