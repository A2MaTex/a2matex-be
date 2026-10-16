import { PermissionScope } from '../../../shared/constants/role.constant.ts';
import { ProjectAccessRepo } from '../../../shared/repositories/project-access.repo.ts';
import { ProjectAccessPolicy } from '../../../shared/services/project-access.policy.ts';

vi.mock('../../../shared/repositories/project-access.repo.ts', () => ({
  ProjectAccessRepo: class ProjectAccessRepo {},
}));

describe('ProjectAccessPolicy', () => {
  const getPublisherAccount = vi.fn();
  let policy: ProjectAccessPolicy;

  beforeEach(() => {
    getPublisherAccount.mockReset();
    policy = new ProjectAccessPolicy({ getPublisherAccount } as unknown as ProjectAccessRepo);
  });

  it('lets unrestricted read access win without querying a Publisher account', async () => {
    await expect(policy.resolveReadAccess('user-id', [PermissionScope.OWN, null])).resolves.toEqual(
      {
        unrestricted: true,
      },
    );
    expect(getPublisherAccount).not.toHaveBeenCalled();
  });

  it('allows OWN reads for a blocked Publisher account', async () => {
    getPublisherAccount.mockResolvedValue({ id: 'publisher-id', status: 'BLOCKED' });

    await expect(policy.resolveReadAccess('user-id', [PermissionScope.OWN])).resolves.toEqual({
      unrestricted: false,
      publisherAccountId: 'publisher-id',
    });
  });

  it('does not treat unrestricted permission as permission to save drafts', async () => {
    await expect(policy.resolveDraftSaveAccess('user-id', [null])).rejects.toThrow(
      'Error.ProjectAccessDenied',
    );
    expect(getPublisherAccount).not.toHaveBeenCalled();
  });

  it('rejects draft saves for a blocked Publisher account', async () => {
    getPublisherAccount.mockResolvedValue({ id: 'publisher-id', status: 'BLOCKED' });

    await expect(policy.resolveDraftSaveAccess('user-id', [PermissionScope.OWN])).rejects.toThrow(
      'Error.PublisherBlocked',
    );
  });
});
