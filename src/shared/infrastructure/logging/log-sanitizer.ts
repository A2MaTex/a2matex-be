import { Injectable } from '@nestjs/common';
import {
  LOG_REDACTED_VALUE,
  LOG_SENSITIVE_PAYLOAD_OMITTED,
  LOG_TRUNCATION_MARKER,
  MAX_REQUEST_LOG_MESSAGE_BYTES,
  MAX_REQUEST_LOG_STACK_BYTES,
} from '../../constants/logging.constant.ts';

const SENSITIVE_KEY_PATTERN_SOURCE =
  '(?:authorization|cookie|set-cookie|password|passphrase|secret|client[_-]?secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|otp|credentials?|private[_-]?key|database[_-]?url|connection[_-]?(?:string|url)|storage[_-]?(?:key|secret)|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature)|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token)|sepay[_-]?(?:api[_-]?key|auth(?:entication)?))';

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const AUTHORIZATION_HEADER_PATTERN =
  /\b(authorization\s*[:=]\s*)(?:(?:bearer|basic|apikey)\s+)?[^\s,;]+/gi;
const COOKIE_HEADER_PATTERN = /\b((?:set-)?cookie\s*[:=]\s*)[^\r\n]*/gi;
const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
const PRESIGNED_URL_PATTERN =
  /\bhttps?:\/\/[^\s]+[?&](?:X-Amz-(?:Algorithm|Credential|Signature|Security-Token)|X-Goog-(?:Algorithm|Credential|Signature)|Signature|Expires)=?[^\s]*/gi;
const FORBIDDEN_PAYLOAD_PATTERN =
  /(?:\bprisma:(?:query|params|parameters)\b|["']?(?:prisma[_-]?params|request[_-]?body|response[_-]?body|webhook[_-]?payload|sepay[_-]?webhook[_-]?payload|project[_-]?draft|workflow[_-]?revision|editor[_-]?graph|runtime[_-]?ir|input[_-]?schema|node[_-]?definition[_-]?manifest|capability[_-]?manifest|validation[_-]?summary|test[_-]?summary|raw[_-]?profile|profile)["']?\s*[:=])/i;

@Injectable()
export class LogSanitizer {
  sanitizeMessage(value: unknown): string {
    return this.truncateUtf8(
      this.sanitizeText(this.toSafeText(value)),
      MAX_REQUEST_LOG_MESSAGE_BYTES,
    );
  }

  sanitizeStack(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }

    return this.truncateUtf8(this.sanitizeText(value), MAX_REQUEST_LOG_STACK_BYTES);
  }

  sanitizeErrorMessage(error: Error): string {
    return this.sanitizeMessage(error.message || error.name || 'Unknown error');
  }

  private sanitizeText(value: string): string {
    const payloadMatch = FORBIDDEN_PAYLOAD_PATTERN.exec(value);
    const boundedValue = payloadMatch
      ? `${value.slice(0, payloadMatch.index).trimEnd()} ${LOG_SENSITIVE_PAYLOAD_OMITTED}`.trim()
      : value;
    const sensitiveJsonValue = new RegExp(
      `("${SENSITIVE_KEY_PATTERN_SOURCE}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
      'gi',
    );
    const sensitivePlainValue = new RegExp(
      `(^|[\\s,;{])(${SENSITIVE_KEY_PATTERN_SOURCE})(\\s*[:=]\\s*)("[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;&}]+)`,
      'gi',
    );
    const sensitiveQueryValue = new RegExp(`([?&]${SENSITIVE_KEY_PATTERN_SOURCE}=)[^&#\\s]*`, 'gi');

    const sanitized = boundedValue
      .replace(PRESIGNED_URL_PATTERN, LOG_REDACTED_VALUE)
      .replace(URL_CREDENTIAL_PATTERN, `$1${LOG_REDACTED_VALUE}@`)
      .replace(COOKIE_HEADER_PATTERN, `$1${LOG_REDACTED_VALUE}`)
      .replace(AUTHORIZATION_HEADER_PATTERN, `$1${LOG_REDACTED_VALUE}`)
      .replace(BEARER_PATTERN, `Bearer ${LOG_REDACTED_VALUE}`)
      .replace(JWT_PATTERN, LOG_REDACTED_VALUE)
      .replace(sensitiveJsonValue, `$1"${LOG_REDACTED_VALUE}"`)
      .replace(sensitiveQueryValue, `$1${LOG_REDACTED_VALUE}`)
      .replace(
        sensitivePlainValue,
        (_match, prefix: string, key: string, separator: string) =>
          `${prefix}${key}${separator}${LOG_REDACTED_VALUE}`,
      );

    let withoutControlCharacters = '';
    for (const character of sanitized) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint >= 32 && codePoint !== 127 && !(codePoint >= 128 && codePoint <= 159))
      ) {
        withoutControlCharacters += character;
      }
    }
    return withoutControlCharacters;
  }

  private toSafeText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Error) {
      return value.message || value.name;
    }
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value);
    }
    if (value === null || value === undefined) {
      return String(value);
    }

    return '[non-string log value omitted]';
  }

  private truncateUtf8(value: string, maximumBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
      return value;
    }

    const markerBytes = Buffer.byteLength(LOG_TRUNCATION_MARKER, 'utf8');
    const contentByteLimit = Math.max(0, maximumBytes - markerBytes);
    const bytes = Buffer.from(value, 'utf8');
    let contentEnd = contentByteLimit;
    while (contentEnd > 0 && (bytes[contentEnd] & 0xc0) === 0x80) {
      contentEnd -= 1;
    }
    const content = bytes.subarray(0, contentEnd).toString('utf8');

    return `${content}${LOG_TRUNCATION_MARKER}`;
  }
}
