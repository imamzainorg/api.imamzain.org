import { Module } from '@nestjs/common';
import { DailyHadithsController } from './daily-hadiths.controller';
import { DailyHadithsService } from './daily-hadiths.service';

@Module({
  providers: [DailyHadithsService],
  controllers: [DailyHadithsController],
  exports: [DailyHadithsService],
})
export class DailyHadithsModule {}
