import { createZodDto } from 'nestjs-zod';
import {
  AdminEntitlementOutput,
  EntitlementIdParam,
  GetAdminEntitlementsInput,
  GetAdminEntitlementsOutput,
  GetMyEntitlementsInput,
  GetMyEntitlementsOutput,
  GrantEntitlementInput,
  RevokeEntitlementInput,
} from './entitlement.model.ts';

export class EntitlementIdParamDTO extends createZodDto(EntitlementIdParam) {}
export class AdminEntitlementOutputDTO extends createZodDto(AdminEntitlementOutput) {}

export class GrantEntitlementInputDTO extends createZodDto(GrantEntitlementInput) {}
export class RevokeEntitlementInputDTO extends createZodDto(RevokeEntitlementInput) {}

export class GetMyEntitlementsInputDTO extends createZodDto(GetMyEntitlementsInput) {}
export class GetMyEntitlementsOutputDTO extends createZodDto(GetMyEntitlementsOutput) {}

export class GetAdminEntitlementsInputDTO extends createZodDto(GetAdminEntitlementsInput) {}
export class GetAdminEntitlementsOutputDTO extends createZodDto(GetAdminEntitlementsOutput) {}
