import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
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
