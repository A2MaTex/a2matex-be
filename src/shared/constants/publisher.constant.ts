export const PublisherAccountStatus = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
} as const;

export type PublisherAccountStatusType =
  (typeof PublisherAccountStatus)[keyof typeof PublisherAccountStatus];

export const TermType = {
  PUBLISHER_TERMS: 'PUBLISHER_TERMS',
  CUSTOMER_TERMS: 'CUSTOMER_TERMS',
  PRIVACY_POLICY: 'PRIVACY_POLICY',
} as const;

export type TermTypeType = (typeof TermType)[keyof typeof TermType];

export const TermStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type TermStatusType = (typeof TermStatus)[keyof typeof TermStatus];

export const PUBLISHER_REQUIRED_PROFILE_FIELDS = ['profile.fullName', 'profile.email'] as const;

export const ACCEPTANCE_METADATA_SCHEMA_VERSION = '1.0';
