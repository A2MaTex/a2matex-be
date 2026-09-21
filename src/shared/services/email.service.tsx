import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import envConfig from '../config.ts';
import * as React from 'react';
import OTPEmail from '../notification-templates/otp.email.tsx';

@Injectable()
export class EmailService {
  private resend: Resend;
  constructor() {
    this.resend = new Resend(envConfig.RESEND_API_KEY);
  }
  async sendOTP(payload: { email: string; code: string }) {
    console.log(`OTP Email: ${payload.email}, Code: ${payload.code}`);
    const subject = 'Mã OTP';
    return this.resend.emails.send({
      from: 'A2MaTeX <onboarding@resend.dev>',
      to: [payload.email],
      subject,
      react: <OTPEmail otpCode={payload.code} title={subject} />,
    });
  }
}
