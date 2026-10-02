import { Controller, Get, Inject } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import { EdgeSyncService } from './edge-sync.service.js';

@Controller('api/sync')
export class EdgeSyncController {
  constructor(
    @Inject(EdgeSyncService) private readonly edgeSync: EdgeSyncService,
  ) {}

  @Get('status')
  @StaffRoles('cashier', 'manager')
  status() {
    return this.edgeSync.status();
  }
}
