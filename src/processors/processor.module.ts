import { Module } from '@nestjs/common';
import { TaskProcessor } from './task-processor.service';

@Module({
  providers: [TaskProcessor],
  exports: [TaskProcessor],
})
export class ProcessorModule {}