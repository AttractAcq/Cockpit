# Edge Function Remediation Traceability Matrix

Status: active baseline
Created: 2026-08-13
Ledger: `docs/edge-function-remediation/STEP_01_FINDING_LEDGER.md`

## 1. Purpose

This matrix proves that every P1 and P2 finding in Edge Function Audits 01-10 is assigned to a stable remediation ledger ID and a later implementation step. Repeated findings are deliberately routed to one root-cause item.

## 2. Audit 01 - Context and Execution Setup

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| `finalize-phase-1` allows `needs_client_input` while completing Stage 1 | `EF-READY-001` | 5 |
| `generate-phase-2` finalizes generated files before human approval | `EF-READY-002` | 5 |
| Context file provenance write failure is downgraded after file save | `EF-PROV-001` | 4/6 |
| Source document processing lacks an explicit concurrent claim | `EF-SOURCE-001` | 4/6 |
| Destructive functions have `HELD` comments while UI wrappers exist | `EF-DESTRUCT-001` | 1/2/9 |
| Destructive execution lacks storage-before-DB recovery guidance | `EF-DESTRUCT-002` | 1/10 |

## 3. Audit 02 - Intelligence OS

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Campaign Intelligence release immutability is weaker than generic Intelligence | `EF-AUTHORITY-001` | 4 |
| Retry cleanup ignores delete failures before requeue | `EF-RETRY-001` | 5/6 |
| Campaign Intelligence has no module retry action | `EF-RECOVERY-001` | 5 |
| Market, Intelligence Avatar, and Brand Strategist retry is not exposed consistently | `EF-RECOVERY-002` | 5 |
| `record-research-run` domain/idempotency drift | `EF-RESEARCH-001` | 6 |

## 4. Audit 03 - Offers and Avatars

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Seasonal Offer generation uses first Main Offer instead of selected Main Offer | `EF-OFFER-001` | 5 |
| Main/Seasonal Offer release rows lack lifecycle immutability | `EF-AUTHORITY-002` | 4 |
| `run-offers` has no explicit retry/rebuild contract | `EF-RECOVERY-003` | 5 |
| Offer prepare is vulnerable to idempotency race | `EF-CONC-001` | 6 |
| Avatar Strategy release-level immutability gap | `EF-AUTHORITY-003` | 4 |
| Avatar Appearance release-level immutability gap | `EF-AUTHORITY-003` | 4 |
| Avatar World release-level immutability gap | `EF-AUTHORITY-003` | 4 |
| Avatar Operating Context release-level immutability gap | `EF-AUTHORITY-003` | 4 |
| Avatar Asset Library release-level immutability gap | `EF-AUTHORITY-003` | 4 |
| Avatar Strategy has no explicit retry/rebuild contract | `EF-RECOVERY-004` | 5/6 |
| Avatar Appearance has no explicit retry/rebuild contract | `EF-RECOVERY-004` | 5/6 |
| Avatar World has no explicit retry/rebuild contract | `EF-RECOVERY-004` | 5/6 |
| Avatar Operating Context has no explicit retry/rebuild contract | `EF-RECOVERY-004` | 5/6 |
| Avatar Asset Library has no explicit retry/rebuild contract | `EF-RECOVERY-004` | 5/6 |
| Avatar asset review RPC is not exposed in the visible UI | `EF-AVATAR-UI-001` | 5 |
| Avatar asset version allocation can race | `EF-CONC-002` | 6 |
| Avatar asset bucket/path/external reference is not ownership-validated | `EF-OWNERSHIP-001` | 3 |

## 5. Audit 04 - Ideation, Supply, and Calendar

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Content-source adapter IDs are not client-ownership validated | `EF-OWNERSHIP-002` | 3 |
| Proof row creation and source pointer update are not safely joined | `EF-TXN-001` | 4/6 |
| Content Opportunity duplicate lookup errors are ignored | `EF-ERROR-001` | 5/6 |
| Conflict detection ignores secondary read errors | `EF-ERROR-002` | 5 |
| Conflict resolution is not compare-and-set | `EF-CONC-003` | 6 |
| Opportunity generation interprets failed authority/dedup reads as empty | `EF-ERROR-003` | 5 |
| Opportunity scoring ignores approved-context read errors | `EF-ERROR-004` | 5 |
| Score history and current score pointer are not atomic | `EF-TXN-002` | 4/6 |
| Opportunity status updates can overwrite concurrent transitions | `EF-CONC-004` | 6 |
| Calendar proposal can select unscored Opportunities | `EF-CALENDAR-001` | 5 |
| Calendar expected revision and slot writes are not atomic | `EF-CONC-005` | 4/6 |
| Content Brief regeneration demotes prior approval before replacement succeeds | `EF-AUTHORITY-004` | 4 |
| Content Brief generation ignores Context/proof/provenance read errors | `EF-ERROR-005` | 5 |
| Content Brief review transitions are not compare-and-set | `EF-CONC-006` | 4/6 |
| Older non-current Content Brief can still be approved | `EF-CONC-006` | 4/6 |

