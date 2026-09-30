import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FormNotificationsService } from './form-notifications.service';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

@Module({
  imports: [EmailModule, WhatsappModule],
  providers: [FormsService, FormNotificationsService],
  controllers: [FormsController],
})
export class FormsModule {}
