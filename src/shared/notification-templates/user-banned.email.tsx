import { Body, Container, Head, Heading, Html, Section, Text } from '@react-email/components';
import * as React from 'react';

export interface UserBannedEmailProps {
  username: string;
  reason: string;
  changedAt: string;
}

function formatBanTime(changedAt: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(changedAt));
}

export const UserBannedEmail = ({ username, reason, changedAt }: UserBannedEmailProps) => (
  <Html>
    <Head>
      <title>Tài khoản A2MaTex của bạn đã bị cấm</title>
    </Head>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>Tài khoản A2MaTex của bạn đã bị cấm</Heading>
        <Section style={summary}>
          <Text style={line}>Tài khoản: {username}</Text>
          <Text style={line}>Trạng thái: BANNED</Text>
          <Text style={line}>Thời điểm: {formatBanTime(changedAt)} (Asia/Bangkok)</Text>
          <Text style={line}>Lý do: {reason}</Text>
        </Section>
        <Text style={paragraph}>
          Bạn đã bị đăng xuất khỏi tất cả thiết bị và không thể đăng nhập hoặc sử dụng các API yêu
          cầu xác thực trong thời gian tài khoản bị cấm.
        </Text>
        <Text style={paragraph}>
          Nếu cho rằng đây là nhầm lẫn, vui lòng liên hệ bộ phận hỗ trợ để được hướng dẫn khiếu nại.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default UserBannedEmail;

const main = {
  backgroundColor: '#f5f7fa',
  fontFamily: 'HelveticaNeue,Helvetica,Arial,sans-serif',
  padding: '24px 0',
};

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px',
};

const heading = {
  color: '#991b1b',
  fontSize: '22px',
  lineHeight: '30px',
  margin: '0 0 24px',
};

const summary = {
  backgroundColor: '#fef2f2',
  borderRadius: '6px',
  padding: '12px 16px',
};

const line = {
  color: '#1f2937',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '6px 0',
};

const paragraph = {
  color: '#4b5563',
  fontSize: '15px',
  lineHeight: '23px',
};
