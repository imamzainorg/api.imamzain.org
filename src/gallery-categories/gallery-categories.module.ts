import { Module } from '@nestjs/common';
import { GalleryCategoriesController } from './gallery-categories.controller';
import { GalleryCategoriesService } from './gallery-categories.service';

@Module({
  providers: [GalleryCategoriesService],
  controllers: [GalleryCategoriesController],
})
export class GalleryCategoriesModule {}
