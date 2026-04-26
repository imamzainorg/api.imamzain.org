import { Module } from '@nestjs/common';
import { PostCategoriesController } from './post-categories.controller';
import { PostCategoriesService } from './post-categories.service';

@Module({
  providers: [PostCategoriesService],
  controllers: [PostCategoriesController],
})
export class PostCategoriesModule {}
