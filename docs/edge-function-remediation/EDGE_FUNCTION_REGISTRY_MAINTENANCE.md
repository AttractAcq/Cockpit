# Edge Function Registry Maintenance

Status: active control
Registry: `supabase/functions/registry.json`
Schema: `supabase/functions/registry.schema.json`
Validator: `scripts/check-edge-function-registry.mjs`

## 1. Purpose

The registry is the version-controlled description of the intended operational contract for every local Supabase Edge Function. It prevents unowned functions, accidental legacy deployment, undocumented worker authentication, and drift between intended JWT posture and `supabase/config.toml`.

The registry is build-time metadata only. Edge Function runtime code must not import it, and it must not become a router, authorization service, deployment controller, or source of secret values.

## 2. Contract Shape

Each entry under `functions` declares the function-specific facts:

- name and bounded purpose;
- owning system and UI page;
- shared contract profile;
- database domains and storage buckets touched;
- external providers and required environment variable names;
- audit phases and remediation ledger IDs;
- test references;
- known function-to-function callers.

The referenced profile supplies the common operational contract:

- lifecycle and caller type;
- allowed methods;
- authentication mode and staff roles;
- client-scope requirement;
- JWT and alternate-secret posture;
- service-role usage;
- deployability;
- operational owner;
- baseline Supabase environment variable names.

The validator resolves the profile and entry into one complete contract before checking it.

## 3. Adding a Function

1. Add the local function directory and bounded implementation.
2. Add exactly one registry entry in the same change.
3. Reuse an existing profile only if every inherited field is correct. Add a narrowly named profile if the caller/auth/lifecycle contract is genuinely different.
4. State the existing product purpose without broadening the function's responsibility.
5. Record the real caller, page/system owner, data domains, storage, providers, environment variable names, audit references, remediation IDs, and tests.
6. Add any intentional function-to-function caller to `internalCallers`.
7. Run `npm run check:edge-functions`, focused tests, typecheck, and build.

An unregistered local directory fails CI with `UNREGISTERED_LOCAL_FUNCTION`.

## 4. Renaming or Removing a Function

Rename the local directory and registry entry together. Update caller maps, internal callers, tests, and documentation in the same change.

Removing a local directory without removing or retiring its registry entry fails with `STALE_REGISTRY_FUNCTION`.

Do not use registry removal as a substitute for authorized remote decommissioning. Remote state must be verified separately in the release step.

## 5. Retiring a Function

Retirement means the function has no current product role.

1. Set or retain a profile with `lifecycle: retired`, `caller: none`, and `deployable: false`.
2. Remove active callers and schedules.
3. Link the retirement ledger IDs.
4. Preserve historical source only until the authorized quarantine/decommission step moves it out of the deployable path.
5. Verify remote deployment state separately before deletion.

The validator rejects a retired function marked deployable.

## 6. JWT and Worker Configuration

`supabase/config.toml` is the local version-controlled source for explicit JWT exceptions. Functions not listed there resolve to Supabase's default `verify_jwt = true` posture.

A function with `jwtVerification: disabled_with_alternate_auth` must declare an alternate secret. Background workers must also declare an explicit cron/webhook auth mode and allowed methods.

Current bounded exception:

- `process-asset-generation-jobs` is documented by the audit as JWT-disabled remotely and `CRON_SECRET` gated, but local config does not yet declare that posture. `EF-WORKER-003-JWT-CONFIG` keeps this mismatch visible until Step 7 reconciles it. It is not evidence that remote configuration is correct.

## 7. Exceptions

Exceptions are allowed only for facts that cannot yet be reconciled locally and only for validator checks explicitly supported by the schema.

Every exception requires:

- stable ID;
- affected function and check;
- owner;
- specific reason;
- ISO review date;
- remediation ledger ID.

Expired exceptions fail CI. Do not extend a review date without recording why the underlying remediation could not be completed. Exceptions must never contain secret values.

## 8. Verification Commands

```bash
npm run check:edge-functions
node --test tests/edge-function-registry.test.ts
npm run typecheck
npm run build
```

CI runs the registry check before the deterministic test suite.

## 9. Failure Meanings

| Code | Meaning |
| --- | --- |
| `UNREGISTERED_LOCAL_FUNCTION` | A local function directory has no registry owner/contract. |
| `STALE_REGISTRY_FUNCTION` | A registry entry has no matching local directory. |
| `RETIRED_DEPLOYABLE` | Retired code has been made eligible for deployment. |
| `BACKGROUND_AUTH_MISSING` / `BACKGROUND_SECRET_MISSING` | A worker or webhook lacks explicit alternate authentication. |
| `JWT_CONFIG_MISMATCH` | Intended JWT posture contradicts local config without a current exception. |
| `EXPIRED_EXCEPTION` | A temporary reconciliation exception passed its review date. |
| `INTERNAL_CALLER_MISMATCH` | The audited function-to-function call graph changed without registry review. |

## 10. Original-Objective Guard

Registry maintenance does not authorize changing a function's purpose. If an entry cannot describe a proposed change without revising the existing product objective, stop and route that work through a separately approved build decision.
