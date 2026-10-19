import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DatabaseService } from '../database/database.service.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { businessScope, type BusinessScope } from './business-scope.js';
import { uuidInput } from '../catalogue/catalogue.input.js';

@Injectable()
export class BusinessInterceptor implements NestInterceptor {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (
      req.staff &&
      req.path.startsWith('/api/bootstrap/') &&
      req.method === 'POST'
    ) {
      const unsupported = await this.database.connectionPool.query(
        'SELECT 1 FROM business_branch UNION ALL SELECT 1 FROM "user" WHERE role = \'supervisor\' LIMIT 1',
      );
      if (unsupported.rowCount)
        throw new ForbiddenException(
          'Branch and supervisor data are not supported by the legacy offline bootstrap. Keep hosted operation until the signed transport is upgraded.',
        );
    }
    // Identity setup and business setup must work before a home assignment exists.
    if (
      !req.staff ||
      !/^\/api\/(catalogue|sales|inventory|shifts|purchases|returns|stocktake|reports|payments|payment-attempts)(\/|$)/.test(
        req.path,
      )
    )
      return next.handle();
    const manager = req.staff.user.role === 'manager';
    const requested =
      req.headers['x-paygo-department'] ??
      (req.path.endsWith('/photo') ? req.query.departmentId : undefined);
    let departmentId: string | null = requested
      ? uuidInput(requested, 'department')
      : null;
    if (!departmentId && !manager) {
      const home = await this.database.connectionPool.query<{
        department_id: string;
      }>(
        'SELECT department_id FROM staff_department_access WHERE user_id = $1 AND home',
        [req.staff.user.id],
      );
      departmentId = home.rows[0]?.department_id ?? null;
      if (!departmentId)
        throw new ForbiddenException(
          'Ask a manager to assign your home department in Settings.',
        );
    }
    if (departmentId) {
      const allowed = await this.database.connectionPool.query(
        `SELECT d.id FROM business_department d JOIN business_branch b ON b.id = d.branch_id WHERE d.id = $1 AND d.active AND b.active
         AND ($2::boolean OR EXISTS (SELECT 1 FROM staff_department_access a WHERE a.user_id = $3 AND a.department_id = d.id AND (a.home OR a.expires_at > now())))`,
        [departmentId, manager, req.staff.user.id],
      );
      if (!allowed.rowCount)
        throw new ForbiddenException(
          'You do not have access to this department',
        );
    }
    const requestedTill = req.headers['x-paygo-till'];
    const tillId = requestedTill ? uuidInput(requestedTill, 'till') : null;
    if (tillId) {
      const till = await this.database.connectionPool.query(
        'SELECT id FROM business_till WHERE id = $1 AND department_id = $2 AND active',
        [tillId, departmentId],
      );
      if (!till.rowCount)
        throw new BadRequestException(
          'Select a till in the current department',
        );
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !departmentId)
      throw new BadRequestException(
        'Select a department before making operational changes.',
      );
    const scope: BusinessScope = {
      userId: req.staff.user.id,
      manager,
      departmentId,
      tillId,
    };
    return new Observable((subscriber) =>
      businessScope.run(scope, () => {
        const subscription = next.handle().subscribe(subscriber);
        return () => subscription.unsubscribe();
      }),
    );
  }
}
