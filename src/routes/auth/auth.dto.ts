import { createZodDto } from 'nestjs-zod';
import {
  ForgotPasswordInput,
  LoginInput,
  LoginOutput,
  LogoutInput,
  RefreshTokenInput,
  RefreshTokenOutput,
  RegisterInput,
  RegisterOutput,
  SendOTPInput,
} from './auth.model.ts';

export class RegisterInputDTO extends createZodDto(RegisterInput) {}

export class RegisterOutputDTO extends createZodDto(RegisterOutput, {
  codec: true,
}) {}

export class SendOTPInputDTO extends createZodDto(SendOTPInput) {}

export class LoginInputDTO extends createZodDto(LoginInput) {}

export class LoginOutputDTO extends createZodDto(LoginOutput) {}

export class RefreshTokenInputDTO extends createZodDto(RefreshTokenInput) {}

export class RefreshTokenOutputDTO extends createZodDto(RefreshTokenOutput) {}

export class LogoutInputDTO extends createZodDto(LogoutInput) {}

export class ForgotPasswordInputDTO extends createZodDto(ForgotPasswordInput) {}
