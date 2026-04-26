import { Module } from '@nestjs/common';
import { BookCategoriesController } from './book-categories.controller';
import { BookCategoriesService } from './book-categories.service';

@Module({
  providers: [BookCategoriesService],
  controllers: [BookCategoriesController],
})
export class BookCategoriesModule {}
