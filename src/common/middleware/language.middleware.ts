import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LanguageMiddleware implements NestMiddleware {
  use(req: Request & { lang?: string | null }, res: Response, next: NextFunction) {
    const header = req.headers['accept-language'];
    if (!header) {
      req.lang = null;
      return next();
    }

    const firstTag = header.split(',')[0].trim().split(';')[0].trim();
    const langCode = firstTag.split('-')[0].toLowerCase();

    if (/^[a-z]{2}$/.test(langCode)) {
      req.lang = langCode;
    } else {
      req.lang = null;
    }

    next();
  }
}
