import { Module } from '@nestjs/common';
import { AcademicPapersController } from './academic-papers.controller';
import { AcademicPapersService } from './academic-papers.service';

@Module({
  providers: [AcademicPapersService],
  controllers: [AcademicPapersController],
})
export class AcademicPapersModule {}
