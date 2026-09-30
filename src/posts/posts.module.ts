import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ViewDedupService } from './view-dedup.service';

@Module({
  providers: [PostsService, ViewDedupService],
  controllers: [PostsController],
})
export class PostsModule {}
