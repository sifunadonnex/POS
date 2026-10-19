import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import {
  departmentPredicate,
  requireDepartment,
} from '../business/business-scope.js';
import { uuidInput } from '../catalogue/catalogue.input.js';
import { requestInput } from './inventory.input.js';
import { InventoryWrites, type InventoryActor } from './inventory-writes.js';

@Injectable()
export class ValuationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(InventoryWrites) private readonly writes: InventoryWrites,
  ) {}

  async opening(actor: InventoryActor, value: unknown) {
    requireDepartment();
    const body: Record<string, unknown> =
      value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
    const productId = uuidInput(body.productId, 'product');
    const input = requestInput(value);
    const quantity = body.expectedQuantityMinor,
      total = body.totalValueMinor;
    if (
      typeof quantity !== 'string' ||
      !/^[1-9]\d*$/.test(quantity) ||
      BigInt(quantity) > 9223372036854775807n ||
      typeof total !== 'string' ||
      !/^\d+$/.test(total) ||
      BigInt(total) > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new BadRequestException(
        'Provide the current quantity and a non-negative total stock value in minor units',
      );
    return this.writes.execute(
      actor,
      input.requestId,
      input.reason,
      {
        productId,
        expectedQuantityMinor: quantity,
        totalValueMinor: total,
        kind: 'valuation.opening',
      },
      async (client) => {
        const product = await client.query<{ id: string; quantity: string }>(
          `SELECT p.id, COALESCE(s.quantity_minor, 0)::text AS quantity
          FROM catalogue_product p LEFT JOIN inventory_stock s ON s.product_id = p.id
          WHERE ${departmentPredicate('p')} AND p.id = $1 FOR UPDATE OF p`,
          [productId],
        );
        if (!product.rowCount) throw new NotFoundException('Product not found');
        if (product.rows[0].quantity !== quantity)
          throw new ConflictException(
            'Stock changed. Reload before entering its opening value.',
          );
        await client.query(
          `INSERT INTO stock_valuation(product_id, quantity_minor, value_minor) VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
          [productId, quantity],
        );
        const pool = await client.query<{
          value_minor: string | null;
          quantity_minor: string;
        }>(
          'SELECT value_minor::text, quantity_minor::text FROM stock_valuation WHERE product_id = $1 FOR UPDATE',
          [productId],
        );
        if (
          pool.rows[0].value_minor !== null ||
          pool.rows[0].quantity_minor !== quantity
        )
          throw new ConflictException(
            'This balance is already valued or has changed. Reload its valuation.',
          );
        await client.query(
          'UPDATE stock_valuation SET value_minor = $2 WHERE product_id = $1',
          [productId, total],
        );
        await client.query(
          `INSERT INTO stock_cost_entry(id, product_id, quantity_after_minor, value_after_minor, actor_id, reason)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            productId,
            quantity,
            total,
            actor.userId,
            input.reason,
          ],
        );
        return { productId, quantityMinor: quantity, valueMinor: total };
      },
    );
  }

  async position(day: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new BadRequestException('Provide a valid trading date');
    try {
      const products = await this.database.connectionPool.query<{
        productId: string;
        name: string;
        sku: string;
        unit: string;
        quantityMinor: string;
        valueMinor: string | null;
        departmentLabel: string;
      }>(`SELECT p.id AS "productId", p.name, p.sku, p.unit, s.quantity_minor::text AS "quantityMinor",
       CASE WHEN v.quantity_minor = s.quantity_minor THEN v.value_minor::text END AS "valueMinor",
       COALESCE(b.name || ' · ' || d.name, 'Unassigned stock') AS "departmentLabel"
       FROM catalogue_product p JOIN inventory_stock s ON s.product_id = p.id
       LEFT JOIN stock_valuation v ON v.product_id = p.id
       LEFT JOIN business_department d ON d.id = p.department_id LEFT JOIN business_branch b ON b.id = d.branch_id
       WHERE ${departmentPredicate('p')} AND s.quantity_minor > 0
       ORDER BY (v.value_minor IS NULL OR v.quantity_minor <> s.quantity_minor) DESC, p.name, p.id LIMIT 100`);
      const departments = await this.database.connectionPool.query<{
        departmentId: string | null;
        label: string;
        stockValueMinor: string;
        unvaluedProducts: number;
        netSalesMinor: string;
        netCostMinor: string;
        missingCostLines: number;
        grossProfitMinor: string | null;
      }>(
        `WITH stock AS (
       SELECT p.department_id, COALESCE(SUM(v.value_minor) FILTER (WHERE v.quantity_minor = s.quantity_minor), 0) AS value,
         COUNT(*) FILTER (WHERE s.quantity_minor > 0 AND (v.value_minor IS NULL OR v.quantity_minor <> s.quantity_minor))::int AS missing
       FROM catalogue_product p JOIN inventory_stock s ON s.product_id = p.id
       LEFT JOIN stock_valuation v ON v.product_id = p.id WHERE ${departmentPredicate('p')} GROUP BY p.department_id
     ), sold AS (
       SELECT s.department_id, SUM(sl.line_total_minor) AS revenue, COALESCE(-SUM(c.value_delta_minor), 0) AS cost,
         COUNT(*) FILTER (WHERE c.value_delta_minor IS NULL)::int AS missing
       FROM sale s JOIN sale_line sl ON sl.sale_id = s.id LEFT JOIN stock_cost_entry c ON c.sale_line_id = sl.id
       WHERE ${departmentPredicate('s')} AND s.status = 'completed' AND (s.created_at AT TIME ZONE 'Africa/Nairobi')::date = $1::date GROUP BY s.department_id
     ), refunded AS (
       SELECT s.department_id, SUM(r.amount_minor) AS revenue FROM sale_refund r JOIN sale s ON s.id = r.sale_id
       WHERE ${departmentPredicate('s')} AND r.status = 'paid' AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date = $1::date GROUP BY s.department_id
     ), restored AS (
       SELECT s.department_id, COALESCE(SUM(c.value_delta_minor), 0) AS cost,
         COUNT(*) FILTER (WHERE c.value_delta_minor IS NULL)::int AS missing
       FROM sale_return r JOIN sale s ON s.id = r.sale_id JOIN sale_return_line rl ON rl.return_id = r.id
       LEFT JOIN stock_cost_entry c ON c.return_line_id = rl.id
       WHERE ${departmentPredicate('s')} AND r.status = 'completed' AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date = $1::date GROUP BY s.department_id
     ), ids AS (SELECT department_id FROM stock UNION SELECT department_id FROM sold UNION SELECT department_id FROM refunded UNION SELECT department_id FROM restored),
     totals AS (SELECT ids.department_id, COALESCE(b.name || ' · ' || d.name, 'Unassigned history / stock') AS label,
       COALESCE(stock.value, 0) AS value, COALESCE(stock.missing, 0) AS unvalued,
       COALESCE(sold.revenue, 0) - COALESCE(refunded.revenue, 0) AS revenue,
       COALESCE(sold.cost, 0) - COALESCE(restored.cost, 0) AS cost,
       COALESCE(sold.missing, 0) + COALESCE(restored.missing, 0) AS missing
       FROM ids LEFT JOIN stock ON stock.department_id IS NOT DISTINCT FROM ids.department_id
       LEFT JOIN sold ON sold.department_id IS NOT DISTINCT FROM ids.department_id
       LEFT JOIN refunded ON refunded.department_id IS NOT DISTINCT FROM ids.department_id
       LEFT JOIN restored ON restored.department_id IS NOT DISTINCT FROM ids.department_id
       LEFT JOIN business_department d ON d.id = ids.department_id LEFT JOIN business_branch b ON b.id = d.branch_id)
       SELECT department_id AS "departmentId", label, value::text AS "stockValueMinor", unvalued::int AS "unvaluedProducts",
         revenue::text AS "netSalesMinor", cost::text AS "netCostMinor", missing::int AS "missingCostLines",
         CASE WHEN missing = 0 THEN (revenue - cost)::text END AS "grossProfitMinor" FROM totals ORDER BY label`,
        [day],
      );
      return { day, products: products.rows, departments: departments.rows };
    } catch {
      throw new ServiceUnavailableException(
        'Stock valuation is temporarily unavailable. Reload to retry.',
      );
    }
  }
}
