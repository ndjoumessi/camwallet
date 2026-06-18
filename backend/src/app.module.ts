import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransactionsModule } from './transactions/transactions.module';
import { QrModule } from './qr/qr.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AdminModule } from './admin/admin.module';
import { KycModule } from './kyc/kyc.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantModule } from './merchant/merchant.module';
import { DisputesModule } from './disputes/disputes.module';
import { SseModule } from './sse/sse.module';
import { CamPayModule } from './campay/campay.module';
import { HealthModule } from './health/health.module';
import { AlertsModule } from './alerts/alerts.module';
import { IpWhitelistMiddleware } from './common/middleware/ip-whitelist.middleware';
import { AdminOriginMiddleware } from './common/middleware/admin-origin.middleware';

@Module({
  imports: [
    // Configuration globale
    ConfigModule.forRoot({ isGlobal: true }),

    // Tâches planifiées (expiration des retraits PENDING)
    ScheduleModule.forRoot(),

    // Rate limiting
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),

    // Bus d'événements pour le temps réel (SSE)
    EventEmitterModule.forRoot(),

    // Modules métier
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    QrModule,
    WebhooksModule,
    AdminModule,
    KycModule,
    NotificationsModule,
    CloudinaryModule,
    MerchantModule,
    DisputesModule,
    SseModule,
    CamPayModule,
    HealthModule,
    AlertsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(IpWhitelistMiddleware, AdminOriginMiddleware)
      .forRoutes({ path: 'api/v1/admin/*path', method: RequestMethod.ALL });
  }
}
