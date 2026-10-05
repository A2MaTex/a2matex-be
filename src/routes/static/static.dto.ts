import { createZodDto } from 'nestjs-zod';
import { StaticIdParam, UploadStaticFileInput, UploadStaticFileOutput } from './static.model.ts';

export class StaticIdParamDTO extends createZodDto(StaticIdParam) {}

export class UploadStaticFileInputDTO extends createZodDto(UploadStaticFileInput) {}

export class UploadStaticFileOutputDTO extends createZodDto(UploadStaticFileOutput) {}
