import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard, RateLimitStore } from './rate-limit.js';

@Module({
  providers: [RateLimitStore, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [RateLimitStore],
})
export class SecurityModule {}
