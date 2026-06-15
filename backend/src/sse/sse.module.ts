import { Module } from '@nestjs/common';
import { SseService } from './sse.service';
export { SseService };
@Module({ providers: [SseService], exports: [SseService] })
export class SseModule {}
