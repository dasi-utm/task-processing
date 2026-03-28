import { connect, ChannelModel, Channel } from 'amqplib';

export class RabbitMQConnection {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connectionUrl = process.env.RABBITMQ_URL!;

  async connect(): Promise<void> {
    try {
      this.connection = await connect(this.connectionUrl);
      this.channel = await this.connection.createChannel();

      await this.channel.assertExchange('task-events', 'topic', { durable: true });

      // Dead-letter config on the main queue so rejected messages route to the DLQ
      await this.channel.assertQueue('task-processing-queue', {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'task-dlq-queue',
        },
      });
      await this.channel.assertQueue('task-dlq-queue', { durable: true });

      await this.channel.bindQueue('task-processing-queue', 'task-events', 'task.created');

      console.log('Processing Service connected to RabbitMQ');
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  getChannel(): Channel {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }
    return this.channel;
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
    } catch (e) {
      console.error("Failed during closing of the rabbitmq listner", e)
    }
  }
}
