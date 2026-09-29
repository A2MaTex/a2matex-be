# Shared Decorators

This folder contains decorators used by controllers to declare authentication behavior and extract request-scoped values.

## Auth

Use `@Auth()` to configure which authentication type a route accepts.

```ts
import { Auth } from '../../shared/decorators/auth.decorator.js';
import { AuthType } from '../../shared/constants/auth.constant.js';

@Get('me')
@Auth([AuthType.Bearer])
getMe() {
  // This route requires a valid Bearer access token.
}
```

When multiple auth types are provided, the default condition is `ConditionGuard.And`.

```ts
import { Auth } from '../../shared/decorators/auth.decorator.js';
import { AuthType, ConditionGuard } from '../../shared/constants/auth.constant.js';

@Get('example')
@Auth([AuthType.Bearer, AuthType.APIKey], { condition: ConditionGuard.Or })
getExample() {
  // This route can be accessed when any configured auth guard passes.
}
```

Only auth types registered in `AuthenticationGuard` can be used. At the moment, `Bearer` and `None` are supported.

## IsPublic

Use `@IsPublic()` for routes that should bypass the default Bearer authentication.

```ts
import { IsPublic } from '../../shared/decorators/auth.decorator.js';

@Post('login')
@IsPublic()
login() {
  // Public route.
}
```

Routes are protected by default because `AuthenticationGuard` falls back to Bearer auth when no auth metadata is provided.

## ActiveUser

Use `@ActiveUser()` to read the access-token payload attached by `AccessTokenGuard`.

```ts
import { ActiveUser } from '../../shared/decorators/active-user.decorator.js';
import type { AccessTokenPayload } from '../../shared/types/jwt.type.js';

@Get('me')
getMe(@ActiveUser() user: AccessTokenPayload) {
  return user;
}
```

You can also extract a single field.

```ts
@Get('me')
getMe(@ActiveUser('userId') userId: string) {
  return { userId };
}
```

Available fields come from `AccessTokenPayload`: `userId`, `deviceId`, `roleId`, `roleName`, `exp`, and `iat`.

Do not use `@ActiveUser()` on public routes unless the route manually guarantees that request user data exists.

## ActiveRolePermissions

Use `@ActiveRolePermissions()` to read the role permission payload attached by `AccessTokenGuard`.

```ts
import { ActiveRolePermissions } from '../../shared/decorators/active-role-permissions.decorator.js';
import type { RolePermissionPayload } from '../../shared/types/role-permission.type.js';

@Get('me/permissions')
getPermissions(@ActiveRolePermissions() rolePermissions: RolePermissionPayload) {
  return rolePermissions;
}
```

You can also extract a single field.

```ts
@Get('me/permissions')
getPermissions(@ActiveRolePermissions('permissions') permissions: RolePermissionPayload['permissions']) {
  return permissions;
}
```

Available fields are `roleId` and `permissions`.

## UserAgent

Use `@UserAgent()` to read the incoming `user-agent` header.

```ts
import { UserAgent } from '../../shared/decorators/user-agent.decorator.js';

@Post('login')
login(@UserAgent() userAgent: string) {
  return { userAgent };
}
```

This decorator is useful for auth flows that store or validate device/session metadata.

## Transactional

Use `@Transactional()` on service methods that need multiple database operations to commit or rollback together.

```ts
import { Transactional } from '../../shared/decorators/transactional.decorator.js';
import { TransactionService } from '../../shared/services/transaction.service.js';

@Injectable()
export class RoleService {
  constructor(private readonly transactionService: TransactionService) {}

  @Transactional()
  private async syncRolePermissions() {
    // Repository methods called here must use the current Prisma client.
  }
}
```

The decorated class must inject `TransactionService` as `transactionService`. Repository methods that should join the transaction should resolve the current Prisma client at execution time, usually with a getter:

```ts
private get prisma() {
  return this.prismaService.getClient();
}
```

Use `this.prisma` in repository methods instead of calling `this.prismaService` delegates directly. Do not store `this.prismaService.getClient()` in a class field because that would capture the normal client before a transaction starts.

## Typical Controller Example

```ts
@Controller('users')
export class UserController {
  @Get('me')
  getMe(@ActiveUser('userId') userId: string) {
    return this.userService.getMe(userId);
  }

  @Post('login')
  @IsPublic()
  login(@Body() body: LoginInputDTO, @UserAgent() userAgent: string) {
    return this.authService.login({ ...body, userAgent });
  }
}
```
