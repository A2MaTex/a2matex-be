import { Controller, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProjectReleaseService } from './services/product-release-build.service.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';

@ApiTags('ProductRelease')
@ApiBearerAuth('access-token')
@Controller('product-releases')
export class ProductReleaseController {
  constructor(
    @Inject(ProjectReleaseService) private readonly productReleaseService: ProjectReleaseService,
  ) {}

  @Post(':submissionId')
  build(@Param('submissionId') submissionId: string, @ActiveUser('userId') userId: string) {
    return this.productReleaseService.build({
      submissionId,
      createdById: userId,
    });
  }
}
