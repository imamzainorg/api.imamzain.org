import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  providers: [StoresService],
  controllers: [StoresController],
})
export class StoresModule {}
