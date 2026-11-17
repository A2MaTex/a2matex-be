import { Global, Module } from '@nestjs/common';
import envConfig from '../../config.ts';
import { QUEUE_PROVIDER } from './queue.interface.ts';
import { KafkaProvider } from './kafka/kafka.provider.ts';
import type { KafkaProviderOptions } from './kafka/kafka.types.ts';

function getKafkaOptions(): KafkaProviderOptions {
  const sasl =
    envConfig.KAFKA_SASL_MECHANISM && envConfig.KAFKA_SASL_USERNAME && envConfig.KAFKA_SASL_PASSWORD
      ? {
          mechanism: envConfig.KAFKA_SASL_MECHANISM,
          username: envConfig.KAFKA_SASL_USERNAME,
          password: envConfig.KAFKA_SASL_PASSWORD,
        }
      : undefined;

  return {
    enabled: envConfig.KAFKA_ENABLED,
    brokers:
      envConfig.KAFKA_BROKERS?.split(',')
        .map((broker) => broker.trim())
        .filter(Boolean) ?? [],
    clientId: envConfig.KAFKA_CLIENT_ID,
    topicPrefix: envConfig.KAFKA_TOPIC_PREFIX,
    ssl: envConfig.KAFKA_SSL,
    sasl,
  };
}

const kafkaProvider = {
  provide: QUEUE_PROVIDER,
  useFactory: () => new KafkaProvider(getKafkaOptions()),
};

@Global()
@Module({
  providers: [kafkaProvider],
  exports: [QUEUE_PROVIDER],
})
export class QueueModule {}
