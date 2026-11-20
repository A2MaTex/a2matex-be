import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repo.ts';
import { GithubOauthClient } from './oauth/github-oauth.client.ts';
import { GoogleOauthClient } from './oauth/google-oauth.client.ts';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, GoogleOauthClient, GithubOauthClient],
})
export class AuthModule {}
