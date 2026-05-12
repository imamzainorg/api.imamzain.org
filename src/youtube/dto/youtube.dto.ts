import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class YoutubeVideoQueryDto extends PaginationDto {}

export class YoutubePlaylistQueryDto extends PaginationDto {}

export class YoutubePlaylistVideoQueryDto {
  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
