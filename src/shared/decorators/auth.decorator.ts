import { SetMetadata } from '@nestjs/common';
import {
  AuthType,
  AuthTypeType,
  ConditionGuard,
  ConditionGuardType,
} from '../constants/auth.constant.js';

export const AUTH_TYPE_KEY = 'authType';
export const SKIP_PERMISSION_CHECK_KEY = 'skipPermissionCheck';

export type AuthTypeDecoratorPayload = {
  authTypes: AuthTypeType[];
  options: { condition: ConditionGuardType };
};

export const Auth = (authTypes: AuthTypeType[], options?: { condition: ConditionGuardType }) => {
  return SetMetadata(AUTH_TYPE_KEY, {
    authTypes,
    options: options ?? { condition: ConditionGuard.And },
  });
};

export const IsPublic = () => Auth([AuthType.None]);

export const SkipPermissionCheck = () => SetMetadata(SKIP_PERMISSION_CHECK_KEY, true);