## 6. Audit 05 - Creation, Production, and Assets

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Production service-role functions lack client-access checks | `EF-AUTH-001` | 3 |
| `generate-phase-3` lacks in-function authorization | `EF-AUTH-001` | 3 |
| Contractor handoff blocks only `reel_video + ai` | `EF-PRODUCTION-001` | 5/8 |
| Contractor handoff silently rewrites production mode | `EF-PRODUCTION-001` | 5/8 |
| `production_jobs` rejects already-built Stage 5E modes | `EF-PRODUCTION-002` | 5 |
| Scoped Phase 3 can become terminal with processing items | `EF-PHASE3-001` | 5 |
| Scoped Phase 3 counters lose concurrent increments | `EF-CONC-007` | 6 |
| Production Brief regeneration overwrites prior approved content | `EF-AUTHORITY-005` | 4 |
| AI visual input paths are not ownership-validated | `EF-OWNERSHIP-003` | 3/6 |
| Production review can approve with failed/missing server checks | `EF-PRODUCTION-003` | 5 |
| Production review state-advancement meaning is unresolved | `EF-PRODUCTION-003` | 5 |
| Studio routing can replay a job for an old brief | `EF-CONC-008` | 6 |
| Background asset job may execute stale brief authority | `EF-WORK-AUTHORITY-001` | 6/8 |
| Full-month Phase 3 prepare deletes without downstream reference guard | `EF-DESTRUCT-003` | 5 |
| Scoped planning requires AI config for skip/conflict-only work | `EF-PHASE3-002` | 5 |
| Resend contractor call has no explicit timeout | `EF-PROVIDER-001` | 8 |
| Upload cleanup/parent rollback failures are ignored or not reconcilable | `EF-OBS-001` | 6/8 |
| Asset cleanup is too broadly scoped by `asset_group_ref` | `EF-OWNERSHIP-003` | 3/6 |
| Function-level role-only repeats for the affected Production/asset functions | `EF-AUTH-001` | 3 |

## 7. Audit 06 - Reel Studio

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Reel Studio service-role functions lack client-access checks | `EF-AUTH-002` | 3 |
| Video project handoff is not fully transactional | `EF-TXN-003` | 4 |
| Higgsfield submit functions do not recheck parent lifecycle | `EF-PROVIDER-002` | 5/8 |
| Motion selection is weakly validated before submit | `EF-PROVIDER-003` | 5/8 |
| Standalone projects reach an impossible/confusing handoff | `EF-REEL-001` | 5 |

## 8. Audit 07 - Distribution and Paid

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Manual Instagram publishing lacks client access | `EF-AUTH-003` | 3 |
| Manual Instagram publishing bypasses current distribution policy | `EF-POLICY-001` | 8 |
| Scheduled publishing does not recheck current distribution policy | `EF-POLICY-001` | 8 |
| Reel distribution draft lacks client access | `EF-AUTH-003` | 3 |
| Empty requested geography passes launch policy | `EF-PAID-001` | 5/8 |
| Campaign can activate after required Ad Set creation fails | `EF-PAID-002` | 8 |
| Active paid campaign can complete locally while still live at Meta | `EF-PAID-003` | 8 |
| Legacy `meta-ad-ops` is unsafe if reachable | `EF-RETIRE-001` | 9 |
| Video deliverable is not proven to belong to submitted Content Item | `EF-OWNERSHIP-004` | 3 |
| Ad Brief replacement supersedes prior authority too early | `EF-AUTHORITY-006` | 4 |
| Regulated category is not propagated to Meta payload | `EF-PAID-004` | 8 |
| Live budget can update locally without an external Ad Set | `EF-PAID-005` | 8 |
| Insights collection run can remain stuck `running` | `EF-WORKER-001` | 7 |
| Insights collection loads all eligible history before slicing | `EF-WORKER-002` | 7 |

## 9. Audit 08 - Public, Webhook, Payment, and Reporting Functions

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| All Audit 08 functions are superseded and must not be reactivated | `EF-RETIRE-001` | 9 |
| `meta-webhook` lacks signature verification/idempotency if reachable | `EF-RETIRE-001` | 9 |
| `dialog360-send` is abusable if reachable | `EF-RETIRE-001` | 9 |
| `onboarding` is unauthorized/non-transactional legacy mutation | `EF-RETIRE-001` | 9 |
| `payfast-create-link` is deprecated and unauthorized | `EF-RETIRE-001` | 9 |
| `mrr-calc` is unsafe if reachable | `EF-RETIRE-001` | 9 |
| `apify-scrape` can create unbounded legacy cost/writes | `EF-RETIRE-001` | 9 |
| `mjr-generate` and `brief-generator` are unauthorized legacy paths | `EF-RETIRE-001` | 9 |
| `payfast-webhook` validation does not make it current authority | `EF-RETIRE-001` | 9 |
| Local webhook configuration/comments do not prove deployment posture | `EF-RETIRE-002` | 2/9 |

