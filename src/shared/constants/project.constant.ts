export const ProjectStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProjectStatusType = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const PROJECT_NAME_MAX_LENGTH = 255;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 4_000;
