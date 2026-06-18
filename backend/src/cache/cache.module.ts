import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// Module global : CacheService injectable partout sans réimport.
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class AppCacheModule {}
