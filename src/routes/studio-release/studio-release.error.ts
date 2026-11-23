import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const StudioReleaseNotFoundException = new NotFoundException('Error.StudioReleaseNotFound');

export const ActiveStudioReleaseNotFoundException = new NotFoundException(
  'Error.ActiveStudioReleaseNotFound',
);

export const StudioReleaseAlreadyActiveException = new ConflictException(
  'Error.StudioReleaseAlreadyActive',
);

export const StudioReleaseNotActiveException = new ConflictException(
  'Error.StudioReleaseNotActive',
);

export const StudioReleaseVersionTakenException = new ConflictException(
  'Error.StudioReleaseVersionTaken',
);

// Đổi version hoặc tệp của bản đang hiệu lực sẽ làm người dùng nhận hai tệp khác nhau
// dưới cùng một số phiên bản.
export const StudioReleaseActiveNotEditableException = new ConflictException(
  'Error.StudioReleaseActiveNotEditable',
);

export const StudioReleaseStaticNotFoundException = new UnprocessableEntityException([
  {
    message: 'Error.StaticNotFound',
    path: 'staticId',
  },
]);