## 10. Audit 09 - Background, Orphan, and Legacy Reconciliation

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| `validate-execution-pack` lacks caller/client validation | `EF-AUTH-004` | 3 |
| Playbook publication can remove active authority on failure | `EF-AUTHORITY-007` | 4 |
| Source document lookup/claim/transaction boundaries are weak | `EF-SOURCE-001` | 4/6 |
| Cron/background deployment posture is not fully local/versioned | `EF-WORKER-003`, `EF-WORKER-004` | 2/7/9 |
| Direct AI asset wrappers need explicit ownership/client policy | `EF-DOC-001`, `EF-AUTH-001` | 2/3 |
| Superseded function folders remain deployable | `EF-RETIRE-001`, `EF-RETIRE-002` | 9 |

## 11. Audit 10 - Cross-Function Reconciliation

| Audit finding | Ledger ID | Build step |
| --- | --- | ---: |
| Cross-domain service-role client-access gaps | `EF-AUTH-001`, `EF-AUTH-002`, `EF-AUTH-003`, `EF-AUTH-004` | 3 |
| `validate-execution-pack` supplied-client vulnerability | `EF-AUTH-004` | 3 |
| Unsafe legacy functions must stay retired | `EF-RETIRE-001`, `EF-RETIRE-002` | 9 |
| Worker secret/JWT posture needs explicit control | `EF-WORKER-003`, `EF-WORKER-004` | 2/7/9 |
| Uploaded asset/input ownership gaps | `EF-OWNERSHIP-001`, `EF-OWNERSHIP-003` | 3/6 |
| Approval immutability inconsistency | `EF-AUTHORITY-001` through `EF-AUTHORITY-007` | 4 |

## 12. Step Routing Summary

| Build step | Assigned ledger IDs |
| --- | --- |
| Step 2 | `EF-DESTRUCT-001`, `EF-WORKER-003`, `EF-DOC-001`, `EF-RETIRE-002` plus registry coverage for all 109 functions |
| Step 3 | `EF-OWNERSHIP-001`, `EF-OWNERSHIP-002`, `EF-OWNERSHIP-003`, `EF-OWNERSHIP-004`, `EF-AUTH-001`, `EF-AUTH-002`, `EF-AUTH-003`, `EF-AUTH-004`, `EF-DOC-001` |
| Step 4 | `EF-PROV-001`, `EF-SOURCE-001`, `EF-AUTHORITY-001` through `EF-AUTHORITY-007`, `EF-TXN-001`, `EF-TXN-002`, `EF-TXN-003`, `EF-CONC-005`, `EF-CONC-006` |
| Step 5 | `EF-READY-001`, `EF-READY-002`, `EF-DESTRUCT-003`, `EF-RETRY-001`, `EF-RECOVERY-001` through `EF-RECOVERY-004`, `EF-OFFER-001`, `EF-AVATAR-UI-001`, `EF-ERROR-001` through `EF-ERROR-005`, `EF-CALENDAR-001`, `EF-PRODUCTION-001`, `EF-PRODUCTION-002`, `EF-PRODUCTION-003`, `EF-PHASE3-001`, `EF-PHASE3-002`, `EF-PROVIDER-002`, `EF-PROVIDER-003`, `EF-REEL-001`, `EF-PAID-001` |
| Step 6 | `EF-PROV-001`, `EF-SOURCE-001`, `EF-RESEARCH-001`, `EF-CONC-001` through `EF-CONC-008`, `EF-TXN-001`, `EF-TXN-002`, `EF-OWNERSHIP-003`, `EF-WORK-AUTHORITY-001`, `EF-OBS-001` |
| Step 7 | `EF-WORKER-001`, `EF-WORKER-002`, `EF-WORKER-003`, `EF-WORKER-004` |
| Step 8 | `EF-PRODUCTION-001`, `EF-PROVIDER-001`, `EF-PROVIDER-002`, `EF-PROVIDER-003`, `EF-OBS-001`, `EF-POLICY-001`, `EF-PAID-001` through `EF-PAID-005`, `EF-WORK-AUTHORITY-001` |
| Step 9 | `EF-DESTRUCT-001`, `EF-WORKER-003`, `EF-RETIRE-001`, `EF-RETIRE-002` |
| Step 10 | `EF-DESTRUCT-002` and release verification for every ledger item |

## 13. Coverage Result

- Every explicit P1 and P2 finding from Audits 01-10 is represented above.
- Repeated function-level findings map to a single cross-cutting root-cause ID.
- No P1 finding is unowned.
- No finding is marked accepted risk.
- Items with unresolved existing-design questions remain visibly `verification_required` in the ledger and decision log.
