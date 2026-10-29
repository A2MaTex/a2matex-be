export type KafkaSaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';

export type KafkaProviderOptions = {
  enabled: boolean;
  brokers: string[];
  clientId: string;
  topicPrefix: string;
  ssl: boolean;
  sasl?: {
    mechanism: KafkaSaslMechanism;
    username: string;
    password: string;
  };
};
