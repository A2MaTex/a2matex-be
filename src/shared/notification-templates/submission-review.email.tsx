import { Body, Container, Head, Heading, Html, Section, Text } from '@react-email/components';
import * as React from 'react';

interface SubmissionReviewEmailProps {
  title: string;
  productName: string;
  submissionNumber: number;
  nextStep: string;
}

// Deliberately carries no review feedback: the decision text stays inside the product,
// where the Publisher reads it authenticated.
export const SubmissionReviewEmail = ({
  title,
  productName,
  submissionNumber,
  nextStep,
}: SubmissionReviewEmailProps) => (
  <Html>
    <Head>
      <title>{title}</title>
    </Head>
    <Body style={main}>
      <Container style={container}>
        <Text style={tertiary}>Kết quả review</Text>
        <Heading style={secondary}>{title}</Heading>
        <Section>
          <Text style={paragraph}>
            Bản gửi #{submissionNumber} của sản phẩm {productName} đã được xét duyệt.
          </Text>
          <Text style={paragraph}>{nextStep}</Text>
        </Section>
        <Text style={footer}>
          Đây là email tự động. Vui lòng đăng nhập Publisher Portal để xem nhận xét chi tiết.
        </Text>
      </Container>
    </Body>
  </Html>
);

SubmissionReviewEmail.PreviewProps = {
  title: 'Bản gửi cần chỉnh sửa',
  productName: 'Auto Farm Helper',
  submissionNumber: 3,
  nextStep: 'Vui lòng xem nhận xét trong Publisher Portal rồi gửi lại bản mới.',
} as SubmissionReviewEmailProps;

export default SubmissionReviewEmail;

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'HelveticaNeue,Helvetica,Arial,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #eee',
  borderRadius: '5px',
  boxShadow: '0 5px 10px rgba(20,50,70,.2)',
  marginTop: '20px',
  maxWidth: '480px',
  margin: '0 auto',
  padding: '32px 40px 48px',
};

const tertiary = {
  color: '#0a85ea',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0',
  lineHeight: '16px',
  margin: '16px 0 8px',
  textTransform: 'uppercase' as const,
};

const secondary = {
  color: '#000',
  fontSize: '20px',
  fontWeight: 600,
  lineHeight: '28px',
  margin: '0 0 16px',
};

const paragraph = {
  color: '#444',
  fontSize: '15px',
  lineHeight: '23px',
  margin: '0 0 12px',
};

const footer = {
  color: '#898989',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '24px 0 0',
};
