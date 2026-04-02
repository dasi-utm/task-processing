/**
 * scenarios:
 *  Happy path acks message, publishes task.processing + task.completed
 *  Processor failure publishes task.failed, still acks (not retried)
 *  Malformed JSON retries up to maxRetries, then rejects to DLQ
 *  Randomization=true type/priority drawn from their arrays (Math.random mocked)
 *  Randomization=false type fixed='data-processing', priority fixed='Medium'
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConsumeMessage } from 'amqplib';
import { TaskConsumerService } from './task-consumer.service';
import { TaskProcessor } from '../processors/task-processor.service';

const mockFlagsValue = { randomization: true };
jest.mock('../config/feature-flags', () => ({
  get featureFlags() {
    return mockFlagsValue;
  },
}));

type ConsumeCallback = (msg: ConsumeMessage | null) => Promise<void>;

let onMessage: ConsumeCallback | undefined;

const mockChannel = {
  prefetch: jest.fn().mockResolvedValue(undefined),
  consume: jest.fn().mockImplementation(
    (_queue: string, cb: ConsumeCallback) => {
      onMessage = cb;
      return Promise.resolve({ consumerTag: 'test-tag' });
    },
  ),
  ack: jest.fn(),
  reject: jest.fn(),
  publish: jest.fn().mockResolvedValue(true),
};

const mockRabbitMQ = {
  connect: jest.fn().mockResolvedValue(undefined),
  getChannel: jest.fn().mockReturnValue(mockChannel),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockProcessTask = jest.fn().mockResolvedValue(undefined);

const TASK_TYPES = ['data-processing', 'report', 'analysis', 'email', 'notification', 'export', 'import'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

function makeMessage(taskId: string, title = 'Test Task'): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        eventType: 'TaskCreated',
        timestamp: new Date().toISOString(),
        correlationId: taskId,
        payload: { taskId, title },
      }),
    ),
    properties: {} as any,
    fields: {} as any,
  } as ConsumeMessage;
}

function malformedMessage(): ConsumeMessage {
  return {
    content: Buffer.from('{ this is not valid json }}'),
    properties: {} as any,
    fields: {} as any,
  } as ConsumeMessage;
}

function publishedRoutingKeys(): string[] {
  return mockChannel.publish.mock.calls.map((call) => call[1] as string);
}

describe('TaskConsumerService', () => {
  let module: TestingModule;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    mockProcessTask.mockReset().mockResolvedValue(undefined);
    mockChannel.ack.mockReset();
    mockChannel.reject.mockReset();
    mockChannel.publish.mockReset().mockResolvedValue(true);
    mockRabbitMQ.connect.mockReset().mockResolvedValue(undefined);
    onMessage = undefined;

    mockFlagsValue.randomization = true;

    module = await Test.createTestingModule({
      providers: [
        TaskConsumerService,
        { provide: 'RABBITMQ_CONNECTION', useValue: mockRabbitMQ },
        {
          provide: TaskProcessor,
          useValue: { processTask: mockProcessTask },
        },
      ],
    }).compile();

    const service = module.get<TaskConsumerService>(TaskConsumerService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    const service = module.get<TaskConsumerService>(TaskConsumerService);
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('happy path', () => {
    it('connects to RabbitMQ on init', () => {
      expect(mockRabbitMQ.connect).toHaveBeenCalledTimes(1);
    });

    it('registers a consumer on the task-processing-queue', () => {
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'task-processing-queue',
        expect.any(Function),
        { noAck: false },
      );
    });

    it('acknowledges the message after successful processing', async () => {
      const msg = makeMessage('aaaa-1111');

      await onMessage!(msg);

      expect(mockChannel.ack).toHaveBeenCalledWith(msg);
      expect(mockChannel.reject).not.toHaveBeenCalled();
    });

    it('publishes task.processing before calling TaskProcessor', async () => {
      const msg = makeMessage('aaaa-2222');

      await onMessage!(msg);

      const keys = publishedRoutingKeys();
      expect(keys[0]).toBe('task.processing');
    });

    it('publishes task.completed after successful processing', async () => {
      const msg = makeMessage('aaaa-3333');

      await onMessage!(msg);

      const keys = publishedRoutingKeys();
      expect(keys).toContain('task.completed');
    });

    it('passes task id and title to TaskProcessor', async () => {
      const msg = makeMessage('bbbb-1111', 'My special task');

      await onMessage!(msg);

      expect(mockProcessTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bbbb-1111', title: 'My special task' }),
      );
    });

    it('publishes status events to the task-events exchange', async () => {
      await onMessage!(makeMessage('cccc-1111'));

      mockChannel.publish.mock.calls.forEach((call) => {
        expect(call[0]).toBe('task-events');
      });
    });

    it('handles a null message without throwing', async () => {
      await expect(onMessage!(null)).resolves.toBeUndefined();
    });
  });

  describe('processor failure', () => {
    it('publishes task.failed when TaskProcessor throws', async () => {
      mockProcessTask.mockRejectedValueOnce(new Error('Processing error'));

      await onMessage!(makeMessage('dddd-1111'));

      expect(publishedRoutingKeys()).toContain('task.failed');
    });

    it('still ACKS the message after processor failure (failed task leaves the queue)', async () => {
      mockProcessTask.mockRejectedValueOnce(new Error('Processing error'));

      await onMessage!(makeMessage('dddd-2222'));

      // The private processTask catches the error and returns — the outer loop acks it
      expect(mockChannel.ack).toHaveBeenCalledTimes(1);
      expect(mockChannel.reject).not.toHaveBeenCalled();
    });

    it('does NOT publish task.completed after processor failure', async () => {
      mockProcessTask.mockRejectedValueOnce(new Error('Processing error'));

      await onMessage!(makeMessage('dddd-3333'));

      expect(publishedRoutingKeys()).not.toContain('task.completed');
    });
  });

  describe('malformed JSON (DLQ path)', () => {
    it('rejects to DLQ after exceeding max retries on malformed message', async () => {
      const msg = malformedMessage();

      // Start processing (will retry up to maxRetries with exponential backoff)
      const promise = onMessage!(msg);
      // Advance all timers to skip the retry delays (2s, 4s, 8s)
      await jest.runAllTimersAsync();
      await promise;

      expect(mockChannel.reject).toHaveBeenCalledWith(msg, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });

    it('does not reject immediately (retries first)', async () => {
      const msg = malformedMessage();
      const promise = onMessage!(msg);

      // After the first attempt, no reject yet
      expect(mockChannel.reject).not.toHaveBeenCalled();

      await jest.runAllTimersAsync();
      await promise;

      // Now it should have been rejected after exhausting retries
      expect(mockChannel.reject).toHaveBeenCalledTimes(1);
    });
  });

  describe('fEATURE_RANDOMIZATION_ENABLED=true', () => {
    it('picks task type from TASK_TYPES array (Math.random → first item)', async () => {
      mockFlagsValue.randomization = true;
      jest.spyOn(Math, 'random').mockReturnValue(0);

      await onMessage!(makeMessage('eeee-1111'));

      // Math.random=0 -> index 0 for both arrays
      expect(mockProcessTask).toHaveBeenCalledWith(
        expect.objectContaining({ type: TASK_TYPES[0], priority: PRIORITIES[0] }),
      );
    });

    it('picks task type from TASK_TYPES array (Math.random → last item)', async () => {
      mockFlagsValue.randomization = true;
      // floor(0.99 * 7) = 6 -> last item of TASK_TYPES
      // floor(0.99 * 4) = 3 -> last item of PRIORITIES
      jest.spyOn(Math, 'random').mockReturnValue(0.99);

      await onMessage!(makeMessage('eeee-2222'));

      expect(mockProcessTask).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TASK_TYPES[TASK_TYPES.length - 1],
          priority: PRIORITIES[PRIORITIES.length - 1],
        }),
      );
    });

    it('type and priority vary across messages (not always the same)', async () => {
      mockFlagsValue.randomization = true;
      // Alternate Math.random values so consecutive messages get different items
      const randomSpy = jest.spyOn(Math, 'random');
      randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0.99);

      const calls: Array<{ type: string; priority: string }> = [];
      mockProcessTask.mockImplementation((task) => {
        calls.push({ type: task.type, priority: task.priority });
        return Promise.resolve();
      });

      await onMessage!(makeMessage('ffff-1111'));
      await onMessage!(makeMessage('ffff-2222'));

      expect(calls[0].type).not.toBe(calls[1].type);
    });
  });

  describe('fEATURE_RANDOMIZATION_ENABLED=false', () => {
    it('always uses type=data-processing regardless of Math.random', async () => {
      mockFlagsValue.randomization = false;
      jest.spyOn(Math, 'random').mockReturnValue(0.99); // would pick last item if enabled

      await onMessage!(makeMessage('gggg-1111'));

      expect(mockProcessTask).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'data-processing' }),
      );
    });

    it('always uses priority=Medium regardless of Math.random', async () => {
      mockFlagsValue.randomization = false;
      jest.spyOn(Math, 'random').mockReturnValue(0.99);

      await onMessage!(makeMessage('gggg-2222'));

      expect(mockProcessTask).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'Medium' }),
      );
    });

    it('type is deterministic across multiple messages', async () => {
      mockFlagsValue.randomization = false;

      const receivedTypes: string[] = [];
      mockProcessTask.mockImplementation((task) => {
        receivedTypes.push(task.type);
        return Promise.resolve();
      });

      await onMessage!(makeMessage('hhhh-1111'));
      await onMessage!(makeMessage('hhhh-2222'));
      await onMessage!(makeMessage('hhhh-3333'));

      expect(receivedTypes).toEqual(['data-processing', 'data-processing', 'data-processing']);
    });

    it('priority is deterministic across multiple messages', async () => {
      mockFlagsValue.randomization = false;

      const receivedPriorities: string[] = [];
      mockProcessTask.mockImplementation((task) => {
        receivedPriorities.push(task.priority);
        return Promise.resolve();
      });

      await onMessage!(makeMessage('iiii-1111'));
      await onMessage!(makeMessage('iiii-2222'));

      expect(receivedPriorities).toEqual(['Medium', 'Medium']);
    });
  });
});
