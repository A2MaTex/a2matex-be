import { Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import type { Consumer, EachMessagePayload, KafkaMessage, Producer, SASLOptions } from 'kafkajs';
import { KAFKA_HEADERS } from '../../../constants/kafka.constant.ts';
import {
  ConsumedMessage,
  MessageEnvelope,
  MessageHandler,
  MessageHandlerResult,
  MessageProvider,
  PublishMessageInput,
  SubscribeInput,
} from '../queue.interface.ts';
import type { KafkaProviderOptions } from './kafka.types.ts';

const ALL_IN_SYNC_REPLICAS = -1;
const PARTITIONS_CONSUMED_CONCURRENTLY = 1;

export class KafkaProvider implements MessageProvider, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProvider.name);
  private readonly kafka?: Kafka;
  private readonly producer?: Producer;
  private readonly consumers = new Map<string, Consumer>();
  private producerConnected = false;
  private producerConnection?: Promise<void>;
  private shuttingDown = false;
  private readonly shutdownController = new AbortController();

  constructor(private readonly options: KafkaProviderOptions) {
    if (!options.enabled) {
      return;
    }

    this.kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
      ssl: options.ssl,
      sasl: options.sasl as SASLOptions | undefined,
    });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
  }

  async publish<T>(input: PublishMessageInput<T>): Promise<void> {
    this.assertAvailable();
    this.validatePublish(input);
    await this.connectProducer();

    const topic = this.resolveTopic(input.topic);
    const headers = {
      ...input.headers,
      [KAFKA_HEADERS.MESSAGE_ID]: input.message.id,
      [KAFKA_HEADERS.MESSAGE_TYPE]: input.message.type,
      ...(input.message.traceId ? { [KAFKA_HEADERS.TRACE_ID]: input.message.traceId } : undefined),
    };

    try {
      await this.producer!.send({
        topic,
        acks: ALL_IN_SYNC_REPLICAS,
        messages: [
          {
            key: input.key,
            value: JSON.stringify(input.message),
            headers,
          },
        ],
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish Kafka message topic=${topic} messageId=${input.message.id} traceId=${input.message.traceId ?? ''}: ${this.formatError(error)}`,
      );
      throw error;
    }
  }

  async subscribe<T>(input: SubscribeInput, handler: MessageHandler<T>): Promise<void> {
    this.assertAvailable();
    this.validateSubscription(input);

    const topic = this.resolveTopic(input.topic);
    const deadLetterTopic = this.resolveTopic(input.deadLetterTopic);
    const groupId = this.resolveGroupId(input.groupId);
    const consumerKey = `${groupId}:${topic}`;
    if (this.consumers.has(consumerKey)) {
      throw new Error(`Kafka consumer is already registered for ${consumerKey}`);
    }

    const consumer = this.kafka!.consumer({
      groupId,
      allowAutoTopicCreation: false,
    });
    this.consumers.set(consumerKey, consumer);

    try {
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });
      await consumer.run({
        autoCommit: false,
        partitionsConsumedConcurrently: PARTITIONS_CONSUMED_CONCURRENTLY,
        eachMessage: async (payload) => {
          await this.handleMessage(consumer, payload, deadLetterTopic, input, handler);
        },
      });
      this.logger.log(`Kafka consumer started topic=${topic} groupId=${groupId}`);
    } catch (error) {
      this.consumers.delete(consumerKey);
      await consumer.disconnect().catch(() => undefined);
      this.logger.error(
        `Failed to start Kafka consumer topic=${topic} groupId=${groupId}: ${this.formatError(error)}`,
      );
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.shutdownController.abort();

    const consumers = [...this.consumers.values()];
    this.consumers.clear();
    const results = await Promise.allSettled(consumers.map((consumer) => consumer.disconnect()));
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to disconnect Kafka consumer: ${this.formatError(result.reason)}`,
        );
      }
    }

    if (this.producerConnection) {
      await this.producerConnection.catch(() => undefined);
    }
    if (this.producerConnected) {
      await this.producer!.disconnect();
      this.producerConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private async handleMessage<T>(
    consumer: Consumer,
    payload: EachMessagePayload,
    deadLetterTopic: string,
    input: SubscribeInput,
    handler: MessageHandler<T>,
  ): Promise<void> {
    const parsed = this.parseMessage<T>(payload.message);
    if (!parsed) {
      await this.publishDeadLetter(deadLetterTopic, payload, 'invalid-message-envelope');
      await this.commit(consumer, payload);
      return;
    }

    const consumedMessage: ConsumedMessage<T> = {
      topic: payload.topic,
      partition: payload.partition,
      offset: payload.message.offset,
      key: payload.message.key?.toString('utf8') ?? null,
      message: parsed,
      headers: this.decodeHeaders(payload.message),
    };

    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      let result: MessageHandlerResult;
      try {
        result = await handler(consumedMessage);
      } catch (error) {
        result = MessageHandlerResult.RETRY;
        this.logger.error(
          `Kafka handler failed topic=${payload.topic} messageId=${parsed.id} attempt=${attempt}/${input.maxAttempts} traceId=${parsed.traceId ?? ''}: ${this.formatError(error)}`,
        );
      }

      if (result === MessageHandlerResult.SUCCESS) {
        await this.commit(consumer, payload);
        return;
      }

      if (result === MessageHandlerResult.FAILED) {
        await this.publishDeadLetter(deadLetterTopic, payload, 'handler-rejected-message');
        await this.commit(consumer, payload);
        return;
      }

      if (result !== MessageHandlerResult.RETRY) {
        await this.publishDeadLetter(deadLetterTopic, payload, 'invalid-handler-result');
        await this.commit(consumer, payload);
        return;
      }

      if (attempt < input.maxAttempts) {
        await this.waitBeforeRetry(input.retryDelayMs);
      }
    }

    await this.publishDeadLetter(deadLetterTopic, payload, 'retry-attempts-exhausted');
    await this.commit(consumer, payload);
  }

  private async publishDeadLetter(
    deadLetterTopic: string,
    payload: EachMessagePayload,
    failureReason: string,
  ): Promise<void> {
    await this.connectProducer();
    await this.producer!.send({
      topic: deadLetterTopic,
      acks: ALL_IN_SYNC_REPLICAS,
      messages: [
        {
          key: payload.message.key,
          value: payload.message.value,
          headers: {
            ...payload.message.headers,
            [KAFKA_HEADERS.ORIGINAL_TOPIC]: payload.topic,
            [KAFKA_HEADERS.FAILURE_REASON]: failureReason,
          },
        },
      ],
    });
    this.logger.warn(
      `Kafka message sent to dead-letter topic=${deadLetterTopic} originalTopic=${payload.topic} messageId=${this.getHeader(payload.message, KAFKA_HEADERS.MESSAGE_ID)}`,
    );
  }

  private async commit(consumer: Consumer, payload: EachMessagePayload): Promise<void> {
    await payload.heartbeat();
    await consumer.commitOffsets([
      {
        topic: payload.topic,
        partition: payload.partition,
        offset: (BigInt(payload.message.offset) + 1n).toString(),
      },
    ]);
  }

  private parseMessage<T>(message: KafkaMessage): MessageEnvelope<T> | null {
    if (!message.value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(message.value.toString('utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('payload' in parsed) ||
        !('id' in parsed) ||
        typeof parsed.id !== 'string' ||
        !('type' in parsed) ||
        typeof parsed.type !== 'string' ||
        !('occurredAt' in parsed) ||
        typeof parsed.occurredAt !== 'string'
      ) {
        return null;
      }
      if (
        'traceId' in parsed &&
        parsed.traceId !== undefined &&
        typeof parsed.traceId !== 'string'
      ) {
        return null;
      }
      return parsed as MessageEnvelope<T>;
    } catch {
      return null;
    }
  }

  private decodeHeaders(message: KafkaMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(message.headers ?? {})) {
      if (value === undefined) {
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      headers[key] = values.map((item) => item.toString()).join(',');
    }
    return headers;
  }

  private getHeader(message: KafkaMessage, key: string): string {
    return this.decodeHeaders(message)[key] ?? '';
  }

  private async connectProducer(): Promise<void> {
    if (this.producerConnected) {
      return;
    }
    if (!this.producerConnection) {
      this.producerConnection = this.producer!.connect().then(() => {
        this.producerConnected = true;
      });
    }

    try {
      await this.producerConnection;
    } catch (error) {
      this.producerConnection = undefined;
      throw error;
    }
  }

  private async waitBeforeRetry(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return;
    }
    if (this.shutdownController.signal.aborted) {
      throw new Error('Kafka provider is shutting down');
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new Error('Kafka provider is shutting down'));
      };
      const timeout = setTimeout(() => {
        this.shutdownController.signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      this.shutdownController.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private resolveTopic(topic: string): string {
    const prefix = this.options.topicPrefix.trim().replace(/^\.+|\.+$/g, '');
    const normalizedTopic = topic.trim().replace(/^\.+/, '');
    return prefix ? `${prefix}.${normalizedTopic}` : normalizedTopic;
  }

  private resolveGroupId(groupId: string): string {
    const prefix = this.options.topicPrefix.trim().replace(/^\.+|\.+$/g, '');
    const normalizedGroupId = groupId.trim().replace(/^\.+/, '');
    return prefix ? `${prefix}.${normalizedGroupId}` : normalizedGroupId;
  }

  private validateSubscription(input: SubscribeInput): void {
    if (!input.topic.trim() || !input.deadLetterTopic.trim() || !input.groupId.trim()) {
      throw new Error('Kafka topic, dead-letter topic, and group ID are required');
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error('Kafka maxAttempts must be a positive integer');
    }
    if (!Number.isInteger(input.retryDelayMs) || input.retryDelayMs < 0) {
      throw new Error('Kafka retryDelayMs must be a non-negative integer');
    }
  }

  private validatePublish<T>(input: PublishMessageInput<T>): void {
    if (!input.topic.trim() || !input.key.trim()) {
      throw new Error('Kafka topic and message key are required');
    }
    if (
      !input.message.id.trim() ||
      !input.message.type.trim() ||
      !input.message.occurredAt.trim()
    ) {
      throw new Error('Kafka message ID, type, and occurredAt are required');
    }
  }

  private assertAvailable(): void {
    if (!this.options.enabled || !this.kafka || !this.producer) {
      throw new Error('Kafka is disabled');
    }
    if (this.shuttingDown) {
      throw new Error('Kafka provider is shutting down');
    }
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}
