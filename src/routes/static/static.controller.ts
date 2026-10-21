import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Inject,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { ZodResponse } from 'nestjs-zod';
import envConfig from '../../shared/config.ts';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import { StaticService } from '../../shared/services/static.service.ts';
import {
  GetStaticImageQueryDTO,
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
@Controller('statics')
export class StaticController {
  constructor(@Inject(StaticService) private readonly staticService: StaticService) {}

  @Post('files/upload')
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

  @Get('files/:staticId')
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

  @Post('images/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      dest: tmpdir(),
      limits: {
        fileSize: envConfig.STATIC_UPLOAD_MAX_SIZE_MB * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
    StaticUploadCleanupInterceptor,
  )
  @ZodResponse({ type: UploadStaticFileOutputDTO })
  async uploadImage(
    @UploadedFile(
      new ParseFilePipeBuilder().build({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        fileIsRequired: true,
      }),
    )
    image: UploadedStaticFile,
  ) {
    return this.staticService.uploadImage({
      filePath: image.path,
      originalFileName: image.originalname,
      contentType: image.mimetype,
      size: image.size,
    });
  }

  @Get('images/:staticId')
  @ApiQuery({
    name: 'variant',
    required: false,
    enum: ['small', 'medium', 'large'],
    example: 'medium',
  })
  @ApiResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Image has not changed' })
  @ApiOkResponse({
    description: 'The stored image stream',
    content: {
      'image/*': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async getImage(
    @Param() params: StaticIdParamDTO,
    @Query(new CustomZodValidationPipe(GetStaticImageQueryDTO)) query: GetStaticImageQueryDTO,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const output = await this.staticService.getImage(params.staticId, query.variant);
    const etag = `"${params.staticId}:${query.variant}"`;

    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader('ETag', etag);
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (this.matchesEtag(ifNoneMatch, etag)) {
      output.body.destroy();
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }

    return new StreamableFile(output.body, {
      type: output.contentType,
      disposition: 'inline',
      length: output.size,
    });
  }

  private matchesEtag(ifNoneMatch: string | undefined, etag: string) {
    if (!ifNoneMatch) {
      return false;
    }

    return ifNoneMatch.split(',').some((candidate) => {
      const normalized = candidate.trim();
      return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
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
