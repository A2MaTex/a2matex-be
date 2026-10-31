import {
  Body,
  Controller,
  Delete,
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
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import { StaticService } from '../../shared/services/static.service.ts';
import {
  CompleteMultipartUploadInputDTO,
  CompleteMultipartUploadOutputDTO,
  GetBatchUrlsInputDTO,
  GetBatchUrlsOutputDTO,
  GetCompletedPartsInputDTO,
  GetStaticImageQueryDTO,
  StaticIdParamDTO,
  UploadMultipartFileInputDTO,
  UploadStaticFileInputDTO,
  UploadStaticFileOutputDTO,
} from './static.dto.ts';
import { StaticUploadCleanupInterceptor } from './static-upload-cleanup.interceptor.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  completeMultipartUploadBody,
  getBatchUrlsBody,
  getCompletedPartsBody,
  startMultipartUploadBody,
} from './static.api-body.ts';

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

  @Delete(':staticId')
  @ZodResponse({ type: MessageResDTO })
  deleteStatic(@Param() params: StaticIdParamDTO) {
    return this.staticService.deleteStatic(params.staticId);
  }

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

  // MULTIPART UPLOAD
  @Post('/files/multipart/start')
  @ApiBody(startMultipartUploadBody)
  async startUploadFileMultipart(
    @Body() body: UploadMultipartFileInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.staticService.startUploadMultipartFile({
      originalFileName: body.originalFileName,
      lastModified: body.lastModified,
      contentType: body.contentType,
      size: body.size,
      prefix: body.prefix,
      userId: userId,
      requestedPartNumbers: body.requestedPartNumbers,
    });
  }
  @Post('/files/multipart/parts/completed')
  @ApiBody(getCompletedPartsBody)
  async getCompletedParts(
    @Body(new CustomZodValidationPipe(GetCompletedPartsInputDTO)) body: GetCompletedPartsInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.staticService.getCompletedPart({
      originalFileName: body.originalFileName,
      lastModified: body.lastModified,
      contentType: body.contentType,
      size: body.size,
      userId: userId,
    });
  }

  @Post('/files/multipart/urls')
  @ApiConsumes('application/json')
  @ApiBody(getBatchUrlsBody)
  @ZodResponse({ type: GetBatchUrlsOutputDTO })
  async getBatchUrls(
    @Body(new CustomZodValidationPipe(GetBatchUrlsInputDTO)) body: GetBatchUrlsInputDTO,
  ) {
    return this.staticService.getBatchUrls({
      sessionId: body.sessionId,
      partNumbers: body.partNumbers,
    });
  }

  @Post('/files/multipart/complete')
  @ApiBody(completeMultipartUploadBody)
  @ZodResponse({ type: CompleteMultipartUploadOutputDTO })
  async completeMultipartUpload(
    @Body(new CustomZodValidationPipe(CompleteMultipartUploadInputDTO))
    body: CompleteMultipartUploadInputDTO,
  ) {
    return this.staticService.completeMultipartUpload({
      sessionId: body.sessionId,
      parts: body.parts,
    });
  }

  @Post('/files/multipart/abort')
  async abortMultipartUpload(
    @Param('sessionId') sessionId: string,
    @ActiveUser('userId') userId: string,
  ) {
    return this.staticService.abortUploadSession(sessionId, userId);
  }

  @Post('/files/multipart/cleanup-expired')
  async cleanupIncompleteUploads() {
    return this.staticService.cleanExpiredUploadSessions();
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
