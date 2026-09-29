import { Body, Controller, Get, Inject, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  ChangePasswordInputDTO,
  ProfileOutputDTO,
  UpdatePersonalProfileInputDTO,
} from './profile.dto.ts';
import { ProfileService } from './profile.service.ts';

@ApiTags('Profiles')
@ApiBearerAuth('access-token')
@Controller('profiles')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profileService: ProfileService) {}

  @Get('me')
  @ZodResponse({ type: ProfileOutputDTO })
  getMe(@ActiveUser('userId') userId: string) {
    return this.profileService.getMe(userId);
  }

  @Put('me')
  @ZodResponse({ type: MessageResDTO })
  updatePersonalProfile(
    @Body() body: UpdatePersonalProfileInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.profileService.updatePersonalProfile({
      userId,
      data: body,
    });
  }

  @Patch('me/change-password')
  @ZodResponse({ type: MessageResDTO })
  changePassword(@Body() body: ChangePasswordInputDTO, @ActiveUser('userId') userId: string) {
    return this.profileService.changePassword({
      userId,
      data: body,
    });
  }
}
