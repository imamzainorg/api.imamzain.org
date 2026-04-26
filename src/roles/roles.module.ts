import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  providers: [RolesService],
  controllers: [RolesController],
})
export class RolesModule {}
