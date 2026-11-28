# Backend renewal fixtures

## Overview

Public, synthetic test data produced by the actual Backend authorization service,
Ed25519 signer and disposable PostgreSQL transactions. These are not real customer
credentials, not a runnable Product package and not proof of a Runtime renewal API.
Only public signing trust and precomputed leases are retained; no private keys,
content keys, Runtime private keys or encrypted workflow are included.

`manifest.json` pins the exact `protocol-vectors.json` bytes. The Backend signer
suite pins that digest and independently verifies signatures and the same stable
binding/time predicates used by Runtime J6. Do not modify frozen v2/v3 vectors.

| Case | Expected Backend result |
| --- | --- |
| advancing | 201; initial grant to sequence 2, same family/session/package, later deadlines. |
| identical-current-replay | 200; exact same compact signed lease, no extra advance. |
| second-advance | 201; sequence 3, superseding the previous receipt. |
| superseded-replay | 409 AuthorizationRequestConflict; no successful authorization. |
| nonadvancing-cap | 409 ExecutionAuthorizationExpired; family already at finite access cap. |
| expired-base | 409 ExecutionAuthorizationExpired; ordinary renewal cannot revive expiry. |

Each case includes its fixed server clock, currentLease, service request
(userId and route leaseFamilyId separate from body data), expected HTTP status
and either a successful lease/serverTime or failure key. The initial object is
public lease/serverTime only. For Runtime J12, derive expected execution/family/
package/session/thumbprint from the verified initial grant, apply successful
renewals while the current grant is unexpired and distinguish exact replay.
Backend API denials are not invented signed invalid grants.

Regeneration is explicit: provision a fresh disposable database using the existing
PostgreSQL suite's required `a2matex_execution_auth_test_<hex>` name, set
EXECUTION_AUTHORIZATION_TEST_DATABASE_URL and EXECUTION_RENEWAL_FIXTURE_OUTPUT,
then run only the test named `generates public renewal handoff` in the existing
execution-authorization.postgres.spec.ts. Never point it at application data.
The suite creates authorization tables from the existing migration only inside
that disposable database. Fresh synthetic keys/IDs yield a new digest; review the
public output, update the pinned digest intentionally and mirror both JSON files.
Normal tests do not regenerate fixtures or require deployment signing secrets.
