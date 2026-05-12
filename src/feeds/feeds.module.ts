import { Module } from '@nestjs/common';
import { DailyHadithsModule } from '../daily-hadiths/daily-hadiths.module';
import { YoutubeModule } from '../youtube/youtube.module';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { HomepageService } from './homepage.service';

@Module({
  imports: [DailyHadithsModule, YoutubeModule],
  providers: [FeedsService, HomepageService],
  controllers: [FeedsController],
})
export class FeedsModule {}
