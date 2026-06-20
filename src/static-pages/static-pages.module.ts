import { Module } from '@nestjs/common';
import { StaticPagesController } from './static-pages.controller';
import { StaticPagesService } from './static-pages.service';

@Module({
  providers: [StaticPagesService],
  controllers: [StaticPagesController],
})
export class StaticPagesModule {}
