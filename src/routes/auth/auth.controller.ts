import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { AuthService } from './auth.service.js';
import envConfig from '../../shared/config.js';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.js';
import { IsPublic } from '../../shared/decorators/auth.decorator.js';
import { UserAgent } from '../../shared/decorators/user-agent.decorator.js';
import { EmptyBodyDTO } from '../../shared/dtos/request.dto.js';
import { MessageResDTO } from '../../shared/dtos/response.dto.js';
import {
  ForgotPasswordInputDTO,
  LoginInputDTO,
  LoginOutputDTO,
  LogoutInputDTO,
  RefreshTokenInputDTO,
  RefreshTokenOutputDTO,
  RegisterInputDTO,
  RegisterOutputDTO,
  SendOTPInputDTO,
} from './auth.dto.ts';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @IsPublic()
  @ZodResponse({ type: RegisterOutputDTO })
  register(@Body() body: RegisterInputDTO, @UserAgent() userAgent: string, @Ip() ip: string) {
    return this.authService.register({
      ...body,
      userAgent,
      ip,
    });
  }

  @Post('otp')
  @IsPublic()
  @ZodResponse({ type: MessageResDTO })
  sendOTP(@Body() body: SendOTPInputDTO) {
    return this.authService.sendOTP(body);
  }

  @Post('login')
  @IsPublic()
  @ZodResponse({ type: LoginOutputDTO })
  login(@Body() body: LoginInputDTO, @UserAgent() userAgent: string, @Ip() ip: string) {
    return this.authService.login({
      ...body,
      userAgent,
      ip,
    });
  }

  @Post('refresh-token')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: RefreshTokenOutputDTO })
  refreshToken(
    @Body() body: RefreshTokenInputDTO,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
  ) {
    return this.authService.refreshToken({
      refreshToken: body.refreshToken,
      userAgent,
      ip,
    });
  }

  @Post('logout')
  @ZodResponse({ type: MessageResDTO })
  logout(@Body() body: LogoutInputDTO) {
    return this.authService.logout(body.refreshToken);
  }

  @Post('forgot-password')
  @IsPublic()
  @ZodResponse({ type: MessageResDTO })
  forgotPassword(@Body() body: ForgotPasswordInputDTO) {
    return this.authService.forgotPassword(body);
  }
}
