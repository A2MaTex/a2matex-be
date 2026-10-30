# Queue consumer

The consumer is a separate Nest application context started with:

```bash
npm run start:consumer:dev
```

It runs Kafka handlers outside the API process and exposes only `GET /health` on
`QUEUE_CONSUMER_PORT`. Handlers are thin adapters: they validate the message, call an existing
service, and return `SUCCESS`, `RETRY`, or `FAILED`.

## Add a handler

1. Export the service from its feature module, then import that module in
   `consumer.module.ts`.
2. Create a handler implementing `QueueConsumerHandler`:

```ts
@Injectable()
export class WorkflowValidationHandler implements QueueConsumerHandler {
  readonly name = 'workflow-validation';

  readonly subscription = {
    topic: 'submission.scan.requested',
    groupId: 'submission-scan',
    deadLetterTopic: 'submission.scan.requested.dlq',
    maxAttempts: 3,
    retryDelayMs: 1_000,
  };

  constructor(private readonly workflowValidationService: WorkflowValidationService) {}

  async handle(message: ConsumedMessage<unknown>): Promise<MessageHandlerResult> {
    const payload = WorkflowValidationPayload.safeParse(message.message.payload);

    if (!payload.success) {
      return MessageHandlerResult.FAILED;
    }

    try {
      await this.workflowValidationService.validateSubmission(payload.data.submissionId);

      return MessageHandlerResult.SUCCESS;
    } catch {
      return MessageHandlerResult.RETRY;
    }
  }
}
```

3. Add the handler class to `handlerTypes` in `consumer.module.ts` and provision its topic and
   dead-letter topic. The consumer health response lists every registered handler.

```ts
const handlerTypes: Type<QueueConsumerHandler>[] = [WorkflowValidationHandler];

@Module({
  imports: [SharedModule, WorkflowValidationModule],
  providers: [
    ...handlerTypes,
    ConsumerService,
    {
      provide: QUEUE_CONSUMER_HANDLERS,
      inject: handlerTypes,
      useFactory: (...handlers: QueueConsumerHandler[]) => handlers,
    },
  ],
})
export class ConsumerModule {}
```

Use `FAILED` for permanently invalid messages. Throw or return `RETRY` for transient failures so
the Kafka provider can retry and eventually send the message to the dead-letter topic.

4. Provision the topic and dead-letter topic in `kafka-init` in `docker-compose.yaml`:

```yaml
kafka-init:
  image: apache/kafka:4.4.0
  restart: 'no'
  depends_on:
    kafka:
      condition: service_healthy
  entrypoint:
    - /bin/sh
    - -c
    - |
      set -eu
      for topic in \
        "${KAFKA_TOPIC_PREFIX:-dev}.submission.scan.requested" \
        "${KAFKA_TOPIC_PREFIX:-dev}.submission.scan.requested.dlq" \
        "${KAFKA_TOPIC_PREFIX:-dev}.product-release.build.requested" \
        "${KAFKA_TOPIC_PREFIX:-dev}.product-release.build.requested.dlq"
      do
        /opt/kafka/bin/kafka-topics.sh \
          --bootstrap-server kafka:29092 \
          --create \
          --if-not-exists \
          --topic "$$topic" \
          --partitions 1 \
          --replication-factor 1
      done
```
