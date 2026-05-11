import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

@Module({
  imports: [EmailModule],
  providers: [NewsletterService, CampaignsService],
  controllers: [NewsletterController, CampaignsController],
})
export class NewsletterModule {}
