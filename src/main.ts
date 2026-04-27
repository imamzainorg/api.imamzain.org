import 'reflect-metadata';
import * as Sentry from '@sentry/node';

if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/v1');

  app.use(helmet());

  app.use(require('compression')());

  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  const isProduction = process.env.NODE_ENV === 'production';

  app.enableCors({
    origin: isProduction && allowedOriginsEnv
      ? allowedOriginsEnv.split(',').map((o) => o.trim())
      : true,
    credentials: true,
    optionsSuccessStatus: 200,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Server running on port ${port}`, 'Bootstrap');
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`, 'Bootstrap');
  logger.log(`Health: http://localhost:${port}/api/v1/health`, 'Bootstrap');
  logger.log(`R2 Bucket: ${process.env.R2_BUCKET ?? 'not configured'}`, 'Bootstrap');
  logger.log(`Sentry: ${process.env.SENTRY_DSN && isProduction ? 'enabled' : 'disabled'}`, 'Bootstrap');
}

bootstrap();
