import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import {
  GetPublisherEarningsInputDTO,
  GetPublisherEarningsOutputDTO,
  PublisherEarningSummaryOutputDTO,
} from './publisher-earning.dto.ts';
import { PublisherEarningService } from './publisher-earning.service.ts';

// @SkipPermissionCheck on both routes, the same shape GET /publishers/me uses: these read
// the caller's own figures, and the service filters by the authenticated user id.
//
// Not a role permission on purpose. create-permissions.ts only grants to ADMIN and the
// repo has no seed for CUSTOMER or PUBLISHER grants, so a role-gated route here would
// answer 403 for every Publisher until someone edited the database by hand.
@ApiTags('Publisher Earnings')
@ApiBearerAuth('access-token')
@Controller('publisher-earnings')
export class PublisherEarningController {
  constructor(
    @Inject(PublisherEarningService) private readonly service: PublisherEarningService,
  ) {}

  @Get()
  @SkipPermissionCheck()
  @ZodResponse({ type: GetPublisherEarningsOutputDTO })
  listMine(
    @Query() query: GetPublisherEarningsInputDTO,
    @ActiveUser('userId') publisherUserId: string,
  ) {
    return this.service.listMine({ publisherUserId, query });
  }

  @Get('summary')
  @SkipPermissionCheck()
  @ZodResponse({ type: PublisherEarningSummaryOutputDTO })
  summariseMine(@ActiveUser('userId') publisherUserId: string) {
    return this.service.summariseMine(publisherUserId);
  }
}
