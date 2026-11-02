export const KAFKA_TOPICS = {
  SUBMISSION_SCAN_REQUESTED: 'submission.scan.requested',
  SUBMISSION_SCAN_DEAD_LETTER: 'submission.scan.requested.dlq',
  PRODUCT_RELEASE_BUILD_REQUESTED: 'product-release.build.requested',
  PRODUCT_RELEASE_BUILD_DEAD_LETTER: 'product-release.build.requested.dlq',
} as const;

export const KAFKA_HEADERS = {
  MESSAGE_ID: 'message-id',
  MESSAGE_TYPE: 'message-type',
  TRACE_ID: 'trace-id',
  ORIGINAL_TOPIC: 'original-topic',
  FAILURE_REASON: 'failure-reason',
} as const;
