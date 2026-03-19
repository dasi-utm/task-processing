import { Module } from '@nestjs/common';
import { TaskConsumerModule } from './consumers/task-consumer.module';
import { ProcessorModule } from './processors/processor.module';
import { RabbitMQModule } from './config/rabbitmq.module';

@Module({
  imports: [
    RabbitMQModule,
    TaskConsumerModule,
    ProcessorModule,
  ],
})
export class AppModule {}