export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type RequestLogContext = {
  traceId: string;
  startedAt: number;
  userId?: string;
  messages?: string[];
  rootError?: Error;
  cause?: string;
  failureStatusCode?: number;
  hasOperationalError?: boolean;
  truncated?: boolean;
  finalized?: boolean;
};
