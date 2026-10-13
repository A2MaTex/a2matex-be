import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { AuthService } from './auth.service.js';
import { AuthCookieName } from '../../shared/constants/auth.constant.ts';
import { IsPublic } from '../../shared/decorators/auth.decorator.js';
import { UserAgent } from '../../shared/decorators/user-agent.decorator.js';
import { MessageResDTO } from '../../shared/dtos/response.dto.js';
import {
  clearAuthCookies,
  getRequestCookie,
  setAuthCookies,
} from '../../shared/utils/auth-cookie.ts';
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

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @IsPublic()
  @ZodResponse({ type: RegisterOutputDTO })
  async register(
    @Body() body: RegisterInputDTO,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.authService.register({
      ...body,
      userAgent,
      ip,
    });
    setAuthCookies(response, tokens);

    return tokens;
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
  async login(
    @Body() body: LoginInputDTO,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.authService.login({
      ...body,
      userAgent,
      ip,
    });
    setAuthCookies(response, tokens);

    return tokens;
  }

  @Post('refresh-token')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: RefreshTokenOutputDTO })
  async refreshToken(
    @Body() body: RefreshTokenInputDTO,
    @Req() request: Request,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.resolveRefreshToken(body.refreshToken, request);
    const tokens = await this.authService.refreshToken({
      refreshToken,
      userAgent,
      ip,
    });
    setAuthCookies(response, tokens);

    return tokens;
  }

  @Post('logout')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  async logout(
    @Body() body: LogoutInputDTO,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.resolveRefreshToken(body.refreshToken, request);
    const result = await this.authService.logout(refreshToken);
    clearAuthCookies(response);

    return result;
  }

  @Post('forgot-password')
  @IsPublic()
  @ZodResponse({ type: MessageResDTO })
  forgotPassword(@Body() body: ForgotPasswordInputDTO) {
    return this.authService.forgotPassword(body);
  }

  private resolveRefreshToken(bodyToken: string | undefined, request: Request): string {
    const refreshToken = bodyToken ?? getRequestCookie(request, AuthCookieName.RefreshToken);
    if (!refreshToken) {
      throw new UnauthorizedException('Error.MissingRefreshToken');
    }

    return refreshToken;
  }
}
