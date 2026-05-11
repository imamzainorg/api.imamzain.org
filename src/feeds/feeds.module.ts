import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';

@Module({
  providers: [FeedsService],
  controllers: [FeedsController],
})
export class FeedsModule {}
