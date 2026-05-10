import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ImageVariantService } from './image-variant.service';

@Module({
  imports: [StorageModule],
  providers: [MediaService, ImageVariantService],
  controllers: [MediaController],
})
export class MediaModule {}
