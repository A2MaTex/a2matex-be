import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseFilePipeBuilder,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { ZodResponse } from 'nestjs-zod';
import envConfig from '../../shared/config.ts';
import { StaticService } from '../../shared/services/static.service.ts';
import {
  StaticIdParamDTO,
  UploadStaticFileInputDTO,
  UploadStaticFileOutputDTO,
} from './static.dto.ts';
import { StaticUploadCleanupInterceptor } from './static-upload-cleanup.interceptor.ts';

type UploadedStaticFile = {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
};

@ApiTags('Statics')
@ApiBearerAuth('access-token')
@Controller('statics/files')
export class StaticController {
  constructor(@Inject(StaticService) private readonly staticService: StaticService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        prefix: {
          type: 'string',
          example: 'launcher/releases',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      dest: tmpdir(),
      limits: {
        fileSize: envConfig.STATIC_UPLOAD_MAX_SIZE_MB * 1024 * 1024, // Bytes
        files: 1,
        fields: 1,
        parts: 2,
      },
    }),
    StaticUploadCleanupInterceptor,
  )
  @ZodResponse({ type: UploadStaticFileOutputDTO })
  async uploadFile(
    @UploadedFile(
      new ParseFilePipeBuilder().build({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        fileIsRequired: true,
      }),
    )
    file: UploadedStaticFile,
    @Body() body: UploadStaticFileInputDTO,
  ) {
    const fileStream = createReadStream(file.path);
    try {
      return await this.staticService.uploadFile({
        body: fileStream,
        originalFileName: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        prefix: body.prefix,
      });
    } finally {
      fileStream.destroy();
    }
  }

  @Get(':staticId')
  @ApiOkResponse({
    description: 'The stored file stream',
    content: {
      'application/octet-stream': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async getFile(@Param() params: StaticIdParamDTO) {
    const output = await this.staticService.getFile(params.staticId);
    return new StreamableFile(output.body, {
      type: output.static.contentType,
      disposition: buildAttachmentDisposition(output.static.originalFileName),
      length: Number(output.static.size),
    });
  }
}

function buildAttachmentDisposition(fileName: string) {
  const safeFileName = fileName.replaceAll(/[\r\n]/g, '');
  const fallbackFileName =
    safeFileName.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '_') || 'download';
  const encodedFileName = encodeURIComponent(safeFileName).replaceAll(/[!'()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`;
}
