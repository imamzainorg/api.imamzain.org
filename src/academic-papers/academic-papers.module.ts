import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AcademicPapersController } from './academic-papers.controller';
import { AcademicPapersService } from './academic-papers.service';

@Module({
  imports: [StorageModule],
  providers: [AcademicPapersService],
  controllers: [AcademicPapersController],
})
export class AcademicPapersModule {}
