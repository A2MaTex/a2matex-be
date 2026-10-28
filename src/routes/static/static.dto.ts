import { createZodDto } from 'nestjs-zod';
import {
  CompleteMultipartUploadInput,
  CompleteMultipartUploadOutput,
  GetBatchUrlsInput,
  GetBatchUrlsOutput,
  GetStaticImageQuery,
  StaticIdParam,
  UploadMultipartFileInput,
  UploadStaticFileInput,
  UploadStaticFileOutput,
} from './static.model.ts';

export class StaticIdParamDTO extends createZodDto(StaticIdParam) {}

export class UploadStaticFileInputDTO extends createZodDto(UploadStaticFileInput) {}

export class UploadStaticFileOutputDTO extends createZodDto(UploadStaticFileOutput) {}

export class GetStaticImageQueryDTO extends createZodDto(GetStaticImageQuery) {}

export class UploadMultipartFileInputDTO extends createZodDto(UploadMultipartFileInput) {}

export class GetBatchUrlsInputDTO extends createZodDto(GetBatchUrlsInput) {}

export class GetBatchUrlsOutputDTO extends createZodDto(GetBatchUrlsOutput) {}

export class CompleteMultipartUploadInputDTO extends createZodDto(CompleteMultipartUploadInput) {}

export class CompleteMultipartUploadOutputDTO extends createZodDto(CompleteMultipartUploadOutput) {}
