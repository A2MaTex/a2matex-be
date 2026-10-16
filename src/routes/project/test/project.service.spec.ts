import { Prisma } from '../../../generated/prisma/client.ts';
import { ProjectStatus } from '../../../shared/constants/project.constant.ts';
import { ProjectAccessPolicy } from '../../../shared/services/project-access.policy.ts';
import { ProjectArchivedException } from '../project.error.ts';
import { ProjectRepo } from '../project.repo.ts';
import { ProjectService } from '../project.service.ts';

const USER_ID = '51d00409-9ab7-455b-b306-e2841ec3344e';
const PUBLISHER_ACCOUNT_ID = '82809092-555b-4eaa-9989-229e8b08ca59';
const PROJECT_ID = '2b6a469f-45df-4adc-b70a-9dc6435da30c';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });
}

describe('ProjectService create retry', () => {
  const create = vi.fn();
  const getByNormalizedName = vi.fn();
  const getActivePublisherAccount = vi.fn();
  const service = new ProjectService(
    { create, getByNormalizedName } as unknown as ProjectRepo,
    { getActivePublisherAccount } as unknown as ProjectAccessPolicy,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getActivePublisherAccount.mockResolvedValue({
      id: PUBLISHER_ACCOUNT_ID,
      status: 'ACTIVE',
    });
  });

  it('returns the existing active project id after a duplicate create', async () => {
    create.mockRejectedValue(uniqueConstraintError());
    getByNormalizedName.mockResolvedValue({ id: PROJECT_ID, status: ProjectStatus.ACTIVE });

    await expect(
      service.create({
        data: { name: 'Retry-safe project', description: null },
        userId: USER_ID,
      }),
    ).resolves.toEqual({ id: PROJECT_ID });

    expect(getByNormalizedName).toHaveBeenCalledWith({
      name: 'Retry-safe project',
      publisherAccountId: PUBLISHER_ACCOUNT_ID,
    });
  });

  it('rejects a duplicate name belonging to an archived project', async () => {
    create.mockRejectedValue(uniqueConstraintError());
    getByNormalizedName.mockResolvedValue({ id: PROJECT_ID, status: ProjectStatus.ARCHIVED });

    await expect(
      service.create({
        data: { name: 'Archived project', description: null },
        userId: USER_ID,
      }),
    ).rejects.toBe(ProjectArchivedException);
  });

  it('rethrows unrelated persistence errors without a lookup', async () => {
    const error = new Error('database unavailable');
    create.mockRejectedValue(error);

    await expect(
      service.create({
        data: { name: 'New project', description: null },
        userId: USER_ID,
      }),
    ).rejects.toBe(error);

    expect(getByNormalizedName).not.toHaveBeenCalled();
  });
});
