import { ApiProperty } from '@nestjs/swagger';

class DependencyStatusDto {
  @ApiProperty({ example: 'healthy', enum: ['healthy', 'unhealthy'] })
  status: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;
}

export class HealthResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Health check' })
  message: string;

  @ApiProperty({ example: 'OK', enum: ['OK', 'DEGRADED'] })
  status: string;

  @ApiProperty({ type: DependencyStatusDto })
  database: DependencyStatusDto;

  @ApiProperty({ type: DependencyStatusDto })
  storage: DependencyStatusDto;

  @ApiProperty({ example: '1.0.0' })
  version: string;
}
