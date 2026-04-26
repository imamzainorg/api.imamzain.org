import { Module } from '@nestjs/common';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

@Module({
  providers: [NewsletterService],
  controllers: [NewsletterController],
})
export class NewsletterModule {}
