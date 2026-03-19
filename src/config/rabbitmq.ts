import * as amqp from 'amqplib';

export class RabbitMQConnection {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;

  async connect(): Promise<void> {
    try {
      const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      
      // Setup exchanges and queues
      await this.channel.assertExchange('task-events', 'topic', { durable: true });
      await this.channel.assertQueue('task-processing-queue', { durable: true });
      await this.channel.assertQueue('task-dlq-queue', { durable: true });
      
      // Bind queue to exchange
      await this.channel.bindQueue('task-processing-queue', 'task-events', 'task.created');
      
      console.log('Connected to RabbitMQ');
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  getChannel(): amqp.Channel {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }
    return this.channel;
  }

  async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }
}