import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

// Les montants/soldes sont des BigInt (centimes FCFA). JSON.stringify ne sait
// pas sérialiser un BigInt — on le convertit en nombre pour toutes les réponses.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // Sécurité
  app.use(helmet());
  app.use(compression());

  // CORS
  app.enableCors({
    origin: nodeEnv === 'production'
      ? ['https://admin.camwallet.cm', 'https://app.camwallet.cm']
      : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  // Validation globale
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Préfixe API
  app.setGlobalPrefix('api/v1');

  // Swagger (désactivé en production)
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('CamWallet API')
      .setDescription('API REST CamWallet — Paiement QR Cameroun')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentification & OTP')
      .addTag('wallet', 'Portefeuille & solde')
      .addTag('transactions', 'Transactions P2P & QR')
      .addTag('qr', 'Génération & lecture QR Code')
      .addTag('webhooks', 'Webhooks OM/MoMo')
      .addTag('admin', 'Dashboard administration')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log(`Swagger disponible sur http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`🚀 CamWallet API démarrée sur http://localhost:${port}/api/v1`);
}

bootstrap();
