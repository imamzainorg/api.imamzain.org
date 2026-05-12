import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { YoutubeController } from './youtube.controller';
import { YoutubeService } from './youtube.service';
import { YoutubeSyncService } from './youtube-sync.service';

/**
 * The sync service runs on a 6-hour cron, but on first boot we also fire
 * a single sync after a 30-second delay so a freshly-deployed server
 * isn't empty until the first cron tick (~6h later in the worst case).
 *
 * The delay lets HTTP traffic settle first; the sync itself runs in the
 * background and never blocks the request path.
 */
@Module({
  providers: [YoutubeService, YoutubeSyncService],
  controllers: [YoutubeController],
  exports: [YoutubeService, YoutubeSyncService],
})
export class YoutubeModule implements OnApplicationBootstrap {
  constructor(private readonly sync: YoutubeSyncService) {}

  onApplicationBootstrap() {
    setTimeout(() => {
      void this.sync.sync('bootstrap');
    }, 30_000);
  }
}
