import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  AdminEntitlementOutputDTO,
  EntitlementIdParamDTO,
  GetAdminEntitlementsInputDTO,
  GetAdminEntitlementsOutputDTO,
  GrantEntitlementInputDTO,
  RevokeEntitlementInputDTO,
} from './entitlement.dto.ts';
import { EntitlementService } from './entitlement.service.ts';

// Admin-only: the permission seed assigns these routes to the ADMIN role and no other.
@ApiTags('Entitlement Management')
@ApiBearerAuth('access-token')
@Controller('admin/entitlements')
export class AdminEntitlementController {
  constructor(
    @Inject(EntitlementService) private readonly entitlementService: EntitlementService,
  ) {}

  @Get()
  @ZodResponse({ type: GetAdminEntitlementsOutputDTO })
  list(@Query() query: GetAdminEntitlementsInputDTO) {
    return this.entitlementService.listAdmin(query);
  }

  // Sets the period to what the Admin entered, whatever the current state (also lifts a
  // revocation). Only for a Product that is on sale.
  @Post('grant')
  @HttpCode(200)
  @ZodResponse({ type: AdminEntitlementOutputDTO })
  grant(@Body() body: GrantEntitlementInputDTO, @ActiveUser('userId') adminUserId: string) {
    return this.entitlementService.grant({ data: body, adminUserId });
  }

  @Post(':entitlementId/revoke')
  @HttpCode(200)
  @ZodResponse({ type: AdminEntitlementOutputDTO })
  revoke(
    @Param() params: EntitlementIdParamDTO,
    @Body() body: RevokeEntitlementInputDTO,
    @ActiveUser('userId') adminUserId: string,
  ) {
    return this.entitlementService.revoke({
      entitlementId: params.entitlementId,
      reason: body.reason,
      adminUserId,
    });
  }
}
