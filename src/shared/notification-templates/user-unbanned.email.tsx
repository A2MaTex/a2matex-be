import { Body, Container, Head, Heading, Html, Section, Text } from '@react-email/components';
import * as React from 'react';

export interface UserUnbannedEmailProps {
  username: string;
  status: 'ACTIVE' | 'INACTIVE';
  reason: string;
  changedAt: string;
}

function formatUnbanTime(changedAt: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(changedAt));
}

export const UserUnbannedEmail = ({
  username,
  status,
  reason,
  changedAt,
}: UserUnbannedEmailProps) => (
  <Html>
    <Head>
      <title>Lệnh cấm tài khoản A2MaTeX của bạn đã được gỡ</title>
    </Head>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>Lệnh cấm tài khoản A2MaTeX của bạn đã được gỡ</Heading>
        <Section style={summary}>
          <Text style={line}>Tài khoản: {username}</Text>
          <Text style={line}>Trạng thái được khôi phục: {status}</Text>
          <Text style={line}>Thời điểm: {formatUnbanTime(changedAt)} (Asia/Bangkok)</Text>
          <Text style={line}>Lý do: {reason}</Text>
        </Section>
        <Text style={paragraph}>
          Tài khoản của bạn không còn bị hạn chế bởi lệnh cấm. Khả năng truy cập các tính năng còn
          phụ thuộc vào trạng thái tài khoản được khôi phục và chính sách hiện hành của A2MaTeX.
        </Text>
        <Text style={paragraph}>
          Nếu cần hỗ trợ thêm, vui lòng liên hệ bộ phận hỗ trợ của A2MaTeX.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default UserUnbannedEmail;

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
  color: '#166534',
  fontSize: '22px',
  lineHeight: '30px',
  margin: '0 0 24px',
};

const summary = {
  backgroundColor: '#f0fdf4',
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
