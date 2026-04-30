import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

@Module({
  providers: [AuditLogsService],
  controllers: [AuditLogsController],
})
export class AuditLogsModule {}
