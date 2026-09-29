import { HttpException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addMilliseconds } from 'date-fns';
import { AuthRepository } from './auth.repo.js';
import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.js';
import { HashingService } from '../../shared/services/hashing.service.js';
import { TokenService } from '../../shared/services/token.service.js';
import ms, { StringValue } from 'ms';
import envConfig from '../../shared/config.js';
import {
  TypeOfVerificationCode,
  TypeOfVerificationCodeType,
  UserStatus,
} from '../../shared/constants/auth.constant.js';
import { EmailService } from '../../shared/services/email.service.js';
import { AccessTokenPayloadCreate } from '../../shared/types/jwt.type.js';
import {
  EmailAlreadyExistsException,
  EmailOrUsernameNotFoundException,
  EmailNotFoundException,
  AccountBlockedException,
  FailedToSendOTPException,
  InvalidOTPException,
  OTPExpiredException,
  RefreshTokenAlreadyUsedException,
  UnauthorizedAccessException,
  UsernameAlreadyExistsException,
} from './auth.error.js';
import { SharedRoleRepository } from '../../shared/repositories/shared-role.repo.js';
import { RoleName } from '../../shared/constants/role.constant.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import {
  ForgotPasswordInputType,
  LoginInputType,
  RefreshTokenInputType,
  RegisterInputType,
  SendOTPInputType,
} from './auth.model.ts';
import { isNotFoundPrismaError, isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { generateOTP } from '../../shared/utils/utils.ts';
import { InvalidPasswordException } from '../../shared/types/error.type.ts';

@Injectable()
export class AuthService {
  constructor(
    @Inject(HashingService) private readonly hashingService: HashingService,
    @Inject(SharedRoleRepository) private readonly sharedRoleRepository: SharedRoleRepository,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
    @Inject(SharedUserRepository) private readonly sharedUserRepository: SharedUserRepository,
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(TokenService) private readonly tokenService: TokenService,
  ) {}

  async validateVerificationCode({
    email,
    type,
    code,
  }: {
    email: string;
    type: TypeOfVerificationCodeType;
    code: string;
  }) {
    const vevificationCode = await this.authRepository.findUniqueVerificationCode({
      email_type: {
        email,
        type,
      },
    });
    if (!vevificationCode || vevificationCode.code !== code) {
      throw InvalidOTPException;
    }
    if (new Date(vevificationCode.expiresAt) < new Date()) {
      throw OTPExpiredException;
    }
    return vevificationCode;
  }

  async register(body: RegisterInputType & { userAgent: string; ip: string }) {
    try {
      await this.validateRegisterAccountIsUnique({
        email: body.email,
        username: body.username,
      });
      await this.validateVerificationCode({
        email: body.email,
        type: TypeOfVerificationCode.REGISTER,
        code: body.code,
      });
      const [customerRoleId, hashedPassword] = await Promise.all([
        this.sharedRoleRepository.getCustomerRoleId(),
        this.hashingService.hash(body.password),
      ]);
      const user = await this.authRepository.createUserIncludeRole({
        email: body.email,
        username: body.username,
        password: hashedPassword,
        fullName: body.fullName,
        roleId: customerRoleId,
      });

      const [device] = await Promise.all([
        this.authRepository.createDevice({
          userId: user.id,
          userAgent: body.userAgent,
          ip: body.ip,
          lastActive: new Date(),
        }),
        this.authRepository.deleteVerificationCode({
          email_type: {
            email: body.email,
            type: TypeOfVerificationCode.REGISTER,
          },
        }),
      ]);

      return this.generateTokens({
        userId: user.id,
        deviceId: device.id,
        roleId: customerRoleId,
        roleName: RoleName.Customer,
      });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        await this.validateRegisterAccountIsUnique({
          email: body.email,
          username: body.username,
        });
        throw EmailAlreadyExistsException;
      }
      throw error;
    }
  }

  async sendOTP(body: SendOTPInputType) {
    const user = await this.sharedUserRepository.findUnique({
      email: body.email,
    });
    if (body.type === TypeOfVerificationCode.REGISTER && user) {
      throw EmailAlreadyExistsException;
    }
    if (body.type === TypeOfVerificationCode.FORGOT_PASSWORD && !user) {
      throw EmailNotFoundException;
    }

    const code = generateOTP();
    await this.authRepository.createVerificationCode({
      email: body.email,
      code,
      type: body.type,
      expiresAt: addMilliseconds(new Date(), ms(envConfig.OTP_EXPIRES_IN as StringValue)),
    });

    const { error } = await this.emailService.sendOTP({
      email: body.email,
      code,
    });
    if (error) {
      throw FailedToSendOTPException;
    }
    return SUCCESS_RESPONSE;
  }

  async login(body: LoginInputType & { userAgent: string; ip: string }) {
    const user = await this.authRepository.findUniqueUserIncludeRole({
      account: body.account,
    });
    if (!user) {
      throw EmailOrUsernameNotFoundException;
    }
    if (user.status === UserStatus.BANNED) {
      throw AccountBlockedException;
    }

    const isPasswordMatch = await this.hashingService.compare(body.password, user.password);
    if (!isPasswordMatch) {
      throw InvalidPasswordException;
    }

    const device = await this.authRepository.createDevice({
      userId: user.id,
      userAgent: body.userAgent,
      ip: body.ip,
      lastActive: new Date(),
    });

    const tokens = await this.generateTokens({
      userId: user.id,
      deviceId: device.id,
      roleId: user.roleId,
      roleName: user.role.name,
    });
    return tokens;
  }

  private async validateRegisterAccountIsUnique({
    email,
    username,
  }: Pick<RegisterInputType, 'email' | 'username'>) {
    const existingAccounts = await this.authRepository.findExistingRegisterAccounts({
      email,
      username,
    });
    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = username.toLowerCase();

    if (existingAccounts.some((account) => account.email.toLowerCase() === normalizedEmail)) {
      throw EmailAlreadyExistsException;
    }

    if (
      existingAccounts.some((account) => account.username.toLowerCase() === normalizedUsername)
    ) {
      throw UsernameAlreadyExistsException;
    }
  }

  async generateTokens({ userId, deviceId, roleId, roleName }: AccessTokenPayloadCreate) {
    const refreshTokenId = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken({
        userId,
        deviceId,
        roleId,
        roleName,
      }),
      this.tokenService.signRefreshToken({
        refreshTokenId,
        userId,
        deviceId,
      }),
    ]);
    const decodedRefreshToken = await this.tokenService.verifyRefreshToken(refreshToken);
    await this.authRepository.createRefreshToken({
      id: refreshTokenId,
      token: refreshToken,
      userId,
      expiresAt: new Date(decodedRefreshToken.exp * 1000),
      deviceId,
    });
    return { accessToken, refreshToken };
  }

  async refreshToken({
    refreshToken,
    userAgent,
    ip,
  }: RefreshTokenInputType & { userAgent: string; ip: string }) {
    try {
      const { userId } = await this.tokenService.verifyRefreshToken(refreshToken);

      const refreshTokenInDb =
        await this.authRepository.findUniqueRefreshTokenIncludeUserRole(refreshToken);
      if (!refreshTokenInDb) {
        throw RefreshTokenAlreadyUsedException;
      }
      if (refreshTokenInDb.user.status === UserStatus.BANNED) {
        throw AccountBlockedException;
      }
      const {
        deviceId,
        user: {
          roleId,
          role: { name: roleName },
        },
      } = refreshTokenInDb;

      const $updateDevice = this.authRepository.updateDevice(deviceId, {
        ip,
        userAgent,
      });

      const $deleteRefreshToken = this.authRepository.deleteRefreshToken({
        token: refreshToken,
      });

      const $tokens = this.generateTokens({
        userId,
        roleId,
        roleName,
        deviceId,
      });

      const [, , tokens] = await Promise.all([$updateDevice, $deleteRefreshToken, $tokens]);

      return tokens;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw UnauthorizedAccessException;
    }
  }

  async logout(refreshToken: string) {
    try {
      const { refreshTokenId, deviceId } = await this.tokenService.verifyRefreshToken(refreshToken);

      const $deleteRefreshToken = this.authRepository.deleteRefreshToken({
        id: refreshTokenId,
      });

      const $updateDevice = this.authRepository.updateDevice(deviceId, {
        isActive: false,
      });

      await Promise.all([$deleteRefreshToken, $updateDevice]);
      return SUCCESS_RESPONSE;
    } catch (error) {
      if (isNotFoundPrismaError(error)) {
        throw RefreshTokenAlreadyUsedException;
      }
      throw UnauthorizedAccessException;
    }
  }

  async forgotPassword(body: ForgotPasswordInputType) {
    const { email, code, newPassword } = body;

    const user = await this.sharedUserRepository.findUnique({
      email,
    });
    if (!user) {
      throw EmailNotFoundException;
    }

    await this.validateVerificationCode({
      email,
      type: TypeOfVerificationCode.FORGOT_PASSWORD,
      code,
    });

    const hashedPassword = await this.hashingService.hash(newPassword);
    await Promise.all([
      this.sharedUserRepository.update(
        { id: user.id },
        {
          password: hashedPassword,
        },
      ),
      this.authRepository.deleteVerificationCode({
        email_type: {
          email: body.email,
          type: TypeOfVerificationCode.FORGOT_PASSWORD,
        },
      }),
    ]);
    return SUCCESS_RESPONSE;
  }
}
