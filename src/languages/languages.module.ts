import { Module } from '@nestjs/common';
import { LanguagesController } from './languages.controller';
import { LanguagesService } from './languages.service';

@Module({
  providers: [LanguagesService],
  controllers: [LanguagesController],
})
export class LanguagesModule {}
