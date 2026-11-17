import { ConflictException, NotFoundException } from '@nestjs/common';

export const ProductReleaseNotFoundException = new NotFoundException(
  'Error.ProductReleaseNotFound',
);

export const ProductReleaseNotSelectableException = new ConflictException(
  'Error.ProductReleaseNotSelectable',
);

export const ProductReleaseSelectionUnavailableException = new ConflictException(
  'Error.ProductReleaseSelectionUnavailable',
);

export const ProductReleaseNotDisableableException = new ConflictException(
  'Error.ProductReleaseNotDisableable',
);

export const ProductReleaseDisableConflictException = new ConflictException(
  'Error.ProductReleaseDisableConflict',
);

export const ProductReleaseReplacementRequiredException = new ConflictException(
  'Error.ProductReleaseReplacementRequired',
);

export const ProductReleaseReplacementInvalidException = new ConflictException(
  'Error.ProductReleaseReplacementInvalid',
);
