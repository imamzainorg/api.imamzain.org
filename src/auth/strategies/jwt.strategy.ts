import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // env validation guarantees JWT_SECRET is present before this module
    // is instantiated. Falling back to '' would silently accept tokens
    // signed with the empty secret, so we throw instead.
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; username: string; permissions: string[]; token_version?: number }) {
    const user = await this.prisma.users.findFirst({
      where: { id: payload.sub, deleted_at: null },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    if (payload.token_version !== undefined && user.token_version !== payload.token_version) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    return { id: user.id, username: user.username, permissions: payload.permissions };
  }
}
