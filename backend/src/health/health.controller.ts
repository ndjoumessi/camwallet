import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check() {
    return {
      status: 'ok',
      version: process.env.npm_package_version ?? '2.5.1',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
