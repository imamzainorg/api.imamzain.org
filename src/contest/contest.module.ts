import { Module } from '@nestjs/common';
import { ContestController } from './contest.controller';
import { ContestService } from './contest.service';

@Module({
  providers: [ContestService],
  controllers: [ContestController],
})
export class ContestModule {}
