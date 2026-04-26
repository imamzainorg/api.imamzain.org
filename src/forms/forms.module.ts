import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

@Module({
  imports: [EmailModule, WhatsappModule],
  providers: [FormsService],
  controllers: [FormsController],
})
export class FormsModule {}
