import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';

@Module({
  imports: [StorageModule],
  providers: [BooksService],
  controllers: [BooksController],
})
export class BooksModule {}
