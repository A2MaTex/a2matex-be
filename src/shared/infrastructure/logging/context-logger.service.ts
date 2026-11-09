import { Inject, Injectable, type LoggerService, type LogLevel } from '@nestjs/common';
import { LogSanitizer } from './log-sanitizer.ts';
import { RequestLogContextService } from './request-log-context.service.ts';
import type { RequestLogLevel, StructuredRequestLogRecord } from './request-log-context.ts';

type ImmediateLogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

type ImmediateLogRecord = {
  timestamp: string;
  severity: ImmediateLogSeverity;
  message: string;
  error?: {
    name: string;
    stack?: string;
  };
};

@Injectable()
export class ContextLoggerService implements LoggerService {
  private enabledLevels: Set<LogLevel> | undefined;

  constructor(
    @Inject(RequestLogContextService)
    private readonly requestContext: RequestLogContextService,
    @Inject(LogSanitizer)
    private readonly sanitizer: LogSanitizer,
  ) {}

  log(message: unknown, ..._optionalParams: unknown[]): void {
    this.write('info', 'INFO', 'log', message);
  }

  warn(message: unknown, ..._optionalParams: unknown[]): void {
    this.write('warn', 'WARNING', 'warn', message);
  }

  error(message: unknown, error?: unknown, ..._optionalParams: unknown[]): void {
    this.write('error', 'ERROR', 'error', message, error);
  }

  debug(message: unknown, ..._optionalParams: unknown[]): void {
    this.write('info', 'DEBUG', 'debug', message);
  }

  verbose(message: unknown, ..._optionalParams: unknown[]): void {
    this.write('info', 'DEBUG', 'verbose', message);
  }

  fatal(message: unknown, error?: unknown, ..._optionalParams: unknown[]): void {
    this.write('error', 'ERROR', 'fatal', message, error);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.enabledLevels = new Set(levels);
  }

  writeRequestRecord(record: StructuredRequestLogRecord): void {
    this.writeToStdout(record);
  }

  private write(
    requestLevel: RequestLogLevel,
    severity: ImmediateLogSeverity,
    nestLevel: LogLevel,
    value: unknown,
    error?: unknown,
  ): void {
    if (this.enabledLevels && !this.enabledLevels.has(nestLevel)) {
      return;
    }

    const message = this.sanitizer.sanitizeMessage(value);
    if (this.requestContext.getContext()) {
      this.requestContext.addMessage(requestLevel, message, error);
      return;
    }

    const record: ImmediateLogRecord = {
      timestamp: new Date().toISOString(),
      severity,
      message,
    };
    if (error instanceof Error) {
      record.error = {
        name: this.sanitizer.sanitizeMessage(error.name),
        stack: this.sanitizer.sanitizeStack(error.stack),
      };
    }

    this.writeToStdout(record);
  }

  private writeToStdout(record: ImmediateLogRecord | StructuredRequestLogRecord): void {
    try {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    } catch {
      // Logging must never interrupt application work.
    }
  }
}
