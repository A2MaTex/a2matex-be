import {
  BadRequestException,
  Body,
  Controller,
  HttpStatus,
  Inject,
  PayloadTooLargeException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { json, type RequestHandler, type Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { EXECUTION_AUTHORIZATION_BODY_MAX_BYTES } from '../../shared/constants/execution-authorization.constant.ts';
import {
  ExecutionAuthorizationInputDTO,
  ExecutionAuthorizationOutputDTO,
  RenewalAuthorizationInputDTO,
  RenewalAuthorizationParamsDTO,
  RenewalAuthorizationQueryDTO,
  RenewalAuthorizationOutputDTO,
} from './execution-authorization.dto.ts';
import { ExecutionAuthorizationService } from './execution-authorization.service.ts';

// Installed before the global parser so the smaller family limit also covers
// chunked bodies. Parser errors must not expose their attached request body.
export function executionAuthorizationTransport(): RequestHandler {
  const parse = json({ limit: EXECUTION_AUTHORIZATION_BODY_MAX_BYTES });
  return (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    parse(request, response, (error?: unknown) => {
      if (!error) return next();
      const type =
        typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
      return next(
        type === 'entity.too.large' ? new PayloadTooLargeException() : new BadRequestException(),
      );
    });
  };
}

@ApiTags('Execution authorizations')
@ApiBearerAuth('access-token')
@Controller('execution-authorizations')
export class ExecutionAuthorizationController {
  constructor(
    @Inject(ExecutionAuthorizationService) private readonly service: ExecutionAuthorizationService,
  ) {}

  @Post()
  @ZodResponse({ status: HttpStatus.CREATED, type: ExecutionAuthorizationOutputDTO })
  @ApiOkResponse({
    type: ExecutionAuthorizationOutputDTO,
    description: 'Identical committed request replay',
  })
  async start(
    @Body(new CustomZodValidationPipe(ExecutionAuthorizationInputDTO))
    body: ExecutionAuthorizationInputDTO,
    @ActiveUser('userId') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.issueInitial({ userId, data: body });
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      requestId: result.requestId,
      executionId: result.executionId,
      authorization: {
        lease: result.lease,
        keyEnvelope: result.keyEnvelope,
        serverTime: new Date(result.serverTime),
      },
    };
  }

  @Post(':leaseFamilyId/renew')
  @ZodResponse({ status: HttpStatus.CREATED, type: RenewalAuthorizationOutputDTO })
  @ApiOkResponse({
    type: RenewalAuthorizationOutputDTO,
    description: 'Identical committed renewal replay',
  })
  async renew(
    @Param(new CustomZodValidationPipe(RenewalAuthorizationParamsDTO))
    params: RenewalAuthorizationParamsDTO,
    @Body(new CustomZodValidationPipe(RenewalAuthorizationInputDTO))
    body: RenewalAuthorizationInputDTO,
    @Query(new CustomZodValidationPipe(RenewalAuthorizationQueryDTO))
    _query: RenewalAuthorizationQueryDTO,
    @ActiveUser('userId') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.renew({
      userId,
      leaseFamilyId: params.leaseFamilyId,
      data: body,
    });
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      requestId: result.requestId,
      executionId: result.executionId,
      authorization: { lease: result.lease, serverTime: new Date(result.serverTime) },
    };
  }
}
