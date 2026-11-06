import { LOG_MESSAGES_TRUNCATED_MARKER } from '../../constants/logging.constant.ts';
import type { RequestLogContext } from './request-log-context.ts';
import { LogSanitizer } from './log-sanitizer.ts';

export function buildRequestLogMessage(
  context: RequestLogContext,
  sanitizer: LogSanitizer,
): string {
  const failureMessages = context.messages.map(({ message }) => message).reverse();
  const failed =
    context.messages.some(({ level }) => level === 'error') ||
    context.rootError !== undefined ||
    (context.failureStatusCode !== undefined && context.failureStatusCode >= 400);

  if (!failed) {
    const messages = context.messages.map(({ message }) => message);
    if (context.messagesTruncated) {
      messages.push(LOG_MESSAGES_TRUNCATED_MARKER);
    }
    return ['request completed', ...deduplicate(messages)].join(': ');
  }

  const messages = deduplicate(failureMessages);
  const rootCause = context.rootError
    ? sanitizer.sanitizeErrorMessage(context.rootError)
    : undefined;

  if (context.messagesTruncated) {
    messages.push(LOG_MESSAGES_TRUNCATED_MARKER);
  }
  if (rootCause && !messages.some((message) => containsMessage(message, rootCause))) {
    messages.push(rootCause);
  }

  return messages.length > 0 ? messages.join(': ') : 'request failed';
}

function deduplicate(messages: string[]): string[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const normalized = normalize(message);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function containsMessage(container: string, candidate: string): boolean {
  return normalize(container).includes(normalize(candidate));
}

function normalize(message: string): string {
  return message.trim().toLocaleLowerCase('en-US');
}
