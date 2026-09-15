import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { PublicRoute } from './identity/access.metadata.js';

@Controller()
@PublicRoute()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
