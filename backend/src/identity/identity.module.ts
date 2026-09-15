import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import type { Request, Response, NextFunction } from 'express';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  AUTH_CONFIG,
  parseAuthEnvironment,
  type AuthConfig,
} from './auth.config.js';
import { AUTH, createAuth, type PayGoAuth } from './auth.js';
import { IdentityController } from './identity.controller.js';
import { StaffGuard } from './staff.guard.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => parseAuthEnvironment(process.env),
    },
    {
      provide: AUTH,
      inject: [DatabaseService, AUTH_CONFIG],
      useFactory: (db: DatabaseService, config: AuthConfig) =>
        createAuth(db.connectionPool, config),
    },
  ],
  exports: [AUTH],
})
export class AuthProviderModule {}

@Module({
  imports: [
    AuthProviderModule,
    AuthModule.forRootAsync({
      imports: [AuthProviderModule],
      inject: [AUTH],
      disableGlobalAuthGuard: true,
      useFactory: (auth: PayGoAuth) => ({
        auth,
        disableTrustedOriginsCors: true,
        middleware: (req: Request, res: Response, next: NextFunction) => {
          // Never trust an IP header supplied by the browser. Local Vite proxy shares loopback limits.
          req.headers['x-paygo-client-ip'] =
            req.socket.remoteAddress ?? '127.0.0.1';
          res.setHeader('Cache-Control', 'no-store');
          next();
        },
      }),
    }),
  ],
  controllers: [IdentityController],
  providers: [{ provide: APP_GUARD, useClass: StaffGuard }],
})
export class IdentityModule {}
