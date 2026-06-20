import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AudiosController } from './audios.controller';
import { AudiosService } from './audios.service';

@Module({
  imports: [StorageModule],
  providers: [AudiosService],
  controllers: [AudiosController],
})
export class AudiosModule {}
