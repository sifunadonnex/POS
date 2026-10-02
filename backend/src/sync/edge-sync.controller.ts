import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
} from '@nestjs/common';
import { PublicRoute, StaffRoles } from '../identity/access.metadata.js';
import { EdgeSyncService } from './edge-sync.service.js';
import { HostedSyncService } from './hosted-sync.service.js';

@Controller('api/sync')
export class EdgeSyncController {
  constructor(
    @Inject(EdgeSyncService) private readonly edgeSync: EdgeSyncService,
    @Inject(HostedSyncService) private readonly hostedSync: HostedSyncService,
  ) {}

  @Post('events')
  @HttpCode(200)
  @PublicRoute()
  ingest(
    @Headers('x-paygo-store-id') storeId: string | undefined,
    @Headers('x-paygo-event-id') eventId: string | undefined,
    @Headers('x-paygo-timestamp') timestamp: string | undefined,
    @Headers('x-paygo-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.hostedSync.ingest(
      { storeId, eventId, timestamp, signature },
      body,
    );
  }

  @Get('status')
  @StaffRoles('cashier', 'manager')
  status() {
    return this.edgeSync.status();
  }
}
