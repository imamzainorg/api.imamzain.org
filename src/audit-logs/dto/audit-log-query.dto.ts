import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class AuditLogQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by user UUID' })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({ description: 'Filter by action name (e.g. NEWSLETTER_SUBSCRIBED)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by resource type (e.g. newsletter_subscriber)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resource_type?: string;

  @ApiPropertyOptional({
    description:
      'Filter by resource UUID. Combine with resource_type to scope to one row\'s history (e.g. all events for one post).',
  })
  @IsOptional()
  @IsUUID()
  resource_id?: string;

  @ApiPropertyOptional({ description: 'Start of date range (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'End of date range (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
