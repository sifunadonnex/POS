import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { PublicRoute } from '../identity/access.metadata.js';

@Controller('api/health')
@PublicRoute()
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    try {
      await this.database.checkConnection();
      return { status: 'ok', database: 'reachable' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        database: 'unreachable',
      });
    }
  }
}
