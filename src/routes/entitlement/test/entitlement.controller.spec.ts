import { AdminEntitlementController } from '../admin-entitlement.controller.ts';
import { EntitlementController } from '../entitlement.controller.ts';
import { GetMyEntitlementsInput, GrantEntitlementInput } from '../entitlement.model.ts';
import type { EntitlementService } from '../entitlement.service.ts';

vi.mock('../entitlement.service.ts', () => ({
  EntitlementService: class EntitlementService {},
}));

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ENTITLEMENT_ID = '44444444-4444-4444-8444-444444444444';

describe('Entitlement controllers', () => {
  const service = {
    listMine: vi.fn(),
    listAdmin: vi.fn(),
    grant: vi.fn(),
    revoke: vi.fn(),
  };
  const customerController = new EntitlementController(service as unknown as EntitlementService);
  const adminController = new AdminEntitlementController(service as unknown as EntitlementService);

  beforeEach(() => vi.clearAllMocks());

  it('reads My Products for the token user only', async () => {
    const query = { page: 1, limit: 10 };
    await customerController.listMine(query, CUSTOMER_ID);

    expect(service.listMine).toHaveBeenCalledWith({ userId: CUSTOMER_ID, query });
  });

  it('passes the acting Admin to grant and revoke', async () => {
    const body = GrantEntitlementInput.parse({
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
      expiresAt: null,
      reason: 'UAT',
    });
    await adminController.grant(body, ADMIN_ID);
    await adminController.revoke({ entitlementId: ENTITLEMENT_ID }, { reason: 'policy' }, ADMIN_ID);

    expect(service.grant).toHaveBeenCalledWith({ data: body, adminUserId: ADMIN_ID });
    expect(service.revoke).toHaveBeenCalledWith({
      entitlementId: ENTITLEMENT_ID,
      reason: 'policy',
      adminUserId: ADMIN_ID,
    });
  });
});

describe('Entitlement input schemas', () => {
  const grant = {
    customerId: CUSTOMER_ID,
    productId: PRODUCT_ID,
    expiresAt: '2027-01-01T00:00:00Z',
    reason: '  UAT  ',
  };

  it('trims the reason and turns expiresAt into a Date', () => {
    const parsed = GrantEntitlementInput.parse(grant);

    expect(parsed.reason).toBe('UAT');
    expect(parsed.expiresAt).toEqual(new Date('2027-01-01T00:00:00Z'));
  });

  it('requires expiresAt to be present, null meaning permanent', () => {
    const { expiresAt: _omitted, ...withoutExpiresAt } = grant;

    expect(GrantEntitlementInput.safeParse(withoutExpiresAt).success).toBe(false);
    expect(GrantEntitlementInput.parse({ ...grant, expiresAt: null }).expiresAt).toBeNull();
  });

  it.each([
    ['a blank reason', { reason: '   ' }],
    ['a reason over 2000 characters', { reason: 'x'.repeat(2001) }],
    ['an unknown field', { extra: true }],
    ['a non-uuid customer', { customerId: 'nope' }],
  ])('rejects %s', (_label, patch) => {
    expect(GrantEntitlementInput.safeParse({ ...grant, ...patch }).success).toBe(false);
  });

  it('caps the page size at 100', () => {
    expect(GetMyEntitlementsInput.safeParse({ limit: '101' }).success).toBe(false);
    expect(GetMyEntitlementsInput.parse({})).toEqual({ page: 1, limit: 10 });
  });
});
