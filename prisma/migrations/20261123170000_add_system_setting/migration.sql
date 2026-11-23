-- SystemSetting: operational values an Admin changes without a deployment.
-- Spec: specs/009-system-setting (spec.md, data-model.md, research.md).
--
-- Decisions encoded here:
--   * One row per key, edited in place. The set of valid keys lives in a code-side
--     registry, not in data, so there is no create or delete path in the application.
--   * "value" is JSONB because the four keys already have two different shapes and a
--     fifth (a BIGINT-as-string) arrives in payout phase 4. Per-type columns would be
--     three nullable columns of which each row uses one.
--   * No "deletedAt". Soft-deleting a row would produce "declared key with no row",
--     which the startup check treats as fatal.
--   * History goes in "auditHistory" on the row itself, matching User.auditHistory and
--     Entitlement.auditHistory, rather than a second table.
--   * The commission CHECK is written as "other keys are always fine" so it costs
--     nothing for the other rows and needs no edit when a key is added. It catches an
--     out-of-range rate but not a missing "rateBps" field: (value->>'rateBps')::int is
--     NULL then, and NULL BETWEEN yields NULL, which does not violate. The application
--     schema covers that half.
--   * All four rows are seeded, the bank ones empty. Deploy runs migrations before the
--     new container starts, so a key with no row would stop that container from booting
--     and the seed step that fills these values would never run.

CREATE TABLE "SystemSetting" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "updatedById" UUID
        REFERENCES "User" (id) ON DELETE NO ACTION,
    "auditHistory" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "SystemSetting_value_object_check"
        CHECK (jsonb_typeof(value) = 'object'),
    CONSTRAINT "SystemSetting_auditHistory_array_check"
        CHECK (jsonb_typeof("auditHistory") = 'array'),
    CONSTRAINT "SystemSetting_updatedBy_check" CHECK (
        ("updatedAt" IS NULL) = ("updatedById" IS NULL)
    ),
    CONSTRAINT "SystemSetting_commissionRate_check" CHECK (
        key <> 'COMMISSION_RATE_BPS'
        OR ((value ->> 'rateBps')::int BETWEEN 0 AND 10000)
    )
);

INSERT INTO "SystemSetting" (key, value) VALUES
    ('COMMISSION_RATE_BPS',       '{"rateBps": 3000}'),
    ('SEPAY_BANK_ACCOUNT_NUMBER', '{"value": ""}'),
    ('SEPAY_BANK_NAME',           '{"value": ""}'),
    ('SEPAY_BANK_ACCOUNT_HOLDER', '{"value": ""}');
