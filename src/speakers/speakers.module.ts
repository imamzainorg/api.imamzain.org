import { Module } from '@nestjs/common';
import { SpeakersController } from './speakers.controller';
import { SpeakersService } from './speakers.service';

@Module({
  providers: [SpeakersService],
  controllers: [SpeakersController],
})
export class SpeakersModule {}
