export const KAFKA_TOPICS = {
  SUBMISSION_SCAN_REQUESTED: 'submission.scan.requested',
  SUBMISSION_SCAN_DEAD_LETTER: 'submission.scan.requested.dlq',
  PRODUCT_RELEASE_BUILD_REQUESTED: 'product-release.build.requested',
  PRODUCT_RELEASE_BUILD_DEAD_LETTER: 'product-release.build.requested.dlq',
  USER_BANNED_NOTIFICATION: 'user.banned.notification',
  USER_BANNED_NOTIFICATION_DEAD_LETTER: 'user.banned.notification.dlq',
  USER_UNBANNED_NOTIFICATION: 'user.unbanned.notification',
  USER_UNBANNED_NOTIFICATION_DEAD_LETTER: 'user.unbanned.notification.dlq',
} as const;

export const KAFKA_HEADERS = {
  MESSAGE_ID: 'message-id',
  MESSAGE_TYPE: 'message-type',
  TRACE_ID: 'trace-id',
  ORIGINAL_TOPIC: 'original-topic',
  FAILURE_REASON: 'failure-reason',
} as const;
