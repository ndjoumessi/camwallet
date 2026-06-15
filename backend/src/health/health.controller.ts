import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { readFileSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8'));

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check() {
    return {
      status: 'ok',
      version: pkg.version,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
