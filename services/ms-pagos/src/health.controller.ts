import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}
  @Get('live') live() { return { status: 'ok', service: 'ms-pagos' }; }
  @Get('ready') async ready() { await this.db.pool.query('SELECT 1'); return { status: 'ready', service: 'ms-pagos' }; }
}
