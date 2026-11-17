export const QUEUE_PROVIDER = Symbol('QUEUE_PROVIDER');

export type MessageEnvelope<T> = {
  id: string;
  type: string;
  occurredAt: string;
  traceId?: string;
  payload: T;
};

export type PublishMessageInput<T> = {
  topic: string;
  key: string;
  message: MessageEnvelope<T>;
  headers?: Record<string, string>;
};

export type ConsumedMessage<T> = {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  message: MessageEnvelope<T>;
  headers: Record<string, string>;
};

export enum MessageHandlerResult {
  SUCCESS = 'SUCCESS',
  RETRY = 'RETRY',
  FAILED = 'FAILED',
}

export type MessageHandler<T> = (message: ConsumedMessage<T>) => Promise<MessageHandlerResult>;

export type SubscribeInput = {
  topic: string;
  groupId: string;
  deadLetterTopic: string;
  maxAttempts: number;
  retryDelayMs: number;
};

export interface MessageProvider {
  publish<T>(input: PublishMessageInput<T>): Promise<void>;
  subscribe<T>(input: SubscribeInput, handler: MessageHandler<T>): Promise<void>;
  disconnect(): Promise<void>;
}
