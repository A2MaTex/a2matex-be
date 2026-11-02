import { S3ServiceException } from '@aws-sdk/client-s3';
import {
  AccessDeniedException,
  EntityTooSmallException,
  HeadObjectFailedException,
  InternalErrorException,
  InvalidPartOrderException,
  InvalidRequestException,
  ObjectNotFoundException,
  SlowDownException,
  UploadedPartsNotFoundException,
  UploadSessionNotFoundException,
} from './static.error.ts';
import { Logger } from '@nestjs/common';

export function handleMultipartUploadError(error: S3ServiceException) {
  switch (error.name) {
    case 'NoSuchUpload':
      throw UploadSessionNotFoundException;

    case 'InvalidPart':
      throw UploadedPartsNotFoundException;

    case 'InvalidPartOrder':
      throw InvalidPartOrderException;

    case 'EntityTooSmall':
      throw EntityTooSmallException;

    case 'BadDigest':
    case 'InvalidRequest':
      throw InvalidRequestException;

    case 'AccessDenied':
      throw AccessDeniedException;

    case 'SlowDown':
    case 'InternalError':
      throw SlowDownException;

    default:
      throw InternalErrorException;
  }
}

export function handleR2HeadObjectError(error: unknown): never {
  const err = error as {
    name?: string;
    message?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };

  const status = err?.$metadata?.httpStatusCode;

  Logger.error(`R2 HeadObject failed: ${err?.name} - ${err?.message}`);

  switch (err?.name) {
    case 'NotFound':
    case 'NoSuchKey':
    case '404':
      throw ObjectNotFoundException;

    case 'AccessDenied':
    case 'Forbidden':
    case '403':
      throw AccessDeniedException;

    case 'InvalidRequest':
      throw InvalidRequestException;

    case 'SlowDown':
      throw SlowDownException;

    case 'InternalError':
      throw InternalErrorException;
  }

  switch (status) {
    case 404:
      throw ObjectNotFoundException;

    case 403:
      throw AccessDeniedException;

    case 400:
      throw InvalidRequestException;

    case 429:
    case 503:
      throw SlowDownException;

    case 500:
    case 502:
    case 504:
      throw InternalErrorException;

    default:
      throw HeadObjectFailedException;
  }
}
