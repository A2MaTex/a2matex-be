import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts user-agent string from the incoming request headers.
 * Available for use in controller methods decorated with @Get, @Post, @Patch, etc.
 */
export const UserAgent = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.headers['user-agent'];
});
