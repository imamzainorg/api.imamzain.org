import { Module } from '@nestjs/common';
import { AcademicPaperCategoriesController } from './academic-paper-categories.controller';
import { AcademicPaperCategoriesService } from './academic-paper-categories.service';

@Module({
  providers: [AcademicPaperCategoriesService],
  controllers: [AcademicPaperCategoriesController],
})
export class AcademicPaperCategoriesModule {}
