import { Module } from '@nestjs/common';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';

@Module({
  providers: [GalleryService],
  controllers: [GalleryController],
})
export class GalleryModule {}
