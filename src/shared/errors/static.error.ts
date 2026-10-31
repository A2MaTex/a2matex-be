import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const R2NotReturnUploadIdException = new InternalServerErrorException(
  'Error.R2NotReturnUploadId',
);
export const MissingNextPartMarkerException = new InternalServerErrorException(
  'Error.MissingNextPartMarker',
);
export const UploadSessionNotFoundException = new NotFoundException('Error.UploadSessionNotFound');
export const UploadedPartsNotFoundException = new NotFoundException('Error.UploadedPartsNotFound');
export const InvalidPartOrderException = new BadRequestException('Error.InvalidPartOrder');

// All parts except the last must be at least 5 MiB
export const EntityTooSmallException = new BadRequestException('Error.EntityTooSmall');
// Invalid multipart upload completion request
export const InvalidRequestException = new BadRequestException('Error.InvalidRequest');
export const AccessDeniedException = new ForbiddenException('Error.AccessDenied');
export const SlowDownException = new ServiceUnavailableException('Error.SlowDown');
export const InternalErrorException = new InternalServerErrorException('Error.InternalError');

export const AbortMultipartUploadFailedException = new InternalServerErrorException(
  'Error.AbortMultipartUploadFailed',
);

export const ObjectNotFoundException = new NotFoundException('Error.ObjectNotFound');

export const HeadObjectFailedException = new InternalServerErrorException('Error.HeadObjectFailed');

export const GenerateDownloadUrlFailedException = new InternalServerErrorException(
  'Error.GenerateDownloadUrlFailed',
);

export const InvalidNumberOfPartsException = new BadRequestException('Error.InvalidNumberOfParts');

export const InvalidPrefixException = new BadRequestException('Error.InvalidPrefix');

export const InvalidStaticMultipartUploadContentTypeException = new UnprocessableEntityException([
  {
    message: 'Error.InvalidMultipartUploadContentType',
    path: 'file',
  },
]);
