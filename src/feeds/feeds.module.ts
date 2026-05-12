import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { HomepageService } from './homepage.service';

@Module({
  providers: [FeedsService, HomepageService],
  controllers: [FeedsController],
})
export class FeedsModule {}
