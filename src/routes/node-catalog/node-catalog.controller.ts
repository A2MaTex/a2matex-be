import { Controller, Get, Headers, HttpStatus, Inject, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { GetNodeCatalogInputDTO, GetNodeCatalogOutputDTO } from './node-catalog.dto.ts';
import { NodeCatalogService } from './node-catalog.service.ts';

@ApiTags('Node Catalog')
@Controller('node-catalog')
export class NodeCatalogController {
  constructor(
    @Inject(NodeCatalogService) private readonly nodeCatalogService: NodeCatalogService,
  ) {}

  @Get()
  @ApiBearerAuth('access-token')
  @ApiResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Catalog has not changed' })
  @ZodResponse({ type: GetNodeCatalogOutputDTO })
  async getCatalog(
    @Query() query: GetNodeCatalogInputDTO,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const catalog = await this.nodeCatalogService.getCatalog(query);
    const etag = `"${catalog.catalogHash}"`;
    response.setHeader('ETag', etag);

    if (this.matchesEtag(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
    }

    return catalog;
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
