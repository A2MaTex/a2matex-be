import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import { PublicPublisherOutputDTO, PublisherUsernameParamDTO } from './publisher.dto.ts';
import { PublisherService } from './publisher.service.ts';

@ApiTags('Marketplace Publishers')
@Controller('marketplace/publishers')
export class MarketplacePublisherController {
  constructor(@Inject(PublisherService) private readonly publisherService: PublisherService) {}

  @Get(':username')
  @IsPublic()
  @ZodResponse({ type: PublicPublisherOutputDTO })
  getPublicProfile(@Param() params: PublisherUsernameParamDTO) {
    return this.publisherService.getPublicProfile(params.username);
  }
}
