export type RequestLogLevel = 'info' | 'warn' | 'error';

export type RequestLogMessage = {
  level: RequestLogLevel;
  message: string;
};

export type RequestLogContext = {
  traceId: string;
  method: string;
  route: string;
  startedAt: number;
  userId?: string;
  messages: RequestLogMessage[];
  rootError?: Error;
  failureStatusCode?: number;
  finalized: boolean;
  messagesTruncated?: boolean;
};

export type CreateRequestLogContext = Pick<
  RequestLogContext,
  'traceId' | 'method' | 'route' | 'startedAt'
>;

export type RequestLogSeverity = 'INFO' | 'WARNING' | 'ERROR';

export type StructuredRequestLogRecord = {
  timestamp: string;
  severity: RequestLogSeverity;
  traceId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  message: string;
  error?: {
    name: string;
    stack?: string;
  };
};
