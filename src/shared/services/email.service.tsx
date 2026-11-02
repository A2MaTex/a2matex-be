import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import envConfig from '../config.ts';
import * as React from 'react';
import OTPEmail from '../notification-templates/otp.email.tsx';
import UserBannedEmail from '../notification-templates/user-banned.email.tsx';
import UserUnbannedEmail from '../notification-templates/user-unbanned.email.tsx';

@Injectable()
export class EmailService {
  private resend: Resend;
  constructor() {
    this.resend = new Resend(envConfig.RESEND_API_KEY);
  }
  async sendOTP(payload: { email: string; code: string; subject: string }) {
    if (envConfig.NODE_ENV !== 'production') {
      console.log(`OTP Email: ${payload.email}, Code: ${payload.code}`);
    }
    return this.resend.emails.send({
      from: envConfig.EMAIL_FROM,
      to: [payload.email],
      subject: payload.subject,
      react: <OTPEmail otpCode={payload.code} title={payload.subject} />,
    });
  }

  async sendUserBanned(payload: {
    email: string;
    username: string;
    reason: string;
    changedAt: string;
  }) {
    return this.resend.emails.send({
      from: envConfig.EMAIL_FROM,
      to: [payload.email],
      subject: 'Tài khoản A2MaTex của bạn đã bị cấm',
      react: (
        <UserBannedEmail
          username={payload.username}
          reason={payload.reason}
          changedAt={payload.changedAt}
        />
      ),
    });
  }

  async sendUserUnbanned(payload: {
    email: string;
    username: string;
    status: 'ACTIVE' | 'INACTIVE';
    reason: string;
    changedAt: string;
  }) {
    return this.resend.emails.send({
      from: envConfig.EMAIL_FROM,
      to: [payload.email],
      subject: 'Lệnh cấm tài khoản A2MaTeX của bạn đã được gỡ',
      react: (
        <UserUnbannedEmail
          username={payload.username}
          status={payload.status}
          reason={payload.reason}
          changedAt={payload.changedAt}
        />
      ),
    });
  }
}
