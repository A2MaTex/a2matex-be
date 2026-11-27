import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  GetDownloadUrlOutputDTO,
  GetStaticImageQueryDTO,
  StaticIdParamDTO,
  UploadMultipartFileInputDTO,
  UploadStaticFileInputDTO,
  UploadStaticFileOutputDTO,
} from './static.dto.ts';
import { StaticUploadCleanupInterceptor } from './static-upload-cleanup.interceptor.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { EntitlementService } from '../entitlement/entitlement.service.ts';
import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.ts';
import { StaticRepository } from '../../shared/repositories/static.repo.ts';
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
  constructor(
    @Inject(StaticService) private readonly staticService: StaticService,
    @Inject(StaticRepository) private readonly staticRepository: StaticRepository,
    @Inject(EntitlementService) private readonly entitlementService: EntitlementService,
    @Inject(SharedUserRepository) private readonly sharedUserRepo: SharedUserRepository,
  ) {}

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
  async getFile(
    @Param() params: StaticIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    await this.assertPackageFileAccess(params.staticId, userId, scopes);
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

  // Marketplace cards and Publisher avatars are read by anonymous visitors, so the image
  // bytes must be reachable without a token. The Static ID is the capability.
  @Get('images/:staticId')
  @IsPublic()
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

    // A Static ID plus variant addresses one immutable object: re-uploading creates a new
    // Static row, so a cached copy can never go stale and never needs invalidating.
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

  @Get('files/:staticId/download-url')
  @ZodResponse({ type: GetDownloadUrlOutputDTO })
  async downloadFile(
    @Param() params: StaticIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    await this.assertPackageFileAccess(params.staticId, userId, scopes);
    return this.staticService.getDownloadUrl(params.staticId);
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
  async abortMultipartUpload(@Param('sessionId') sessionId: string) {
    return this.staticService.abortUploadSession(sessionId);
  }

  @Post('/files/multipart/cleanup-expired')
  async cleanupIncompleteUploads() {
    return this.staticService.cleanExpiredUploadSessions();
  }

  /**
   * Minimal package-file access guard. If the requested staticId is a `packageStaticId`
   * on any ProductRelease, the caller must hold an active entitlement for that product.
   * Admin (scope === null) and Publisher callers bypass this check so their existing
   * workflows remain unaffected. Unrelated statics (images, uploads) are never blocked.
   */
  private async assertPackageFileAccess(
    staticId: string,
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<void> {
    // Admin (unrestricted, null scope) and Publisher callers are permitted unconditionally.
    if (scopes.includes(null) || scopes.some((s) => s !== null)) {
      return;
    }

    const productId = await this.staticRepository.findProductIdByPackageStaticId(staticId);
    if (!productId) {
      // Not a package static — no extra check needed.
      return;
    }

    // Customer path: require active Customer account + valid entitlement.
    const hasCustomer = await this.sharedUserRepo.hasActiveCustomer(userId);
    if (!hasCustomer) {
      throw new ForbiddenException('Error.PackageAccessDenied');
    }

    const usage = await this.entitlementService.checkUsage({ customerId: userId, productId });
    if (!usage.usable) {
      throw new ForbiddenException('Error.PackageAccessDenied');
    }
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
