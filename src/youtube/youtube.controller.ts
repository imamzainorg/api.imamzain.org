import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { YoutubePlaylistQueryDto, YoutubePlaylistVideoQueryDto, YoutubeVideoQueryDto } from './dto/youtube.dto';
import {
  YoutubePlaylistListResponseDto,
  YoutubePlaylistVideosResponseDto,
  YoutubeVideoListResponseDto,
} from './dto/youtube-response.dto';
import { YoutubeService } from './youtube.service';

@ApiTags('YouTube')
@Controller('youtube')
export class YoutubeController {
  constructor(private readonly service: YoutubeService) {}

  @Get('videos')
  @PublicCache(900, 3600)
  @ApiOperation({
    summary: 'List YouTube videos (public, paginated)',
    description:
      'Returns the channel\'s uploaded videos plus any video that appears in one of the channel\'s playlists, ordered by `published_at` descending. Reads from the local mirror — the API syncs from YouTube every 6 hours, so the data may lag YouTube by up to that window. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`).',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: YoutubeVideoListResponseDto, description: 'Paginated video list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid pagination query (page < 1, limit out of 1–100, or non-integer values)' })
  findVideos(@Query() query: YoutubeVideoQueryDto) {
    return this.service.findVideos(query.page ?? 1, query.limit ?? 20);
  }

  @Get('playlists')
  @PublicCache(900, 3600)
  @ApiOperation({
    summary: 'List YouTube playlists (public, paginated)',
    description:
      'Returns the channel\'s public playlists. Reads from the local mirror. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`).',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: YoutubePlaylistListResponseDto, description: 'Paginated playlist list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid pagination query (page < 1, limit out of 1–100, or non-integer values)' })
  findPlaylists(@Query() query: YoutubePlaylistQueryDto) {
    return this.service.findPlaylists(query.page ?? 1, query.limit ?? 20);
  }

  @Get('playlists/:playlistId/videos')
  @PublicCache(900, 3600)
  @ApiOperation({
    summary: 'List videos in a specific YouTube playlist (public)',
    description:
      'Returns the playlist record and its videos in their YouTube-defined order. The `:playlistId` parameter is the YouTube playlist ID (e.g. `PLxxxx`), not an internal UUID. Reads from the local mirror. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`).',
  })
  @ApiParam({ name: 'playlistId', example: 'PLxxxxxxxxxx', description: 'YouTube playlist ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50, description: 'Max videos to return (1–200, default 50).' })
  @ApiOkResponse({ type: YoutubePlaylistVideosResponseDto, description: 'Playlist with its videos in order' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid limit query (must be an integer in 1–200)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No playlist with that ID exists in the local mirror' })
  findPlaylistVideos(@Param('playlistId') playlistId: string, @Query() query: YoutubePlaylistVideoQueryDto) {
    return this.service.findPlaylistVideos(playlistId, query.limit ?? 50);
  }
}
