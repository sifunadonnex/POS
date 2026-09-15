import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { SecurityStore } from './security-store.js';

@Injectable()
export class AuthHttpAudit implements OnApplicationShutdown {
  private readonly logger = new Logger('AuthHttpAudit');
  private readonly pending = new Set<Promise<void>>();
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  readonly middleware = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    req.headers['x-paygo-client-ip'] = req.socket.remoteAddress ?? '127.0.0.1';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.once('finish', () => {
      if (res.statusCode < 400) return;
      // Includes router/rate-limit rejections that happen before Better Auth endpoint hooks.
      // Never record URLs (which can carry tokens), request bodies, cookies or raw errors.
      const job = new SecurityStore(this.database.connectionPool)
        .audit({
          action: 'auth.http-rejected',
          outcome: 'denied',
          detail: { statusCode: res.statusCode },
        })
        .catch(() => {
          this.logger.error(
            'A rejected authentication request could not be audited; check database availability',
          );
        })
        .finally(() => {
          this.pending.delete(job);
        });
      this.pending.add(job);
    });
    next();
  };

  async onApplicationShutdown() {
    await Promise.all(this.pending);
  }
}
