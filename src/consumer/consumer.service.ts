import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import envConfig from '../shared/config.ts';
import {
  type ConsumedMessage,
  type MessageHandlerResult,
  type MessageProvider,
  QUEUE_PROVIDER,
  type SubscribeInput,
} from '../shared/infrastructure/queue/queue.interface.ts';

export const QUEUE_CONSUMER_HANDLERS = Symbol('QUEUE_CONSUMER_HANDLERS');

export interface QueueConsumerHandler {
  readonly name: string;
  readonly subscription: SubscribeInput;
  handle(message: ConsumedMessage<unknown>): Promise<MessageHandlerResult>;
}

@Injectable()
export class ConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConsumerService.name);
  private server?: Server;

  constructor(
    @Inject(QUEUE_PROVIDER) private readonly queue: MessageProvider,
    @Inject(QUEUE_CONSUMER_HANDLERS)
    private readonly handlers: QueueConsumerHandler[],
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.validateHandlers();
    for (const handler of this.handlers) {
      await this.queue.subscribe(handler.subscription, (message) => handler.handle(message));
    }

    this.server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/health') {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'ok',
          service: 'consumer',
          handlers: this.handlers.map((handler) => handler.name),
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        }),
      );
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server!.once('error', onError);
      this.server!.listen(envConfig.QUEUE_CONSUMER_PORT, envConfig.QUEUE_CONSUMER_HOST, () => {
        this.server!.off('error', onError);
        resolve();
      });
    });

    this.logger.log(
      `Consumer health is running on http://${envConfig.QUEUE_CONSUMER_HOST}:${envConfig.QUEUE_CONSUMER_PORT}/health`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server?.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private validateHandlers(): void {
    const names = new Set<string>();
    const subscriptions = new Set<string>();
    for (const handler of this.handlers) {
      const subscription = `${handler.subscription.groupId}:${handler.subscription.topic}`;
      if (names.has(handler.name)) {
        throw new Error(`Duplicate queue consumer handler name: ${handler.name}`);
      }
      if (subscriptions.has(subscription)) {
        throw new Error(`Duplicate queue consumer subscription: ${subscription}`);
      }
      names.add(handler.name);
      subscriptions.add(subscription);
    }
  }
}
