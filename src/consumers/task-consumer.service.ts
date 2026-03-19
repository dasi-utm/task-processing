import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RabbitMQConnection } from '../config/rabbitmq';
import { TaskProcessor } from '../processors/task-processor.service';
import { TaskMessage } from '../types/task-message.interface';

@Injectable()
export class TaskConsumerService implements OnModuleInit, OnModuleDestroy {
  private rabbitMQ: RabbitMQConnection;

  constructor(private taskProcessor: TaskProcessor) {
    this.rabbitMQ = new RabbitMQConnection();
  }

  async onModuleInit(): Promise<void> {
    await this.rabbitMQ.connect();
    await this.startConsuming();
  }

  async onModuleDestroy(): Promise<void> {
    await this.rabbitMQ.close();
  }

  private async startConsuming(): Promise<void> {
    const channel = this.rabbitMQ.getChannel();

    // Set prefetch to 1 for fair distribution
    await channel.prefetch(1);

    await channel.consume('task-processing-queue', async (msg) => {
      if (msg) {
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount <= maxRetries) {
          try {
            const message: TaskMessage = JSON.parse(msg.content.toString());
            // taskId lives inside payload in the .NET event schema
            const taskId = message.payload.taskId;
            console.log(`Received task: ${taskId} (attempt ${retryCount + 1})`);

            await this.processTask(message);
            channel.ack(msg);
            return;
          } catch (error) {
            retryCount++;
            console.error(`Error processing message (attempt ${retryCount}):`, error);

            if (retryCount > maxRetries) {
              console.error(`Max retries exceeded for task, sending to DLQ`);
              channel.reject(msg, false);
              return;
            }

            // Exponential backoff before retry
            await this.delay(Math.pow(2, retryCount) * 1000);
          }
        }
      }
    }, { noAck: false });

    console.log('Task consumer started, waiting for task.created messages...');
  }

  private async processTask(message: TaskMessage): Promise<void> {
    const taskId = message.payload.taskId;

    try {
      // Notify that processing has started
      await this.publishStatusEvent(taskId, 'task.processing');

      // Build a minimal task object from the available event payload.
      // The .NET TaskCreated event only carries taskId, title, and createdBy.
      // A full fetch from the Task API (GET /api/v1/tasks/:id) would be ideal here,
      // but for now we simulate with a default type.
      const task = {
        id: taskId,
        title: message.payload.title ?? '',
        description: '',
        type: 'data-processing',  // default — .NET schema has no task-type field
        status: 'InProgress',
        priority: 'Medium',
      };

      await this.taskProcessor.processTask(task);

      await this.publishStatusEvent(taskId, 'task.completed');
    } catch (error) {
      console.error(`Task processing failed for ${taskId}:`, error);
      await this.publishStatusEvent(taskId, 'task.failed');
    }
  }

  private async publishStatusEvent(taskId: string, routingKey: string): Promise<void> {
    const channel = this.rabbitMQ.getChannel();

    const message = {
      eventType: routingKey,
      timestamp: new Date().toISOString(),
      correlationId: taskId,
      payload: { taskId },
    };

    await channel.publish(
      'task-events',
      routingKey,
      Buffer.from(JSON.stringify(message)),
    );
    console.log(`Published event: ${routingKey} for task ${taskId}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
