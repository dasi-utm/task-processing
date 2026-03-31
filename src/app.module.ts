import { Module } from '@nestjs/common';
import { TaskConsumerModule } from './consumers/task-consumer.module';
import { ProcessorModule } from './processors/processor.module';
import { RabbitMQModule } from './config/rabbitmq.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    RabbitMQModule,
    TaskConsumerModule,
    ProcessorModule,
    HealthModule,
  ],
})
export class AppModule {}