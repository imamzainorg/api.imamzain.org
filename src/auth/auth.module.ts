import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JWT_ALGORITHM, JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          // `JWT_EXPIRES_IN` is a string accepted by `ms` (e.g. "15m", "24h").
          // The cast is the @nestjs/jwt type quirk, not real ambiguity. The
          // fallback mirrors the env-validation default (24h); it only applies
          // if ConfigModule is ever wired without `validate`.
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '24h') as unknown as number,
          algorithm: JWT_ALGORITHM,
        },
        // Pin the algorithm on both sides. Verification otherwise accepts
        // whatever `alg` the token header names, which is the classic
        // algorithm-confusion opening the moment a second key type exists.
        verifyOptions: { algorithms: [JWT_ALGORITHM] },
      }),
    }),
  ],
  providers: [AuthService, LoginThrottleService, JwtStrategy, JwtAuthGuard],
  controllers: [AuthController],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
