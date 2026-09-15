import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
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
import { AUTH_MAILER, type AuthMailer } from './auth-mail.js';
import { AuthMailQueue } from './auth-mail-queue.js';
import { AuthHttpAudit } from './auth-http-audit.js';
import { StaffAdminService } from './staff-admin.service.js';
import { StaffAdminController } from './staff-admin.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    AuthMailQueue,
    AuthHttpAudit,
    {
      provide: AUTH_CONFIG,
      useFactory: () => parseAuthEnvironment(process.env),
    },
    {
      provide: AUTH_MAILER,
      useExisting: AuthMailQueue,
    },
    {
      provide: AUTH,
      inject: [DatabaseService, AUTH_CONFIG, AUTH_MAILER],
      useFactory: (
        db: DatabaseService,
        config: AuthConfig,
        mailer: AuthMailer,
      ) => createAuth(db.connectionPool, config, mailer),
    },
  ],
  exports: [AUTH, AUTH_CONFIG, AuthHttpAudit],
})
export class AuthProviderModule {}

@Module({
  imports: [
    DatabaseModule,
    AuthProviderModule,
    AuthModule.forRootAsync({
      imports: [AuthProviderModule],
      inject: [AUTH, AuthHttpAudit],
      disableGlobalAuthGuard: true,
      useFactory: (auth: PayGoAuth, audit: AuthHttpAudit) => ({
        auth,
        disableTrustedOriginsCors: true,
        middleware: audit.middleware,
      }),
    }),
  ],
  controllers: [IdentityController, StaffAdminController],
  providers: [StaffAdminService, { provide: APP_GUARD, useClass: StaffGuard }],
})
export class IdentityModule {}
