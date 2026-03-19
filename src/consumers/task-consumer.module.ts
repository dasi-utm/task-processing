import { Module } from '@nestjs/common';
import { TaskConsumerService } from './task-consumer.service';
import { ProcessorModule } from '../processors/processor.module';

@Module({
  imports: [ProcessorModule],
  providers: [TaskConsumerService],
})
export class TaskConsumerModule {}