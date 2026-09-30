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
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';

@Injectable()
export class AuthService {
  constructor(
    @Inject(HashingService) private readonly hashingService: HashingService,
    @Inject(SharedRoleRepository) private readonly sharedRoleRepository: SharedRoleRepository,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
    @Inject(SharedUserRepository) private readonly sharedUserRepository: SharedUserRepository,
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
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
      return await this.registerWithSession({
        email: body.email,
        username: body.username,
        password: hashedPassword,
        fullName: body.fullName,
        roleId: customerRoleId,
        userAgent: body.userAgent,
        ip: body.ip,
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

  @Transactional()
  private async registerWithSession({
    email,
    username,
    password,
    fullName,
    roleId,
    userAgent,
    ip,
  }: Pick<RegisterInputType, 'email' | 'username' | 'fullName'> & {
    password: string;
    roleId: string;
    userAgent: string;
    ip: string;
  }) {
    const user = await this.authRepository.createUserIncludeRole({
      email,
      username,
      password,
      fullName,
      roleId,
    });

    const device = await this.authRepository.createDevice({
      userId: user.id,
      userAgent,
      ip,
      lastActive: new Date(),
    });

    await this.authRepository.deleteVerificationCode({
      email_type: {
        email,
        type: TypeOfVerificationCode.REGISTER,
      },
    });

    return this.generateTokens({
      userId: user.id,
      deviceId: device.id,
      roleId,
      roleName: RoleName.Customer,
    });
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

    return this.loginWithSession({
      userId: user.id,
      roleId: user.roleId,
      roleName: user.role.name,
      userAgent: body.userAgent,
      ip: body.ip,
    });
  }

  @Transactional()
  private async loginWithSession({
    userId,
    roleId,
    roleName,
    userAgent,
    ip,
  }: Omit<AccessTokenPayloadCreate, 'deviceId'> & { userAgent: string; ip: string }) {
    const device = await this.authRepository.createDevice({
      userId,
      userAgent,
      ip,
      lastActive: new Date(),
    });

    return this.generateTokens({
      userId,
      deviceId: device.id,
      roleId,
      roleName,
    });
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

      return await this.rotateRefreshToken({
        refreshToken,
        userId,
        deviceId,
        roleId,
        roleName,
        userAgent,
        ip,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw UnauthorizedAccessException;
    }
  }

  @Transactional()
  private async rotateRefreshToken({
    refreshToken,
    userId,
    deviceId,
    roleId,
    roleName,
    userAgent,
    ip,
  }: AccessTokenPayloadCreate & {
    refreshToken: string;
    userAgent: string;
    ip: string;
  }) {
    await this.authRepository.updateDevice(deviceId, {
      ip,
      userAgent,
    });

    await this.authRepository.deleteRefreshToken({
      token: refreshToken,
    });

    return this.generateTokens({
      userId,
      roleId,
      roleName,
      deviceId,
    });
  }

  async logout(refreshToken: string) {
    try {
      const { refreshTokenId, deviceId } = await this.tokenService.verifyRefreshToken(refreshToken);

      await this.logoutSession({
        refreshTokenId,
        deviceId,
      });
      return SUCCESS_RESPONSE;
    } catch (error) {
      if (isNotFoundPrismaError(error)) {
        throw RefreshTokenAlreadyUsedException;
      }
      throw UnauthorizedAccessException;
    }
  }

  @Transactional()
  private async logoutSession({
    refreshTokenId,
    deviceId,
  }: {
    refreshTokenId: string;
    deviceId: string;
  }) {
    await this.authRepository.deleteRefreshToken({
      id: refreshTokenId,
    });

    await this.authRepository.updateDevice(deviceId, {
      isActive: false,
    });
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
    await this.resetPassword({
      userId: user.id,
      password: hashedPassword,
      email: body.email,
    });
    return SUCCESS_RESPONSE;
  }

  @Transactional()
  private async resetPassword({
    userId,
    password,
    email,
  }: {
    userId: string;
    password: string;
    email: string;
  }) {
    await this.sharedUserRepository.update(
      { id: userId },
      {
        password,
      },
    );
    await this.authRepository.deleteVerificationCode({
      email_type: {
        email,
        type: TypeOfVerificationCode.FORGOT_PASSWORD,
      },
    });
  }
}
