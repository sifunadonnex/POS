import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { objectInput, uuidInput } from '../catalogue/catalogue.input.js';
import {
  productColumns,
  productFrom,
  type Product,
} from '../catalogue/catalogue.types.js';
import { DatabaseService } from '../database/database.service.js';
import {
  departmentPredicate,
  requireDepartment,
  selectedDepartment,
} from '../business/business-scope.js';
import { SalesWrites, type SaleActor } from './sales-writes.js';
import { SalesService } from './sales.service.js';
import { CartApprovalService } from './cart-approval.service.js';
import {
  isReduction,
  lockBasket,
  setBasket,
  type RegisterLine,
} from './register-basket.js';

@Injectable()
export class RegisterBasketService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SalesWrites) private readonly writes: SalesWrites,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(CartApprovalService) private readonly approval: CartApprovalService,
  ) {}
  async read(actor: SaleActor) {
    requireDepartment();
    const result = await this.database.connectionPool.query<{
      revision: number;
      lines: RegisterLine[];
    }>(
      'SELECT revision, lines FROM register_basket WHERE user_id = $1 AND department_id = $2',
      [actor.userId, selectedDepartment()],
    );
    const row = result.rows[0] ?? { revision: 0, lines: [] };
    const products = await this.database.connectionPool.query<Product>(
      `SELECT ${productColumns} FROM ${productFrom} WHERE ${departmentPredicate('p')} AND p.id = ANY($1::uuid[])`,
      [row.lines.map((l) => l.productId)],
    );
    return {
      revision: row.revision,
      lines: row.lines.map((line) => ({
        product: products.rows.find((p) => p.id === line.productId),
        quantity: line.quantity,
      })),
    };
  }
  async save(actor: SaleActor, value: unknown) {
    requireDepartment();
    const body = objectInput(value);
    const requestId = uuidInput(body.requestId, 'request ID');
    if (
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0 ||
      !Array.isArray(body.lines)
    )
      throw new BadRequestException('Provide the basket revision and lines');
    const quote = body.lines.length
      ? await this.sales.quoteCurrentBasket(body.lines)
      : { lines: [], totalMinor: 0, subtotalMinor: 0 };
    if (
      new Set(quote.lines.map((line) => line.productId)).size !==
      quote.lines.length
    )
      throw new BadRequestException('Use one basket line per product');
    const lines: RegisterLine[] = quote.lines.map(
      ({ productId, unit, quantity }) => ({ productId, unit, quantity }),
    );
    const approval = await this.approval.prepare(actor.userId, body.approval);
    return this.writes.execute(
      actor,
      requestId,
      { action: 'basket.save', revision: body.revision, lines },
      async (client) => {
        const basket = await lockBasket(client, actor.userId);
        if (
          !basket ||
          (basket.revision !== body.revision &&
            !(body.revision === 0 && basket.revision === 1))
        )
          throw new ConflictException(
            'The basket changed. Reload the register.',
          );
        const role = await client.query<{ role: string }>(
          'SELECT role FROM "user" WHERE id = $1',
          [actor.userId],
        );
        let approverId: string | null = null;
        if (
          role.rows[0]?.role === 'cashier' &&
          isReduction(basket.lines, lines)
        )
          approverId = await this.approval.verify(
            client,
            actor.userId,
            approval,
            { kind: 'basket', revision: basket.revision },
          );
        const before = basket.lines;
        await setBasket(client, actor.userId, lines);
        await client.query(
          "INSERT INTO auth_audit(actor_id, action, outcome, detail) VALUES ($1, 'cart.changed', 'success', $2)",
          [
            actor.userId,
            JSON.stringify({
              departmentId: selectedDepartment(),
              approverId,
              approvalReason: approval?.reason ?? null,
              before,
              after: lines,
            }),
          ],
        );
        return { revision: basket.revision + 1, quote };
      },
    );
  }
}
